"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
console.log("I'm Running**************");
const Homey = require("homey");
const config = require("nconf");
config.file('env.json');
const manager = __importStar(require("./prayers/manager"));
const prayers_controller_1 = __importDefault(require("./controllers/prayers.controller"));
const configuration_controller_1 = __importDefault(require("./configurations/configuration.controller"));
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
            manager.PrayersAppManager.initApp(this.homey, this._homeyConfigurator);
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
        //console.log(util.inspect(this._prayersController.router.getPrayers(), {showHidden: false, depth: null}))
        //console.log(this._prayersController.router.getPrayers());
        return this._prayersController.router.getPrayers();
    }
    getPrayersView() {
        return this._prayersController.router.getPrayersView();
    }
    async getPrayersByCalculation(config) {
        return await this._prayersController.router.getPrayersByCalculation(config);
    }
    async loadSettings() {
        await this._prayersController.router.loadSettings();
    }
    async setPrayersByCalculation(config) {
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
        try {
            //  this.homey.settings.unset(ConfigSettingsKeys.LocationConfigKey);
            //this.homey.settings.unset(ConfigSettingsKeys.PrayersConfigKey);
            this._homeyConfigurator = prayerlib.ConfigProviderFactory.createConfigProviderFactory(configuration_controller_1.default, this.homey);
            this._iConfig = await this._homeyConfigurator.getConfig();
        }
        catch (err) {
            // await this._homeyConfigurator.createDefaultConfig()
            console.log(err);
        }
    }
}
module.exports = PrayersApp;
