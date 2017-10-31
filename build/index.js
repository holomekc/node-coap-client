"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
// Reflect-polyfill laden
// tslint:disable-next-line:no-var-requires
require("reflect-metadata");
// load external modules
const events_1 = require("events");
const node_coap_client_1 = require("node-coap-client");
// load internal modules
const accessory_1 = require("./lib/accessory");
const array_extensions_1 = require("./lib/array-extensions");
const endpoints_1 = require("./lib/endpoints");
const group_1 = require("./lib/group");
const logger_1 = require("./lib/logger");
const promises_1 = require("./lib/promises");
const scene_1 = require("./lib/scene");
const tradfri_error_1 = require("./lib/tradfri-error");
const tradfri_observer_1 = require("./lib/tradfri-observer");
class TradfriClient extends events_1.EventEmitter {
    constructor(hostname, securityCode, customLogger) {
        super();
        this.hostname = hostname;
        this.securityCode = securityCode;
        /** dictionary of CoAP observers */
        this.observedPaths = [];
        /** dictionary of known devices */
        this.devices = {};
        /** dictionary of known groups */
        this.groups = {};
        // prepare connection
        this.requestBase = `coaps://${hostname}:5684/`;
        node_coap_client_1.CoapClient.setSecurityParams(hostname, {
            psk: { Client_identity: securityCode },
        });
        if (customLogger != null)
            logger_1.setCustomLogger(customLogger);
    }
    /**
     * Try to establish a connection to the configured gateway.
     * Throws if the connection could not be established.
     * @param maxAttempts Number of connection attempts before giving up
     * @param attemptInterval Milliseconds to wait between connection attempts
     */
    connect(maxAttempts = 3, attemptInterval = 1000) {
        return __awaiter(this, void 0, void 0, function* () {
            if (maxAttempts < 1)
                throw new Error("At least one connection attempt must be made");
            if (attemptInterval < 0)
                throw new Error("The interval between two connection attempts must be positive");
            // Try a few times to setup a working connection
            for (let i = 1; i <= maxAttempts; i++) {
                if (yield node_coap_client_1.CoapClient.tryToConnect(this.requestBase)) {
                    break; // it worked
                }
                else if (i < maxAttempts) {
                    logger_1.log(`Could not connect to gateway, try #${i}`, "warn");
                    if (attemptInterval > 0)
                        yield promises_1.wait(attemptInterval);
                }
                else if (i === maxAttempts) {
                    // no working connection
                    throw new tradfri_error_1.TradfriError(`Could not connect to the gateway ${this.requestBase} after ${maxAttempts} tries!`, tradfri_error_1.TradfriErrorCodes.ConnectionFailed);
                }
            }
            // Done!
        });
    }
    /**
     * Observes a resource at the given url and calls the callback when the information is updated.
     * Prefer the specialized versions if possible.
     * @param path The path of the resource
     * @param callback The callback to be invoked when the resource updates
     */
    observeResource(path, callback) {
        return __awaiter(this, void 0, void 0, function* () {
            path = normalizeResourcePath(path);
            // check if we are already observing this resource
            const observerUrl = `${this.requestBase}${path}`;
            if (this.observedPaths.indexOf(observerUrl) > -1)
                return;
            // start observing
            this.observedPaths.push(observerUrl);
            return node_coap_client_1.CoapClient.observe(observerUrl, "get", callback);
        });
    }
    /**
     * Stops observing a resource that is being observed through `observeResource`
     * Use the specialized version of this method for observers that were set up with the specialized versions of `observeResource`
     * @param path The path of the resource
     */
    stopObservingResource(path) {
        path = normalizeResourcePath(path);
        // remove observer
        const observerUrl = `${this.requestBase}${path}`;
        const index = this.observedPaths.indexOf(observerUrl);
        if (index === -1)
            return;
        node_coap_client_1.CoapClient.stopObserving(observerUrl);
        this.observedPaths.splice(index, 1);
    }
    /**
     * Resets the underlying CoAP client and clears all observers
     */
    reset() {
        node_coap_client_1.CoapClient.reset();
        this.clearObservers();
    }
    /**
     * Clears the list of observers after a network reset
     * This does not stop observing the resources if the observers are still active
     */
    clearObservers() {
        this.observedPaths = [];
    }
    /** Sets up an observer for all devices */
    observeDevices() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.observer == null)
                this.observer = new tradfri_observer_1.TradfriObserver();
            yield this.observeResource(endpoints_1.endpoints.devices, this.observeDevices_callback);
            return this.observer.getAPI();
        });
    }
    observeDevices_callback(response) {
        return __awaiter(this, void 0, void 0, function* () {
            if (response.code.toString() !== "2.05") {
                logger_1.log(`unexpected response (${response.code.toString()}) to observeDevices.`, "error");
                return;
            }
            const newDevices = parsePayload(response);
            logger_1.log(`got all devices: ${JSON.stringify(newDevices)}`);
            // get old keys as int array
            const oldKeys = Object.keys(this.devices).map(k => +k).sort();
            // get new keys as int array
            const newKeys = newDevices.sort();
            // translate that into added and removed devices
            const addedKeys = array_extensions_1.except(newKeys, oldKeys);
            logger_1.log(`adding devices with keys ${JSON.stringify(addedKeys)}`, "debug");
            const observeDevicePromises = newKeys.map(id => {
                return this.observeResource(`${endpoints_1.endpoints.devices}/${id}`, (resp) => this.observeDevice_callback(id, resp));
            });
            yield Promise.all(observeDevicePromises);
            const removedKeys = array_extensions_1.except(oldKeys, newKeys);
            logger_1.log(`removing devices with keys ${JSON.stringify(removedKeys)}`, "debug");
            for (const id of removedKeys) {
                if (id in this.devices)
                    delete this.devices[id];
                // remove observer
                this.stopObservingResource(`${endpoints_1.endpoints.devices}/${id}`);
                // and notify all listeners about the removal
                this.observer.raise("device removed", id);
            }
        });
    }
    stopObservingDevices() {
        for (const path of this.observedPaths) {
            if (path.startsWith(endpoints_1.endpoints.devices)) {
                this.stopObservingResource(path);
            }
        }
    }
    // gets called whenever "get /15001/<instanceId>" updates
    observeDevice_callback(instanceId, response) {
        if (response.code.toString() !== "2.05") {
            logger_1.log(`unexpected response (${response.code.toString()}) to observeDevice(${instanceId}).`, "error");
            return;
        }
        const result = parsePayload(response);
        // parse device info
        const accessory = new accessory_1.Accessory().parse(result).createProxy();
        // remember the device object, so we can later use it as a reference for updates
        this.devices[instanceId] = accessory;
        // and notify all listeners about the update
        this.observer.raise("device updated", accessory);
    }
    /** Sets up an observer for all groups */
    observeGroupsAndScenes() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.observer == null)
                this.observer = new tradfri_observer_1.TradfriObserver();
            yield this.observeResource(endpoints_1.endpoints.groups, this.observeGroups_callback);
            return this.observer.getAPI();
        });
    }
    // gets called whenever "get /15004" updates
    observeGroups_callback(response) {
        return __awaiter(this, void 0, void 0, function* () {
            if (response.code.toString() !== "2.05") {
                logger_1.log(`unexpected response (${response.code.toString()}) to getAllGroups.`, "error");
                return;
            }
            const newGroups = parsePayload(response);
            logger_1.log(`got all groups: ${JSON.stringify(newGroups)}`);
            // get old keys as int array
            const oldKeys = Object.keys(this.groups).map(k => +k).sort();
            // get new keys as int array
            const newKeys = newGroups.sort();
            // translate that into added and removed devices
            const addedKeys = array_extensions_1.except(newKeys, oldKeys);
            logger_1.log(`adding groups with keys ${JSON.stringify(addedKeys)}`, "debug");
            const observeGroupPromises = newKeys.map(id => {
                return this.observeResource(`${endpoints_1.endpoints.groups}/${id}`, (resp) => this.observeGroup_callback(id, resp));
            });
            yield Promise.all(observeGroupPromises);
            const removedKeys = array_extensions_1.except(oldKeys, newKeys);
            logger_1.log(`removing groups with keys ${JSON.stringify(removedKeys)}`, "debug");
            removedKeys.forEach((id) => __awaiter(this, void 0, void 0, function* () {
                if (id in this.groups)
                    delete this.groups[id];
                // remove observers
                this.stopObservingGroup(id);
                // and notify all listeners about the removal
                this.observer.raise("group removed", id);
            }));
        });
    }
    stopObservingGroups() {
        for (const id of Object.keys(this.groups)) {
            this.stopObservingGroup(+id);
        }
    }
    stopObservingGroup(instanceId) {
        this.stopObservingResource(`${endpoints_1.endpoints.groups}/${instanceId}`);
        const scenesPrefix = `${endpoints_1.endpoints.scenes}/${instanceId}`;
        for (const path of this.observedPaths) {
            if (path.startsWith(scenesPrefix)) {
                this.stopObservingResource(path);
            }
        }
    }
    // gets called whenever "get /15004/<instanceId>" updates
    observeGroup_callback(instanceId, response) {
        return __awaiter(this, void 0, void 0, function* () {
            // check response code
            switch (response.code.toString()) {
                case "2.05": break; // all good
                case "4.04":// not found
                    // We know this group existed or we wouldn't have requested it
                    // This means it has been deleted
                    // TODO: Should we delete it here or where its being handled right now?
                    return;
                default:
                    logger_1.log(`unexpected response (${response.code.toString()}) to getGroup(${instanceId}).`, "error");
                    return;
            }
            const result = parsePayload(response);
            // parse group info
            const group = (new group_1.Group()).parse(result).createProxy();
            // remember the group object, so we can later use it as a reference for updates
            let groupInfo;
            if (!(instanceId in this.groups)) {
                // if there's none, create one
                this.groups[instanceId] = {
                    group: null,
                    scenes: {},
                };
            }
            groupInfo = this.groups[instanceId];
            groupInfo.group = group;
            // notify all listeners about the update
            this.observer.raise("group updated", group);
            // load scene information
            this.observeResource(`${endpoints_1.endpoints.scenes}/${instanceId}`, (resp) => this.observeScenes_callback(instanceId, resp));
        });
    }
    // gets called whenever "get /15005/<groupId>" updates
    observeScenes_callback(groupId, response) {
        return __awaiter(this, void 0, void 0, function* () {
            if (response.code.toString() !== "2.05") {
                logger_1.log(`unexpected response (${response.code.toString()}) to observeScenes(${groupId}).`, "error");
                return;
            }
            const groupInfo = this.groups[groupId];
            const newScenes = parsePayload(response);
            logger_1.log(`got all scenes in group ${groupId}: ${JSON.stringify(newScenes)}`);
            // get old keys as int array
            const oldKeys = Object.keys(groupInfo.scenes).map(k => +k).sort();
            // get new keys as int array
            const newKeys = newScenes.sort();
            // translate that into added and removed devices
            const addedKeys = array_extensions_1.except(newKeys, oldKeys);
            logger_1.log(`adding scenes with keys ${JSON.stringify(addedKeys)} to group ${groupId}`, "debug");
            const observeScenePromises = newKeys.map(id => {
                return this.observeResource(`${endpoints_1.endpoints.scenes}/${groupId}/${id}`, (resp) => this.observeScene_callback(groupId, id, resp));
            });
            yield Promise.all(observeScenePromises);
            const removedKeys = array_extensions_1.except(oldKeys, newKeys);
            logger_1.log(`removing scenes with keys ${JSON.stringify(removedKeys)} from group ${groupId}`, "debug");
            removedKeys.forEach(id => {
                // remove scene from dictionary
                if (id in groupInfo.scenes)
                    delete groupInfo.scenes[id];
                // remove observers
                this.stopObservingResource(`${endpoints_1.endpoints.scenes}/${groupId}/${id}`);
                // and notify all listeners about the removal
                this.observer.raise("scene removed", groupId, id);
            });
        });
    }
    // gets called whenever "get /15005/<groupId>/<instanceId>" updates
    observeScene_callback(groupId, instanceId, response) {
        // check response code
        switch (response.code.toString()) {
            case "2.05": break; // all good
            case "4.04":// not found
                // We know this scene existed or we wouldn't have requested it
                // This means it has been deleted
                // TODO: Should we delete it here or where its being handled right now?
                return;
            default:
                logger_1.log(`unexpected response (${response.code.toString()}) to observeScene(${groupId}, ${instanceId}).`, "error");
                return;
        }
        const result = parsePayload(response);
        // parse scene info
        const scene = (new scene_1.Scene()).parse(result).createProxy();
        // remember the scene object, so we can later use it as a reference for updates
        this.groups[groupId].scenes[instanceId] = scene;
        // and notify all listeners about the update
        this.observer.raise("scene updated", groupId, scene);
    }
    /**
     * Pings the gateway to check if it is alive
     * @param timeout - (optional) Timeout in ms, after which the ping is deemed unanswered. Default: 5000ms
     */
    ping(timeout) {
        return node_coap_client_1.CoapClient.ping(this.requestBase, timeout);
    }
}
exports.TradfriClient = TradfriClient;
/** Normalizes the path to a resource, so it can be used for storing the observer */
function normalizeResourcePath(path) {
    path = path || "";
    while (path.startsWith("/"))
        path = path.substring(1);
    while (path.endsWith("/"))
        path = path.substring(0, -1);
    return path;
}
function parsePayload(response) {
    switch (response.format) {
        case 0: // text/plain
        case null:// assume text/plain
            return response.payload.toString("utf-8");
        case 50:// application/json
            const json = response.payload.toString("utf-8");
            return JSON.parse(json);
        default:
            // dunno how to parse this
            logger_1.log(`unknown CoAP response format ${response.format}`, "warn");
            return response.payload;
    }
}