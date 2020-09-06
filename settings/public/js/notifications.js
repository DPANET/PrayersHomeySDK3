"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadNotification = exports.notify = void 0;
const noty_1 = __importDefault(require("noty"));
function notify(type, message) {
    let noty = loadNotification();
    noty.setType(type, true);
    noty.setText(message, true);
    noty.show();
}
exports.notify = notify;
function loadNotification() {
    return new noty_1.default({
        layout: 'top',
        theme: "bootstrap-v4",
        type: "error",
        text: 'Test Hi',
        force: false,
        timeout: false,
        progressBar: false,
        animation: {
            open: 'animated slideInDown',
            close: 'animated slideOutUp' // Animate.css class names
        },
        closeWith: ['click', 'button'],
        modal: false,
        killer: false,
    });
}
exports.loadNotification = loadNotification;
