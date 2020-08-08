"use strict";
function __export(m) {
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
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
__export(require("@dpanet/prayers-lib/lib/validators/interface.validators.js"));
__export(require("@dpanet/prayers-lib/lib/validators/validator.js"));
