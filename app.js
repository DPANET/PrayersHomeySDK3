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
const Homey = require("homey");
const config = require("nconf");
config.file('env.json');
process.env.DEBUG = config.get("DEBUG");
const fs_extra_1 = __importDefault(require("fs-extra"));
cloneConfig();
const manager = __importStar(require("./prayers/manager"));
const prayers_controller_1 = __importDefault(require("@dpanet/prayerswebapp/lib/controllers/prayers.controller"));
const main_controller_1 = __importDefault(require("@dpanet/prayerswebapp/lib/controllers/main.controller"));
const keys_controller_1 = __importDefault(require("@dpanet/prayerswebapp/lib/controllers/keys.controller"));
const main_router_1 = require("@dpanet/prayerswebapp/lib/routes/main.router");
const sentry = __importStar(require("@sentry/node"));
sentry.init({ dsn: config.get("DSN") });
class PrayersApp extends Homey.App {
    onInit() {
        try {
            this.log(` Prayers Alert App is running! `);
            let app = new main_router_1.App([new prayers_controller_1.default(), new main_controller_1.default(), new keys_controller_1.default()]);
            setTimeout(() => {
                app.listen();
            }, 5000);
            manager.PrayersAppManager.initApp();
        }
        catch (err) {
            sentry.captureException(err);
            this.log(err);
        }
    }
}
function cloneConfig() {
    fs_extra_1.default.copySync(Homey.env.NODE_CONFIG_DIR, Homey.env.CONFIG_FOLDER_PATH, { overwrite: false });
}
module.exports = PrayersApp;
