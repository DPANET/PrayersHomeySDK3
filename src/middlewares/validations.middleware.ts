import config from 'nconf';
const debug = require('debug')('app:router');

import * as exceptionHandler from '../exceptions/exception.handler';

import * as validators from '../validators/validations';
import * as sentry from "@sentry/node/dist/index"
sentry.init({ dsn: config.get("DSN") });
export const enum ParameterType {
    query = 0,
    body
}
export class ValidationMiddleware {
    constructor() {
    }

    public validationMiddlewareByRequest<T>(validator: validators.IValid<T>, prameterType: ParameterType): boolean {
        let result: boolean = false;
        let err: validators.IValidationError;
        let message: string[];
        let object: any;
        switch (result) {
            case result:
                return true;
                break;
            case false:
                err = validator.getValidationError();
                if (err.name === "ValidationError")
                    message = err.details.map((detail: any) => `${detail.value.label} with value ${detail.value.value}: ${detail.message}`);
                debug(message);
                sentry.captureException(err);
                throw (new exceptionHandler.HttpException(400, message.reduce((prvs, curr) => prvs.concat('\r\n', curr))));
                      
            }
        
    }
    public validationMiddlewareByObject<T>(validator: validators.IValid<T>, validObject: T): boolean {
       
        let result: boolean = false;
        let err: validators.IValidationError;
        let message: string[];
        console.log("running validation")
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
                    message = err.details.map((detail: any) => `${detail.value.label} with value ${detail.value.value}: ${detail.message}`);
                debug(message);
                sentry.captureException(err);
                throw (new exceptionHandler.HttpException(400, message.reduce((prvs, curr) => prvs.concat('\r\n', curr))));
                      
            }
        
        
    }

}