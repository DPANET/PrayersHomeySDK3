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
console.log("I'm Running**************");
const Homey = require("homey");
const config = require("nconf");
config.file('env.json');
const prayers_controller_1 = __importDefault(require("./controllers/prayers.controller"));
const configuration_controller_1 = __importDefault(require("./configurations/configuration.controller"));
console.log("running prayers controller clonning file is running");
const sentry = __importStar(require("@sentry/node"));
const prayerlib = __importStar(require("@dpanet/prayers-lib"));
sentry.init({ dsn: config.get("DSN") });
class PrayersApp extends Homey.App {
    async onInit() {
        try {
            this.log(` Prayers Alert App is running! `);
            this.initalizeConfig();
            this._prayersController = new prayers_controller_1.default(this._homeyConfigurator);
            await this._prayersController.initializePrayerManger();
            // manager.PrayersAppManager.initApp(this.homey);
            this.log('I ran successfully');
        }
        catch (err) {
            sentry.captureException(err);
            this.log(err);
        }
    }
    getPrayersAdjustments() {
        return this._prayersController.router.getPrayersAdjustments();
    }
    getPrayersSettings() {
        return this._prayersController.router.getPrayersSettings();
    }
    getPrayers() {
        return this._prayersController.router.getPrayers();
    }
    getPrayersView() {
        return this._prayersController.router.getPrayersView();
    }
    async getPrayersByCalculation(config) {
        console.log(config);
        return await this._prayersController.router.getPrayersByCalculation(config);
    }
    async loadSettings() {
        await this._prayersController.router.loadSettings();
    }
    async setPrayersByCalculation(config) {
        console.log(config);
        return await this._prayersController.router.setPrayersByCalculation(config);
    }
    getPrayersLocationSettings() {
        return this._prayersController.router.getPrayersLocationSettings();
    }
    async searchLocation(locationConfig) {
        return await this._prayersController.router.searchLocation(locationConfig);
    }
    async initalizeConfig() {
        //fs.copySync(Homey.env.NODE_CONFIG_DIR, Homey.env.CONFIG_FOLDER_PATH, { overwrite: false });
        this._homeyConfigurator = prayerlib.ConfigProviderFactory.createConfigProviderFactory(configuration_controller_1.default, this.homey);
        if (prayerlib.isNullOrUndefined(this._homeyConfigurator.getConfig())) {
            this._homeyConfigurator.createDefaultConfig();
        }
    }
}
module.exports = PrayersApp;
