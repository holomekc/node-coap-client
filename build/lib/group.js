"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const conversions_1 = require("./conversions");
const ipsoDevice_1 = require("./ipsoDevice");
const ipsoObject_1 = require("./ipsoObject");
const math_1 = require("./math");
const scene_1 = require("./scene");
class Group extends ipsoDevice_1.IPSODevice {
    // =================================
    // Simplified API access
    /**
     * Ensures this instance is linked to a tradfri client and an accessory
     * @throws Throws an error if it isn't
     */
    ensureLink() {
        if (this.client == null) {
            throw new Error("Cannot use the simplified API on groups which aren't linked to a client instance.");
        }
    }
    /** Turn all lightbulbs on */
    turnOn() {
        return __awaiter(this, void 0, void 0, function* () {
            this.ensureLink();
            return this.client.operateGroup(this, {
                onOff: true,
            });
        });
    }
    /** Turn all lightbulbs off */
    turnOff() {
        return __awaiter(this, void 0, void 0, function* () {
            this.ensureLink();
            return this.client.operateGroup(this, {
                onOff: false,
            });
        });
    }
    /** Set all lightbulbs on/off to the given state */
    toggle(value) {
        return __awaiter(this, void 0, void 0, function* () {
            this.ensureLink();
            return this.client.operateGroup(this, {
                onOff: value,
            });
        });
    }
    /** Activates the given scene */
    activateScene(sceneOrId) {
        return __awaiter(this, void 0, void 0, function* () {
            this.ensureLink();
            const id = (sceneOrId instanceof scene_1.Scene) ? sceneOrId.instanceId : sceneOrId;
            return this.client.operateGroup(this, {
                sceneId: id,
            });
        });
    }
    operateGroup(operation, transitionTime) {
        return __awaiter(this, void 0, void 0, function* () {
            if (transitionTime != null) {
                transitionTime = Math.max(0, transitionTime);
                operation.transitionTime = transitionTime;
            }
            return this.client.operateGroup(this, operation);
        });
    }
    /**
     * Changes this lightbulb's brightness
     * @returns true if a request was sent, false otherwise
     */
    setBrightness(value, transitionTime) {
        return __awaiter(this, void 0, void 0, function* () {
            this.ensureLink();
            value = math_1.clamp(value, 0, 100);
            return this.operateGroup({
                dimmer: value,
            }, transitionTime);
        });
    }
}
__decorate([
    ipsoObject_1.ipsoKey("5850"),
    ipsoObject_1.required((me, ref) => ref != null && me.sceneId !== ref.sceneId) // force on/off to be present if sceneId is
    ,
    __metadata("design:type", Boolean)
], Group.prototype, "onOff", void 0);
__decorate([
    ipsoObject_1.ipsoKey("5851"),
    ipsoObject_1.serializeWith(conversions_1.serializers.brightness),
    ipsoObject_1.deserializeWith(conversions_1.deserializers.brightness),
    __metadata("design:type", Number)
], Group.prototype, "dimmer", void 0);
__decorate([
    ipsoObject_1.ipsoKey("9039"),
    __metadata("design:type", Number)
], Group.prototype, "sceneId", void 0);
__decorate([
    ipsoObject_1.ipsoKey("9018"),
    ipsoObject_1.deserializeWith(obj => parseAccessoryLink(obj)),
    ipsoObject_1.serializeWith(ids => toAccessoryLink(ids), false),
    __metadata("design:type", Array)
], Group.prototype, "deviceIDs", void 0);
__decorate([
    ipsoObject_1.ipsoKey("5712")
    // force transition time to be present if brightness is
    // all other properties don't support the transition time
    ,
    ipsoObject_1.required((me, ref) => ref != null && me.dimmer !== ref.dimmer),
    ipsoObject_1.serializeWith(conversions_1.serializers.transitionTime),
    ipsoObject_1.deserializeWith(conversions_1.deserializers.transitionTime),
    __metadata("design:type", Number)
], Group.prototype, "transitionTime", void 0);
exports.Group = Group;
// TODO: Type annotation
function parseAccessoryLink(link) {
    const hsLink = link["15002"];
    const deviceIDs = hsLink["9003"];
    return deviceIDs;
}
function toAccessoryLink(ids) {
    return {
        15002: {
            9003: ids,
        },
    };
}