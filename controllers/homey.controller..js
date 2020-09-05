"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
//const debug = require('debug')(process.env.DEBUG);
const config = require("nconf");
const prayerlib = __importStar(require("@dpanet/prayers-lib"));
const nextprayer_event_1 = require("../events/nextprayer.event");
const prayerrefresh_event_1 = require("../events/prayerrefresh.event");
const config_event_1 = require("../events/config.event");
const conditionprayer_event_1 = require("../events/conditionprayer.event");
const util_1 = require("util");
const sentry = __importStar(require("@sentry/node"));
const prayers_lib_1 = require("@dpanet/prayers-lib");
const ramda = __importStar(require("ramda"));
sentry.init({ dsn: config.get("DSN") });
//const to = require('await-to-js').default;
const athanTypes = { athan_short: "assets/prayers/prayer_short.mp3", athan_full: "assets/prayers/prayer_full.mp3" };
class PrayersAppManager {
    get prayerConditionTriggerEventProvider() {
        return this._prayerConditionTriggerEventProvider;
    }
    set prayerConditionTriggerEventProvider(value) {
        this._prayerConditionTriggerEventProvider = value;
    }
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
            this._prayerAppManger._refreshTrials = 0;
            exports.appmanager.initPrayersEvents();
            exports.appmanager.initEvents();
            console.log(prayerlib.DateUtil.getNowTime());
            console.log(exports.appmanager._prayerManager.getUpcomingPrayer());
        }
        catch (err) {
            sentry.captureException(err);
            console.log(err);
        }
    }
    // initallize prayer scheduling and refresh events providers and listeners
    initPrayersEvents() {
        console.log("Prayer Schedule  Are being Initatized");
        //  this._coinfigFilePath =path.join(config.get("CONFIG_FOLDER_PATH"),config.get("PRAYER_CONFIG")) ;
        this._prayerEventProvider = new nextprayer_event_1.PrayersEventProvider(this._prayerManager);
        this._prayerEventListener = new nextprayer_event_1.PrayersEventListener(this);
        this._prayerEventProvider.registerListener(this._prayerEventListener);
        //this._prayerEventProvider.startPrayerSchedule();
        this._prayersRefreshEventProvider = new prayerrefresh_event_1.PrayersRefreshEventProvider(this._prayerManager);
        this._prayersRefreshEventListener = new prayerrefresh_event_1.PrayerRefreshEventListener(this);
        this._prayersRefreshEventProvider.registerListener(this._prayersRefreshEventListener);
        this._configEventProvider = new config_event_1.ConfigEventProvider(this._homey);
        this._configEventListener = new config_event_1.ConfigEventListener(this);
        this._configEventProvider.registerListener(this._configEventListener);
        this._prayersEventProviders = new Array();
        this._prayerConditionTriggerConditions = new Array();
    }
    //schedule refresh of prayers schedule based on date 
    scheduleRefresh(date) {
        this._prayersRefreshEventProvider.startPrayerRefreshSchedule(date);
    }
    //initialize Homey Events
    initEvents() {
        this._homeyPrayersTriggerAll = this._homey.flow.getTriggerCard('prayer_trigger_all');
        this._homeyPrayersTriggerSpecific = this._homey.flow.getTriggerCard('prayer_trigger_specific');
        this._homeyPrayersTriggerBeforAfterSpecific = this._homey.flow.getTriggerCard('prayer_trigger_before_after_specific');
        this._homeyPrayersAthanAction = this._homey.flow.getActionCard('athan_action');
        this.registerNextPrayerEvent();
        this.registerAthanPrayerEvent();
        this.registerConditionPrayerEvent();
    }
    //register homey athan trigger event based on prayer scheduling event.
    registerAthanPrayerEvent() {
        this._homeyPrayersAthanAction
            //.register()
            .registerRunListener(async (args, state) => {
            this._homey.audio.playMp3(args.athan_dropdown, athanTypes[args.athan_dropdown])
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
    }
    //play athan based on trigger
    async playAthan(sampleId, fileName) {
        console.log(sampleId);
        let err, result;
        this._homey.audio.playMp3(sampleId, fileName)
            .then((value) => {
            console.log(value);
            return Promise.resolve(true);
        })
            .catch((err) => {
            console.log(err);
            sentry.captureException(err);
            return Promise.resolve(true);
        });
        return Promise.resolve(true);
    }
    //register homey trigger event based on prayer scheduling event.
    async registerNextPrayerEvent() {
        try {
            this._homeyPrayersTriggerAll.registerRunListener(async (args, state) => {
                return true;
            });
            this._homeyPrayersTriggerSpecific
                //.register()
                .registerRunListener(async (args, state) => {
                return (args.prayerName === state.prayerName);
            });
            await this.updateNextPrayerEvent();
            this._homeyPrayersTriggerSpecific.on('update', this.updateNextPrayerEvent.bind(this));
            this._homeyPrayersTriggerAll.on('update', this.updateNextPrayerEvent.bind(this));
        }
        catch (err) {
            console.log(err);
            await this._prayerEventProvider.stopProvider();
            sentry.captureException(err);
        }
    }
    //update homey trigger event based on prayer scheduling event.
    async updateNextPrayerEvent() {
        try {
            console.log('registerNextPrayerEvent: ');
            if (!this._prayersEventProviders.includes(this._prayerEventProvider))
                this._prayersEventProviders.push(this._prayerEventProvider);
            let triggerAllArgumentValues = new Array();
            let triggerSpecificArgumentValues = new Array();
            triggerAllArgumentValues = await this._homeyPrayersTriggerAll.getArgumentValues();
            triggerSpecificArgumentValues = await this._homeyPrayersTriggerSpecific.getArgumentValues();
            console.log("number of registered nextPrayer All listener is " + triggerAllArgumentValues.length);
            console.log("number of registered nextPrayer specific listener is " + triggerSpecificArgumentValues.length);
            if (triggerAllArgumentValues.length > 0 || triggerSpecificArgumentValues.length > 0) {
                await this._prayerEventProvider.startProvider();
            }
            else {
                await this._prayerEventProvider.stopProvider();
            }
        }
        catch (err) {
            console.log(err);
            await this._prayerEventProvider.stopProvider();
            sentry.captureException(err);
        }
    }
    //trigger homey event based on prayer scheduling event.
    triggerNextPrayerEvent(prayerName, prayerTime) {
        try {
            let timeZone = this._prayerManager.getPrayerTimeZone().timeZoneId;
            let prayerTimeZone = prayerlib.DateUtil.getDateByTimeZone(prayerTime, timeZone);
            this._homeyPrayersTriggerAll
                .trigger({ prayerName: prayerName, prayerTime: prayerTime }, { prayerName: prayerName, prayerTime: prayerTime })
                .then(() => console.log('event all run'))
                .catch((err) => {
                this.prayerEventProvider.stopProvider();
                sentry.captureException(err);
                console.log(err);
            });
            this._homeyPrayersTriggerSpecific
                .trigger({ prayerName: prayerName, prayerTime: prayerTime }, { prayerName: prayerName, prayerTime: prayerTime })
                .then(() => console.log('event specific run'))
                .catch((err) => {
                this.prayerEventProvider.stopProvider();
                sentry.captureException(err);
                console.log(err);
            });
        }
        catch (error) {
            console.log(error);
            sentry.captureException(error);
        }
    }
    //register homey trigger event based on prayer after/before condition event.
    async registerConditionPrayerEvent() {
        try {
            this._homeyPrayersTriggerBeforAfterSpecific.registerRunListener(async (args, state) => {
                if (args.prayerName === state.prayerName
                    && args.prayerAfterBefore === state.prayerAfterBefore
                    && args.prayerDurationTime === state.prayerDurationTime
                    && args.prayerDurationType === state.prayerDurationType)
                    return true;
                return false;
            });
            await this.updateConditionPrayerEvent();
            this._homeyPrayersTriggerBeforAfterSpecific.on('update', this.updateConditionPrayerEvent.bind(this));
        }
        catch (err) {
            console.log(err);
            sentry.captureException(err);
        }
    }
    async updateConditionPrayerEvent() {
        try {
            console.log('registerConditionPrayerEvent: ');
            let argumentValues = new Array();
            let triggerPrayerEventBuilder;
            // let conditions: Array<ITriggerCondition> = new Array<ITriggerCondition>();
            argumentValues = await this._homeyPrayersTriggerBeforAfterSpecific.getArgumentValues();
            console.log("number of registered before and after listener is " + argumentValues.length);
            if (!util_1.isNullOrUndefined(this._prayerConditionTriggerEventProvider)) {
                this._prayerConditionTriggerEventProvider.stopProvider();
                if (this._prayersEventProviders.includes(this._prayerConditionTriggerEventProvider)) {
                    console.log("removing instance of register condition");
                    this._prayersEventProviders = ramda.without([this._prayerConditionTriggerEventProvider], this._prayersEventProviders);
                }
            }
            if (argumentValues.length > 0) {
                argumentValues.forEach((condition) => {
                    triggerPrayerEventBuilder = new conditionprayer_event_1.TriggerPrayerEventBuilder({
                        prayerAfterBefore: condition.prayerAfterBefore,
                        prayerDurationTime: condition.prayerDurationTime,
                        prayerDurationType: condition.prayerDurationType,
                        prayerFromDate: prayers_lib_1.DateUtil.getNowTime(),
                        prayerName: condition.prayerName,
                        upcomingPrayerTime: this._prayerManager.getPrayerTime.bind(this._prayerManager)
                    });
                    console.log("prayer time by date:" + this.prayerManager.getPrayerTime(prayerlib.PrayersName.ASR, prayers_lib_1.DateUtil.getNowTime()));
                    console.log(triggerPrayerEventBuilder.getPrayerEventCalculated(prayers_lib_1.DateUtil.getNowTime()));
                    this._prayerConditionTriggerConditions.push(triggerPrayerEventBuilder);
                });
                this._prayerConditionTriggerEventProvider = new conditionprayer_event_1.PrayerConditionTriggerEventProvider(this._prayerManager, prayers_lib_1.DateUtil.getNowDate(), this._prayerConditionTriggerConditions);
                this._prayerConditionTriggerEventProvider.startProvider();
                if (!this._prayersEventProviders.includes(this._prayerConditionTriggerEventProvider))
                    this._prayersEventProviders.push(this._prayerConditionTriggerEventProvider);
            }
        }
        catch (err) {
            console.log(err);
            if (!util_1.isNullOrUndefined(this._prayerConditionTriggerEventProvider)) {
                this._prayerConditionTriggerEventProvider.stopProvider();
                if (this._prayersEventProviders.includes(this._prayerConditionTriggerEventProvider)) {
                    this._prayersEventProviders = ramda.without([this._prayerConditionTriggerEventProvider], this._prayersEventProviders);
                }
            }
            sentry.captureException(err);
        }
    }
    //trigger homey event based on before or after spepcific prayer event
    triggerConditionPrayerEvent(triggerConditionEvent) {
        try {
            this._homeyPrayersTriggerBeforAfterSpecific
                .trigger({ prayerName: triggerConditionEvent.prayerName, prayerTimeCalculated: triggerConditionEvent.prayerTimeCalculated }, triggerConditionEvent)
                .then(() => console.log('prayer_trigger_before_after_specific'))
                .catch((err) => {
                this._prayerConditionTriggerEventProvider.stopProvider();
                sentry.captureException(err);
                console.log(err);
            });
        }
        catch (error) {
            console.log(error);
            this._prayerConditionTriggerEventProvider.stopProvider();
            sentry.captureException(error);
        }
    }
    //refresh prayer manager in case we reach the end of the array.
    refreshPrayerManagerByDate() {
        let startDate = prayerlib.DateUtil.getNowDate();
        let endDate = prayerlib.DateUtil.addMonth(1, startDate);
        this.prayerManager.updatePrayersDate(startDate, endDate)
            .then(async (value) => {
            this._prayersEventProviders.forEach(async (provider) => await provider.startProvider(value));
            //this._prayerManager = value;
            this._refreshTrials = 0;
        })
            //retry every date until the prayer refresh task is done.
            .catch((err) => {
            console.log(err);
            if (this._refreshTrials <= MAX_TRIALS) {
                this._refreshTrials += 1;
                let date = prayerlib.DateUtil.addDay(1, startDate);
                this.scheduleRefresh(date);
            }
            else {
                sentry.captureException(err);
            }
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
            this._prayersEventProviders.forEach(async (provider) => await provider.startProvider(this._prayerManager));
            this._refreshTrials = 0;
        }
        catch (err) {
            console.log(err);
            if (this._refreshTrials <= MAX_TRIALS) {
                this._refreshTrials += 1;
                let date = prayerlib.DateUtil.addDay(1, startDate);
                this.scheduleRefresh(date);
            }
            else {
                sentry.captureException(err);
            }
        }
    }
}
exports.PrayersAppManager = PrayersAppManager;
const MAX_TRIALS = 2;
exports.appmanager = PrayersAppManager.prayerAppManger;
