"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ValidationMiddleware = void 0;
const nconf_1 = __importDefault(require("nconf"));
const debug = require('debug')('app:router');
const exceptionHandler = __importStar(require("../exceptions/exception.handler"));
const sentry = __importStar(require("@sentry/node/dist/index"));
sentry.init({ dsn: nconf_1.default.get("DSN") });
class ValidationMiddleware {
    constructor() {
    }
    validationMiddlewareByRequest(validator, prameterType) {
        let result = false;
        let err;
        let message;
        let object;
        switch (result) {
            case result:
                return true;
                break;
            case false:
                err = validator.getValidationError();
                if (err.name === "ValidationError")
                    message = err.details.map((detail) => `${detail.value.label} with value ${detail.value.value}: ${detail.message}`);
                debug(message);
                sentry.captureException(err);
                throw (new exceptionHandler.HttpException(400, message.reduce((prvs, curr) => prvs.concat('\r\n', curr))));
        }
    }
    validationMiddlewareByObject(validator, validObject) {
        let result = false;
        let err;
        let message;
        console.log("running validation");
        result = validator.validate(validObject);
        console.log("Result of test " + result);
        debug(`object Validation Result is ${result} for ${validObject} `);
        switch (result) {
            case true:
                return true;
                break;
            case false:
                err = validator.getValidationError();
                if (err.name === "ValidationError")
                    message = err.details.map((detail) => `${detail.value.label} with value ${detail.value.value}: ${detail.message}`);
                debug(message);
                sentry.captureException(err);
                throw (new exceptionHandler.HttpException(400, message.reduce((prvs, curr) => prvs.concat('\r\n', curr))));
        }
    }
}
exports.ValidationMiddleware = ValidationMiddleware;
