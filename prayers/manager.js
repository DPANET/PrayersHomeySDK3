"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const debug = require('debug')(process.env.DEBUG);
const config = require("nconf");
const prayerlib = __importStar(require("@dpanet/prayers-lib"));
const events = __importStar(require("./events"));
const Homey = require("homey");
const util_1 = require("util");
const path_1 = __importDefault(require("path"));
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
    static async initApp() {
        try {
            exports.appmanager._prayerConfig = await new prayerlib.Configurator().getPrayerConfig();
            exports.appmanager._locationConfig = await new prayerlib.Configurator().getLocationConfig();
            exports.appmanager._prayerManager = await prayerlib.PrayerTimeBuilder
                .createPrayerTimeBuilder(exports.appmanager._locationConfig, exports.appmanager._prayerConfig)
                //.setPrayerMethod(prayerlib.Methods.Mecca)
                //  .setPrayerPeriod(prayerlib.DateUtil.getNowDate(), prayerlib.DateUtil.addDay(1, prayerlib.DateUtil.getNowDate()))
                //   .setLocationByCoordinates(Homey.ManagerGeolocation.getLatitude(), Homey.ManagerGeolocation.getLongitude())
                .createPrayerTimeManager();
            exports.appmanager.initPrayersSchedules();
            exports.appmanager.initEvents();
            console.log(exports.appmanager._prayerManager.getUpcomingPrayer());
        }
        catch (err) {
            sentry.captureException(err);
            console.log(err);
        }
    }
    // initallize prayer scheduling and refresh events providers and listeners
    initPrayersSchedules() {
        this._coinfigFilePath = path_1.default.join(config.get("CONFIG_FOLDER_PATH"), config.get("PRAYER_CONFIG"));
        this._prayerEventProvider = new events.PrayersEventProvider(this._prayerManager);
        this._prayerEventListener = new events.PrayersEventListener(this);
        this._prayerEventProvider.registerListener(this._prayerEventListener);
        this._prayerEventProvider.startPrayerSchedule();
        this._prayersRefreshEventProvider = new events.PrayersRefreshEventProvider(this._prayerManager);
        this._prayersRefreshEventListener = new events.PrayerRefreshEventListener(this);
        this._prayersRefreshEventProvider.registerListener(this._prayersRefreshEventListener);
        this._configEventProvider = new events.ConfigEventProvider(this._coinfigFilePath);
        this._configEventListener = new events.ConfigEventListener(this);
        this._configEventProvider.registerListener(this._configEventListener);
    }
    //schedule refresh of prayers schedule based on date 
    scheduleRefresh(date) {
        this._prayersRefreshEventProvider.startPrayerRefreshSchedule(date);
    }
    //initialize Homey Events
    initEvents() {
        this._homeyPrayersTriggerAll = new Homey.FlowCardTrigger('prayer_trigger_all');
        this._homeyPrayersTriggerSpecific = new Homey.FlowCardTrigger('prayer_trigger_specific');
        this._homeyPrayersAthanAction = new Homey.FlowCardAction('athan_action');
        this._homeyPrayersTriggerAll.register();
        this._homeyPrayersAthanAction
            .register()
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
            .register()
            .registerRunListener((args, state) => {
            return (args.athan_dropdown === state.prayer_name);
        });
    }
    //play athan based on trigger
    async playAthan(sampleId, fileName) {
        console.log(sampleId);
        let err, result;
        Homey.ManagerAudio.playMp3(sampleId, fileName)
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
            exports.appmanager._prayerConfig = await new prayerlib.Configurator().getPrayerConfig();
            exports.appmanager._prayerManager = await prayerlib.PrayerTimeBuilder
                .createPrayerTimeBuilder(null, exports.appmanager._prayerConfig)
                .setLocationByCoordinates(Homey.ManagerGeolocation.getLatitude(), Homey.ManagerGeolocation.getLongitude())
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
