"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrayerMangerValidator = void 0;
const prayers_model_1 = require("../models/prayers.model");
//import * as prayer from "@dpanet/prayers-lib/lib/entities/prayer";
const joi_1 = __importDefault(require("@hapi/joi"));
class PrayerMangerValidator extends prayers_model_1.Validator {
    constructor() {
        super("PrayerManagerValidator");
        this.setSchema();
    }
    setSchema() {
        this._prayerManagerSchema = joi_1.default.any()
            .required()
            .label("Prayer Manager")
            .messages(this.customErrorMessage());
    }
    validate(validateObject) {
        return super.genericValidator(this._prayerManagerSchema.validate(validateObject, { abortEarly: false, allowUnknown: true }));
    }
    static createValidator() {
        return new PrayerMangerValidator();
    }
}
exports.PrayerMangerValidator = PrayerMangerValidator;
__exportStar(require("@dpanet/prayers-lib/lib/validators/interface.validators.js"), exports);
__exportStar(require("@dpanet/prayers-lib/lib/validators/validator.js"), exports);
