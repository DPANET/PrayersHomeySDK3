"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const debug = require('debug')(process.env.DEBUG);
const config = require("nconf");
const prayerlib = __importStar(require("@dpanet/prayers-lib"));
const to = require('await-to-js').default;
const util_1 = require("util");
const cron = __importStar(require("cron"));
const chokidar = require("chokidar");
const sentry = __importStar(require("@sentry/node"));
sentry.init({ dsn: config.get("DSN") });
class PrayersEventProvider extends prayerlib.EventProvider {
    constructor(prayerManager) {
        super();
        this._prayerManager = prayerManager;
    }
    registerListener(observer) {
        super.registerListener(observer);
    }
    removeListener(observer) {
        super.removeListener(observer);
    }
    notifyObservers(eventType, prayersTime, error) {
        super.notifyObservers(eventType, prayersTime, error);
    }
    startPrayerSchedule(prayerManager) {
        if (!util_1.isNullOrUndefined(this._upcomingPrayerEvent))
            this.stopPrayerSchedule();
        if (!util_1.isNullOrUndefined(prayerManager))
            this._prayerManager = prayerManager;
        // if (isNullOrUndefined(this._upcomingPrayerEvent) || !this._upcomingPrayerEvent.running) {
        this.runNextPrayerSchedule();
    }
    stopPrayerSchedule() {
        if (this._upcomingPrayerEvent.running)
            this._upcomingPrayerEvent.stop();
    }
    runNextPrayerSchedule() {
        let prayerTiming = this._prayerManager.getUpcomingPrayer();
        if (util_1.isNullOrUndefined(prayerTiming)) {
            this.notifyObservers(prayerlib.EventsType.OnCompleted, null);
            return;
        }
        this._upcomingPrayerEvent = new cron.CronJob(prayerTiming.prayerTime, () => {
            this.notifyObservers(prayerlib.EventsType.OnNext, prayerTiming);
        }, null, true);
        this._upcomingPrayerEvent.addCallback(() => {
            setTimeout(() => {
                this.runNextPrayerSchedule();
                //this.notifyObservers(prayerlib.EventsType.OnCompleted, null);
            }, 60000);
        });
    }
}
exports.PrayersEventProvider = PrayersEventProvider;
class PrayersEventListener {
    constructor(prayerAppManager) {
        this._prayerAppManager = prayerAppManager;
    }
    onCompleted() {
        this._prayerAppManager.prayerEventProvider.stopPrayerSchedule();
        this._prayerAppManager.refreshPrayerManagerByDate();
    }
    onError(error) {
        console.log(error);
    }
    onNext(value) {
        this._prayerAppManager.triggerEvent(value.prayerName, value.prayerTime);
    }
}
exports.PrayersEventListener = PrayersEventListener;
class PrayersRefreshEventProvider extends prayerlib.EventProvider {
    constructor(prayerManager) {
        super();
        this._prayerManager = prayerManager;
    }
    registerListener(observer) {
        super.registerListener(observer);
    }
    removeListener(observer) {
        super.removeListener(observer);
    }
    notifyObservers(eventType, prayersTime, error) {
        super.notifyObservers(eventType, prayersTime, error);
    }
    startPrayerRefreshSchedule(date) {
        if (util_1.isNullOrUndefined(this._refreshPrayersEvent) || !this._refreshPrayersEvent.start) {
            this.runNextPrayerSchedule(date);
        }
    }
    stopPrayerRefreshSchedule() {
        if (this._refreshPrayersEvent.running)
            this._refreshPrayersEvent.stop();
    }
    runNextPrayerSchedule(date) {
        this._refreshPrayersEvent = new cron.CronJob(date, async () => {
            this.notifyObservers(prayerlib.EventsType.OnCompleted, this._prayerManager);
        }, null, true);
    }
}
exports.PrayersRefreshEventProvider = PrayersRefreshEventProvider;
class PrayerRefreshEventListener {
    constructor(prayerAppManager) {
        this._prayerAppManager = prayerAppManager;
    }
    onCompleted() {
        this._prayerAppManager.refreshPrayerManagerByConfig();
    }
    onError(error) {
        console.log(error);
    }
    onNext(value) {
    }
}
exports.PrayerRefreshEventListener = PrayerRefreshEventListener;
class ConfigEventProvider extends prayerlib.EventProvider {
    constructor(pathName) {
        super();
        this._pathName = pathName;
        this._chokidar = chokidar.watch(this._pathName, { awaitWriteFinish: true, persistent: true, ignorePermissionErrors: true, usePolling: true });
        this._chokidar.on("change", this.fileChangedEvent.bind(this));
        this._chokidar.on("error", this.fileChangeError.bind(this));
    }
    registerListener(observer) {
        super.registerListener(observer);
    }
    removeListener(observer) {
        super.removeListener(observer);
    }
    notifyObservers(eventType, fileName, error) {
        super.notifyObservers(eventType, fileName, error);
    }
    fileChangedEvent(pathName) {
        try {
            this.notifyObservers(prayerlib.EventsType.OnNext, pathName);
        }
        catch (err) {
            this.notifyObservers(prayerlib.EventsType.OnError, pathName, err);
        }
    }
    fileChangeError(error) {
        this.notifyObservers(prayerlib.EventsType.OnError, this._pathName, error);
    }
}
exports.ConfigEventProvider = ConfigEventProvider;
class ConfigEventListener {
    constructor(prayerAppManager) {
        this._prayerAppManager = prayerAppManager;
    }
    onCompleted() {
    }
    onError(error) {
        debug(error);
        console.log(error);
    }
    async onNext(value) {
        //  debug(`${value} config file has been saved`);
        console.log(`${value} config file has been saved`);
        await this._prayerAppManager.refreshPrayerManagerByConfig();
    }
}
exports.ConfigEventListener = ConfigEventListener;
