"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const nconf_1 = __importDefault(require("nconf"));
const debug = require('debug')('app:router');
const exceptionHandler = __importStar(require("../exceptions/exception.handler"));
const sentry = __importStar(require("@sentry/node"));
sentry.init({ dsn: nconf_1.default.get("DSN") });
class ValidationMiddleware {
    constructor() {
    }
    validationMiddlewareByRequest(validator, prameterType) {
        let result = false;
        let err;
        let message;
        let object;
        return (req, res, next) => {
            if (prameterType === 1 /* body */)
                object = req.body;
            else
                object = req.query;
            debug(`validation the following object: ${object}`);
            result = validator.validate(object);
            switch (result) {
                case true:
                    next();
                    break;
                case false:
                    err = validator.getValidationError();
                    if (err.name === "ValidationError")
                        message = err.details.map((detail) => `${detail.value.label} with value ${detail.value.value}: ${detail.message}`);
                    debug(message);
                    sentry.captureException(err);
                    next(new exceptionHandler.HttpException(400, message.reduce((prvs, curr) => prvs.concat('\r\n', curr))));
                    break;
            }
        };
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
