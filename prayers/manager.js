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
exports.appmanager = exports.PrayersAppManager = void 0;
//const debug = require('debug')(process.env.DEBUG);
const config = require("nconf");
const prayerlib = __importStar(require("@dpanet/prayers-lib"));
const events = __importStar(require("./events"));
const homey_1 = __importDefault(require("homey"));
const util_1 = require("util");
const sentry = __importStar(require("@sentry/node"));
sentry.init({ dsn: config.get("DSN") });
//const to = require('await-to-js').default;
const athanTypes = { athan_short: "assets/prayers/prayer_short.mp3", athan_full: "assets/prayers/prayer_full.mp3" };
class PrayersAppManager {
    get prayerEventProvider() {
        return this._prayerEventProvider;
    }
    set prayerEventProvider(value) {
        this._prayerEventProvider = value;
    }
    static get prayerAppManger() {
        if (!util_1.isNullOrUndefined(PrayersAppManager._prayerAppManger))
            return PrayersAppManager._prayerAppManger;
        else {
            PrayersAppManager._prayerAppManger = new PrayersAppManager();
            return PrayersAppManager._prayerAppManger;
        }
    }
    static set prayerAppManger(value) {
        PrayersAppManager._prayerAppManger = value;
    }
    get prayerManager() {
        return this._prayerManager;
    }
    set prayerManager(value) {
        this._prayerManager = value;
    }
    // private  _prayerEvents:prayerlib.
    static async initApp(homey, configProvider) {
        try {
            exports.appmanager._prayerConfig = await configProvider.getPrayerConfig();
            exports.appmanager._locationConfig = await configProvider.getLocationConfig();
            exports.appmanager._prayerManager = await prayerlib.PrayerTimeBuilder
                .createPrayerTimeBuilder(exports.appmanager._locationConfig, exports.appmanager._prayerConfig)
                //.setPrayerMethod(prayerlib.Methods.Mecca)
                //  .setPrayerPeriod(prayerlib.DateUtil.getNowDate(), prayerlib.DateUtil.addDay(1, prayerlib.DateUtil.getNowDate()))
                //   .setLocationByCoordinates(Homey.ManagerGeolocation.getLatitude(), Homey.ManagerGeolocation.getLongitude())
                .createPrayerTimeManager();
            console.log("InitApp is running");
            this._prayerAppManger._homey = homey;
            this._prayerAppManger._configProvider = configProvider;
            exports.appmanager.initPrayersSchedules();
            exports.appmanager.initEvents();
            console.log(prayerlib.DateUtil.getNowTime());
            console.log(exports.appmanager._prayerManager.getUpcomingPrayer(prayerlib.DateUtil.getNowTime()));
        }
        catch (err) {
            sentry.captureException(err);
            console.log(err);
        }
    }
    // initallize prayer scheduling and refresh events providers and listeners
    initPrayersSchedules() {
        console.log("Prayer Schedule  Are being Initatized");
        //  this._coinfigFilePath =path.join(config.get("CONFIG_FOLDER_PATH"),config.get("PRAYER_CONFIG")) ;
        this._prayerEventProvider = new events.PrayersEventProvider(this._prayerManager);
        this._prayerEventListener = new events.PrayersEventListener(this);
        this._prayerEventProvider.registerListener(this._prayerEventListener);
        this._prayerEventProvider.startPrayerSchedule();
        this._prayersRefreshEventProvider = new events.PrayersRefreshEventProvider(this._prayerManager);
        this._prayersRefreshEventListener = new events.PrayerRefreshEventListener(this);
        this._prayersRefreshEventProvider.registerListener(this._prayersRefreshEventListener);
        this._configEventProvider = new events.ConfigEventProvider(this._homey);
        this._configEventListener = new events.ConfigEventListener(this);
        this._configEventProvider.registerListener(this._configEventListener);
    }
    //schedule refresh of prayers schedule based on date 
    scheduleRefresh(date) {
        this._prayersRefreshEventProvider.startPrayerRefreshSchedule(date);
    }
    //initialize Homey Events
    initEvents() {
        this._homeyPrayersTriggerAll = this._homey.flow.getTriggerCard('prayer_trigger_all');
        this._homeyPrayersTriggerSpecific = this._homey.flow.getTriggerCard('prayer_trigger_specific');
        this._homeyPrayersAthanAction = this._homey.flow.getActionCard('athan_action');
        this._homeyPrayersTriggerAll.registerRunListener(async (args, state) => {
            return true;
        });
        this._homeyPrayersAthanAction
            //.register()
            .registerRunListener(async (args, state) => {
            this.playAthan(args.athan_dropdown, athanTypes[args.athan_dropdown])
                .then((value) => {
                console.log(value);
                return value;
            })
                .catch((err) => {
                sentry.captureException(err);
                console.log(err);
                return Promise.resolve(false);
            });
        });
        this._homeyPrayersTriggerSpecific
            //.register()
            .registerRunListener(async (args, state) => {
            return (args.athan_dropdown === state.prayer_name);
        });
    }
    //play athan based on trigger
    async playAthan(sampleId, fileName) {
        console.log(sampleId);
        let err, result;
        homey_1.default.ManagerAudio.playMp3(sampleId, fileName)
            .then(() => {
            console.log(err);
            sentry.captureException(err);
            return Promise.resolve(false);
        })
            .catch((err) => {
            console.log(err);
            sentry.captureException(err);
            return Promise.resolve(true);
        });
        return Promise.resolve(true);
    }
    //trigger homey event based on prayer scheduling event.
    triggerEvent(prayerName, prayerTime) {
        let timeZone = this._prayerManager.getPrayerTimeZone().timeZoneId;
        let prayerTimeZone = prayerlib.DateUtil.getDateByTimeZone(prayerTime, timeZone);
        this._homeyPrayersTriggerAll
            .trigger({ prayer_name: prayerName, prayer_time: prayerTimeZone }, null)
            .then(() => console.log('event all run'))
            .catch((err) => {
            this.prayerEventProvider.stopPrayerSchedule();
            sentry.captureException(err);
            console.log(err);
        });
        this._homeyPrayersTriggerSpecific.trigger({ prayer_name: prayerName, prayer_time: prayerTimeZone }, null)
            .then(() => console.log('event specific run'))
            .catch((err) => {
            this.prayerEventProvider.stopPrayerSchedule();
            sentry.captureException(err);
            console.log(err);
        });
    }
    //refresh prayer manager in case we reach the end of the array.
    refreshPrayerManagerByDate() {
        let startDate = prayerlib.DateUtil.getNowDate();
        let endDate = prayerlib.DateUtil.addMonth(1, startDate);
        this.prayerManager.updatePrayersDate(startDate, endDate)
            .then((value) => {
            this.prayerEventProvider.startPrayerSchedule(value);
            // this._prayerManager = value;
        })
            //retry every date until the prayer refresh task is done.
            .catch((err) => {
            console.log(err);
            sentry.captureException(err);
            let date = prayerlib.DateUtil.addDay(1, startDate);
            this.scheduleRefresh(date);
        });
    }
    async refreshPrayerManagerByConfig() {
        let startDate = prayerlib.DateUtil.getNowDate();
        let endDate = prayerlib.DateUtil.addMonth(1, startDate);
        try {
            exports.appmanager._prayerConfig = await this._configProvider.getPrayerConfig();
            exports.appmanager._locationConfig = await this._configProvider.getLocationConfig();
            exports.appmanager._prayerManager = await prayerlib.PrayerTimeBuilder
                .createPrayerTimeBuilder(exports.appmanager._locationConfig, exports.appmanager._prayerConfig)
                // .setLocationByCoordinates(Homey.ManagerGeolocation.getLatitude(), Homey.ManagerGeolocation.getLongitude())
                .createPrayerTimeManager();
            this.prayerEventProvider.startPrayerSchedule(exports.appmanager._prayerManager);
        }
        catch (err) {
            console.log(err);
            sentry.captureException(err);
            let date = prayerlib.DateUtil.addDay(1, startDate);
            this.scheduleRefresh(date);
        }
    }
}
exports.PrayersAppManager = PrayersAppManager;
exports.appmanager = PrayersAppManager.prayerAppManger;
