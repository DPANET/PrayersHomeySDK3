"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExceptionMiddleware = void 0;
class ExceptionMiddleware {
    constructor() {
    }
    errorMiddleware(error, request, response, next) {
        const status = error.status || 500;
        const message = error.message || 'Something went wrong';
        response
            .status(status)
            .send({
            status,
            message,
        });
    }
}
exports.ExceptionMiddleware = ExceptionMiddleware;
