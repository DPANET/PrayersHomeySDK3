"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
class UpcomingPrayerNotFoundException extends Error {
    constructor(message) {
        super(message);
        this.name = "UpcomingPrayerNotFoundException";
    }
}
exports.UpcomingPrayerNotFoundException = UpcomingPrayerNotFoundException;
class PrayerProviderNotStaterdException extends Error {
    constructor(message) {
        super(message);
        this.name = "PrayerProviderNotStaterdException";
    }
}
exports.PrayerProviderNotStaterdException = PrayerProviderNotStaterdException;
class PrayerManagerNotStaterdException extends Error {
    constructor(message) {
        super(message);
        this.name = "PrayerManagerNotStaterdException";
    }
}
exports.PrayerManagerNotStaterdException = PrayerManagerNotStaterdException;
