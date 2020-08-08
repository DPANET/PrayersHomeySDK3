"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.App = void 0;
//import helmet from "helmet";
//import proxy from "http-proxy-middleware";
class App {
    constructor(controllers) {
        this.app = new Array();
        this.initializeControllers(controllers);
    }
    initializeControllers(controllers) {
        controllers.forEach((controller) => {
            this.app.push(controller);
        });
    }
}
exports.App = App;
