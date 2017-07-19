/////////////////////////////////////////////////////////////////////////////////////////////
//
// cc.starfox
//
//    starfox UIXML template engine.
//
// License
//    Apache License Version 2.0
//
// Copyright Nick Verlinden (info@createconform.com)
//
/////////////////////////////////////////////////////////////////////////////////////////////

function StarFox() {
    var self = this;

    //
    // DEPENDENCIES
    //
    var type = require("cc.type");
    var io = require("cc.io");

    //
    // CONSTANTS
    //
    this.ERROR_INVALID_UIXML = "starfox-error-invalid-uixml";
    this.ERROR_UNSUPPORTED_RUNTIME = "starfox-error-unsupported-runtime";
    this.ERROR_UNABLE_TO_RENDER = "starfox-error-unable-to-render";
    this.ERROR_INVALID_CONTROL = "starfox-error-invalid-control";
    this.ERROR_DUPLICATE_CONTROL = "starfox-error-duplicate-control";

    //
    // PRIVATES
    //
    var controls = [];
    var controlTypeCaseSensitive = false;

    //
    // class containing app information
    //
    function App() {
        this.name = null;
        this.icon = null;
        this.controller = null;
        this.instance = null;
        this.main = null;
        this.controls = [];
    }

    //
    // class containing control group information
    //
    function controlGroup(name) {
        this.name = name;
        this.controls = [];
    }

    //
    // renders the given uixml string.
    //
    function Renderer(data) {
        var self = this;

        var uiXML = getXMLParser()(data);
        var uiNode = uiXML.getElementsByTagName("ui")[0];
        var tagNameCount = {}; // used for auto generating property name for controller
        var controlGroups = []; // used for grouping controls (for the switch command)

        if (!uiNode) {
            throw new Error(self.ERROR_INVALID_UIXML, "The specified xml does not have a 'UI' node.");
        }

        // get app properties
        app = new App();
        app.name = getNodeAttribute(uiNode, "name");
        app.icon = getNodeAttribute(uiNode, "icon", false);
        app.controller = getNodeAttribute(uiNode, "controller", false);
        app.main = getNodeAttribute(uiNode, "main", false);
        app.onLoad = getNodeAttribute(uiNode, "onload", false);

        // start parsing UI node children
        var groupNodes = [];
        var otherNodes = [];
        for (var k = 0; k < uiNode.childNodes.length; k++) {
            switch (uiNode.childNodes[k].tagName) {
                case "group":
                    groupNodes.push(uiNode.childNodes[k]);
                    break;
                default:
                    otherNodes.push(uiNode.childNodes[k]);
                    break;
            }
        }

        // parse nodes in specific order
        parseNodes(groupNodes);
        parseNodes(otherNodes);

        //
        // parse all nodes in an array
        //
        function parseNodes(nodes) {
            for (var n in nodes) {
                parseNode(nodes[n]);
            }
        }

        //
        // parse a node
        //
        function parseNode(node) {
            // check reserved names
            switch (node.tagName) {
                case undefined:
                    break;
                case "group":
                    var name = getNodeAttribute(groupNode, "name", true);
                    if (name != "") {
                        // check if name does not already exist
                        for (var g = 0; g < controlGroups.length; g++) {
                            if (controlGroups[g].name == name) {
                                throw new Error(self.ERROR_UNABLE_TO_RENDER, "Control group '" + name + "' is defined multiple times.");
                            }
                        }
                        var group = new controlGroup(name);
                        controlGroups.push(group);
                        addInstanceToController(name, group.controls);
                    }
                    break;
                default:
                    var control = createControlInstance(node);
                    if (control == null) {
                        throw new Error(self.ERROR_UNABLE_TO_RENDER, "Control type '" + node.tagName + "' could not be found. Make sure the control is loaded and registered.");
                    }
                    app.controls.push(control);
                    addInstanceToController(control.name, control);
                    break;
            }
        }

        //
        // creates a control instance from a UIXML node.
        //
        function createControlInstance(node, customControlInstance) {
            var instance = null;
            var tagName = node.tagName == null ? node.tagName : node.tagName.toLowerCase();
            var name = getNodeAttribute(node, "name", false);

            var control = controls[tagName];
            if (control != null) {
                instance = new control.type();

                // get name attribute or add default mandatory name attribute
                instance.name = name;
                if (instance.name == null || instance.name == "") {
                    tagNameCount[tagName] = tagNameCount[tagName] || 0;
                    instance.name = (tagName.substr(0,1).toLowerCase() + (tagName.length > 1? tagName.substr(1,tagName.length) : "")) + tagNameCount[tagName]++;
                }

                // add the control to a group
                var groupName = getNodeAttribute(node, "group", false);
                if (groupName != null && groupName != "") {
                    for (var g = 0; g < controlGroups.length; g++) {
                        if (controlGroups[g].name == groupName) {
                            controlGroups[g].controls.push(instance);
                            break;
                        }

                        if (g == controlGroups.length - 1) {
                            throw new Error(self.ERROR_UNABLE_TO_RENDER, "Could not render control '" + instance.name + "'. Control group '" + groupName + "' is not defined in the UIXML.");
                        }
                    }
                }

                // read attributes
                if (control.definition.attributes != null) {
                    for (var a = 0; a < control.definition.attributes.length; a++) {
                        if (node.attributes[control.definition.attributes[a].name] != null) {
                            // process value
                            type.setProperty(instance, control.definition.attributes[a].property, parseAttributeValue(node.attributes[control.definition.attributes[a].name].value, control.definition.attributes[a].type));
                        }
                    }
                }

                // process control events
                if (control.definition.events != null) {
                    for (var e = 0; e < control.definition.events.length; e++) {
                        if (node.attributes["on" + control.definition.events[e].name] != null) {
                            // manage callback (fn should exist in controller instance)
                            var fnId = node.attributes["on" + control.definition.events[e].name].value;

                            var obj = customControlInstance != null ? customControlInstance : app.object;
                            callback = function (sender, args) {
                                var fn = type.getProperty(obj, fnId);
                                if (fn == null) {
                                    throw new Error(self.ERROR_UNABLE_TO_RENDER, "Could not execute callback. Constructor '" + app.controller + "' is missing function '" + fnId + "'.");
                                }
                                else {
                                    fn.call(obj, sender, args);
                                }
                            };
                        }
                    }
                }

                // parse control containers
                var foundCont = false;
                if (control.definition.containers.length == 1) {
                    // if the control has only one container, it is allowed to ommit the container node and add child controls directly.
                    parseContainerNode(control.definition.containers[0], instance, node, control.definition, customControlInstance);
                    foundCont = true;
                }
                else {
                    // itterate all container nodes
                    for (var k = 0; k < node.childNodes.length; k++) {
                        var containers = "";
                        for (var t = 0; t < control.definition.containers.length; t++) {
                            var containerName = controlTypeCaseSensitive ? control.definition.containers[t].name : control.definition.containers[t].name.toLowerCase();
                            containers += ((containers != ""? "" : ", ") + containerName);
                            if (node.childNodes[k].tagName == containerName) {
                                // parse container
                                parseContainerNode(control.definition.containers[t], instance, node.childNodes[k], control.definition, customControlInstance);
                                foundCont = true;
                                break;
                            }
                        }
                        if (!foundCont) {
                            if (node.childNodes[k].tagName != null) {
                                // not a valid child node
                                throw new Error(self.ERROR_UNABLE_TO_RENDER, "Could not render control '" + instance.name + "'. Invalid child node '" + node.childNodes[k].tagName + "'. Expects one of the container nodes: '" + containers + "'.");
                            }
                        }
                    }
                }
                if (!foundCont && node.childNodes.length > 0) {
                    throw new Error(self.ERROR_UNABLE_TO_RENDER, "Could not render control '" + instance.name + "'. Control type '" + control.definition.type + "' does not support child controls.");
                }

                // fire the onLoad event
                var onload = getNodeAttribute(node, "onload", false);
                if (onload != null) {
                    var obj = customControlInstance != null ? customControlInstance : app.instance;
                    var funct = type.getProperty(obj, onload);
                    if (typeof funct !== "function") {
                        throw new Error(self.ERROR_UNABLE_TO_RENDER, "Could not render control '" + instance.name + "'. It is missing function '" + onload + "' for the onLoad event.");
                    }
                    funct.call(obj, instance);
                }
            }
            else {
                throw new Error(self.ERROR_UNABLE_TO_RENDER, "Could not render control" + (name ? " '" + name + "'" : "") + ". Control type '" + tagName + "' could not be found. Make sure the control type is loaded and registered.");
            }

            return instance;
        }

        //
        // parse a control container node
        //
        function parseContainerNode(container, instance, node, parentType, customControlInstance) {
            // parse attributes
            if (container.attributes != null) {
                for (var a = 0; a < container.attributes.length; a++) {
                    if (node.attributes[container.attributes[a].name] != null) {
                        type.setProperty(instance, container.attributes[a].property, parseAttributeValue(node.attributes[container.attributes[a].name].value, container.attributes[a].type));
                    }
                }
            }

            for (var k = 0; k < node.childNodes.length; k++) {
                if (node.childNodes[k].tagName != null) {
                    var control = createControlInstance(node.childNodes[k], customControlInstance);

                    // check if control has a parentType, and if it matches the parentType
                    var pType = control.getParentType();
                    if (pType != null && pType != "" && pType != parentType.name) {
                        throw new Error(self.ERROR_UNABLE_TO_RENDER, "Control type '" + control.getType() + "' can not be used as a child of control type '" + parentType.name + "', only as a child of control type '" + pType + "'.");
                    }

                    // add the newly created instance
                    if (customControlInstance) {
                        customControlInstance[control.name] = controls[c];
                    }
                    else {
                        addInstanceToController(control.name, controls[c]);
                    }

                    //add control[c] to container
                    var funct = type.getProperty(instance, container.funct);
                    //if a '.' is found, get the property of the instance, and pass that as instance.
                    var functInst = instance;
                    if (container.funct.indexOf(".") > -1) {
                        functInst = type.getProperty(instance, container.funct.substr(0, container.funct.lastIndexOf(".")));
                    }
                    if (typeof funct !== "function") {
                        throw new Error(self.ERROR_INVALID_CONTROL, "Can't add child control '" + control.name + "'. Control type '" + parentType.name + "' is missing function '" + container.funct + "'.");
                    }

                    // call control container's add function
                    funct.call(functInst, control);
                }
            }
        }

        //
        // adds the specified control instance to the controller instance in pascal case.
        //
        function addInstanceToController(name, control) {
            if (app.instance != null) {
                app.instance[name.substr(0,1).toLowerCase() + (name.length > 1? name.substr(1) : "")] = control;
            }
        }
    }

    //
    // returns an xml parser
    //
    function getXMLParser() {
        var parseXML;

        if (typeof window !== "undefined" && typeof window.DOMParser !== "undefined") {
            parseXML = function (xmlStr) {
                return (new window.DOMParser()).parseFromString(xmlStr, "text/xml");
            };
        } else if (typeof window !== "undefined" && typeof window.ActiveXObject !== "undefined" && new window.ActiveXObject("Microsoft.XMLDOM")) {
            parseXML = function (xmlStr) {
                var xmlDoc = new window.ActiveXObject("Microsoft.XMLDOM");
                xmlDoc.async = "false";
                xmlDoc.loadXML(xmlStr);
                return xmlDoc;
            };
        } else {
            throw new Error(self.ERROR_UNSUPPORTED_RUNTIME, "The current runtime does not have an XML parser.");
        }

        return parseXML;
    }

    //
    // returns the value of an xml node attribute
    //
    function getNodeAttribute(node, att, mandatory) {
        if (mandatory == null) {
            mandatory = true;
        }
        if (node.attributes[att] != null) {
            return node.attributes[att].value;
        }
        else {
            if (mandatory) {
                throw new Error(self.ERROR_UNABLE_TO_RENDER, "Node '" + node.tagName + "' is missing the mandatory '" + att + "' attribute.");
            }
            else {
                return null;
            }
        }
    }

    //
    // returns the the parsed value for an xml attribute
    //
    function parseAttributeValue(val, type) {
        switch (type) {
            case "boolean":
                return val == 1 || val == "true" || val == "True";
            case "int":
                return parseInt(val);
            case "float":
                return parseFloat(val);
            case "url":
                if (val.length > 7 && val.substr(0,7) == "pkx:///") {
                    //fallthrough to resource
                    val = val.substr(7);
                }
                else {
                    //TODO - verify url validity
                    return val;
                }
            case "resource":
            case "resource-url":
                if (app.package == null) {
                    throw "Can't get resource. The app has no package.";
                }
                var res = null;
                app.package.require(val, function(m) {
                    res = m;
                });
                if (res == null) {
                    throw "Resource '" + val + "' does not exist in package '" + app.package.getFullName() + "'.";
                }
                if (type == "resource") {
                    return res;
                }
                if (typeMod.isFunction(res.createObjectURL)) {
                    return res.createObjectURL();
                }
                else {
                    this.dom.node.style.backgroundImage = "";
                    throw "Invalid resource.";
                }
                break;
            default:
                return val;
        }
    }


    //
    // PUBLIC FUNCTIONS
    //

    //
    // loads the specified UIXML file.
    //
    this.load = function(uri) {
        return new Promise(function(resolve, reject) {
            io.URI.open(uri).then(function(stream) {
                stream.readAsString().then(function(data) {
                    new Renderer(data);
                }).catch(reject);
            }).catch(reject);
        });
    }

    //
    // registers a new control type.
    //
    this.registerControl = function(control)
    {
        var type = controlTypeCaseSensitive? control.definition.name : control.definition.name.toLowerCase();
        if (controls[type]) {
            throw new Error(self.ERROR_INVALID_CONTROL, "A control with name '" + control.definition.name + "' is already registered.");
        }
        controls[type] = control;
    };
}

var singleton;
define(function() {
    if (!singleton) {
        singleton = new (Function.prototype.bind.apply(StarFox, arguments));
    }

    return singleton;
});

//DEBUG
try {
    //var sf = define.cache.get().factory();
    //sf.load("pkx:///cc.starfox.0.1.0/test/test.xml").then().catch(console.error);
}
catch(e) {
    console.error(e);
}