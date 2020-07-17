"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require('dotenv').config();
const debug = require('debug')('app:router');
const express_1 = __importDefault(require("express"));
const config_1 = __importDefault(require("config"));
class KeyController {
    constructor() {
        this.placesRouter = (request, response) => {
            response.json(this._googleKey);
        };
        this.path = "/Keys";
        this.router = express_1.default.Router();
        this._googleKey = config_1.default.get("GOOGLE_PLACE_KEY");
        this.initializeRoutes();
    }
    initializeRoutes() {
        this.router.get(this.path + "/Places/", this.placesRouter);
    }
}
exports.default = KeyController;
//# sourceMappingURL=key.controller.js.map