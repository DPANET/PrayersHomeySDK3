"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WrongAuthenticationTokenException = exports.AuthenticationTokenMissingException = exports.PostNotFoundException = exports.WrongCredentialsException = exports.UserWithThatEmailAlreadyExistsException = exports.HttpException = void 0;
class HttpException extends Error {
    constructor(status, message) {
        super(message);
    }
}
exports.HttpException = HttpException;
class UserWithThatEmailAlreadyExistsException extends HttpException {
    constructor(email) {
        super(404, `user with email ${email} not found`);
    }
}
exports.UserWithThatEmailAlreadyExistsException = UserWithThatEmailAlreadyExistsException;
class WrongCredentialsException extends HttpException {
    constructor() {
        super(404, `Wrong Password provided`);
    }
}
exports.WrongCredentialsException = WrongCredentialsException;
class PostNotFoundException extends HttpException {
    constructor(id) {
        super(404, `Post with id ${id} not found`);
    }
}
exports.PostNotFoundException = PostNotFoundException;
class AuthenticationTokenMissingException extends HttpException {
    constructor() {
        super(404, 'Authentication Token Missing');
    }
}
exports.AuthenticationTokenMissingException = AuthenticationTokenMissingException;
class WrongAuthenticationTokenException extends HttpException {
    constructor() {
        super(404, 'Authentication Token Missing');
    }
}
exports.WrongAuthenticationTokenException = WrongAuthenticationTokenException;
