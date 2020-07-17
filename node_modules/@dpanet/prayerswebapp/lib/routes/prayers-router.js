"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
exports.router = express_1.default();
exports.router.use(express_1.default.static('lib/public'));
var file = require.resolve('../index.html');
exports.router.get('/', (req, res) => {
    // res.sendFile(__dirname+"/index.html");
    //   res.sendFile(file,);
    res.json({ welcome: "Hi" });
    //res.json({a:5});
});
exports.router.get('/prayers');
