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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigEventListener = exports.ConfigEventProvider = exports.PrayerRefreshEventListener = exports.PrayersRefreshEventProvider = exports.PrayersEventListener = exports.PrayersEventProvider = void 0;
//const debug = require('debug')(process.env.DEBUG);
const config = require("nconf");
const prayerlib = __importStar(require("@dpanet/prayers-lib"));
const to = require('await-to-js').default;
const util_1 = require("util");
const cron = __importStar(require("cron"));
const prayers_lib_1 = require("@dpanet/prayers-lib");
//import chokidar = require('chokidar');
const sentry = __importStar(require("@sentry/node"));
sentry.init({ dsn: config.get("DSN") });
const rxjs_1 = require("rxjs");
const operators_1 = require("rxjs/operators");
class PrayersEventProvider extends prayerlib.EventProvider {
    //  private _prayerTimerObservable:Observable<prayerlib.IPrayersTiming>;
    constructor(prayerManager) {
        super();
        this._prayerTimeObserver = {
            next: (prayersTime) => this.notifyObservers(prayers_lib_1.EventsType.OnNext, prayersTime),
            complete: () => this.notifyObservers(prayers_lib_1.EventsType.OnCompleted, null),
            error: (err) => this.notifyObservers(prayers_lib_1.EventsType.OnError, null, err)
        };
        this._prayerManager = prayerManager;
        this._upcomingPrayerSourceObservable = rxjs_1.defer(() => rxjs_1.timer(this.getUpcomingPrayerTime()).pipe(operators_1.mapTo(this.getUpcomingPrayer())));
        this._validatePrayerTimeObservable = rxjs_1.iif(() => !util_1.isNullOrUndefined(this.getUpcomingPrayer()), this._upcomingPrayerSourceObservable, rxjs_1.throwError(new Error("Reached the end of Prayers")));
        this.runNextPrayerSchedule();
        this._upcomingPrayerSubscription = this._upcomingPrayerControllerObservable.subscribe(this._prayerTimeObserver);
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
    getUpcomingPrayerTime() { return this._prayerManager.getUpcomingPrayer().prayerTime; }
    ;
    getUpcomingPrayer() { return this._prayerManager.getUpcomingPrayer(); }
    ;
    startPrayerSchedule(prayerManager) {
        //     if(!isNullOrUndefined(this._upcomingPrayerEvent))
        //     this.stopPrayerSchedule();
        //     if (!isNullOrUndefined(prayerManager))
        //         this._prayerManager = prayerManager;
        //    // if (isNullOrUndefined(this._upcomingPrayerEvent) || !this._upcomingPrayerEvent.running) {
        //         this.runNextPrayerSchedule();
        //if(this._upcomingPrayerSubscription.closed)
        if (!util_1.isNullOrUndefined(prayerManager))
            this._prayerManager = prayerManager;
        if (this._upcomingPrayerSubscription.closed) {
            this._upcomingPrayerSubscription = this._upcomingPrayerControllerObservable.subscribe(this._prayerTimeObserver);
        }
        else {
            this._upcomingPrayerSubscription.unsubscribe();
            this._upcomingPrayerSubscription = this._upcomingPrayerControllerObservable.subscribe(this._prayerTimeObserver);
        }
        //this.runNextPrayerSchedule();
    }
    stopPrayerSchedule() {
        if (!this._upcomingPrayerSubscription.closed)
            this._upcomingPrayerSubscription.unsubscribe();
    }
    runNextPrayerSchedule() {
        this._upcomingPrayerControllerObservable = this._upcomingPrayerSourceObservable.pipe(operators_1.expand(() => this._validatePrayerTimeObservable), operators_1.scan((accum, curr) => ({ ...accum, ...curr })), 
        //takeWhile((prayerTime: prayerlib.IPrayersTiming) => !isNullOrUndefined(prayerTime)),
        // startWith(this.getUpcomingPrayer()),
        operators_1.finalize(() => console.log('completiong of subscriptioin')));
        // let prayerTiming: prayerlib.IPrayersTiming = this._prayerManager.getUpcomingPrayer();
        // if(isNullOrUndefined(prayerTiming))
        // {
        // this.notifyObservers(prayerlib.EventsType.OnCompleted, null);
        // return;
        // }
        // this._upcomingPrayerEvent = new cron.CronJob(prayerTiming.prayerTime, () => {
        //     this.notifyObservers(prayerlib.EventsType.OnNext, prayerTiming)
        // },
        //     null, true);
        // this._upcomingPrayerEvent.addCallback(() => {
        //     setTimeout(() => {
        //         this.runNextPrayerSchedule()
        //         //this.notifyObservers(prayerlib.EventsType.OnCompleted, null);
        //     }, 60000);
        // });
    }
}
exports.PrayersEventProvider = PrayersEventProvider;
class PrayersEventListener {
    constructor(prayerAppManager) {
        this._prayerAppManager = prayerAppManager;
    }
    onCompleted() {
        console.log("completed");
    }
    onError(error) {
        console.log(error.message);
        this._prayerAppManager.prayerEventProvider.stopPrayerSchedule();
        this._prayerAppManager.refreshPrayerManagerByDate();
        //sentry.captureException(error);
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
        sentry.captureException(error);
    }
    onNext(value) {
    }
}
exports.PrayerRefreshEventListener = PrayerRefreshEventListener;
class ConfigEventProvider extends prayerlib.EventProvider {
    //  private _chokidar: chokidar.FSWatcher;
    constructor(homey) {
        super();
        this._homey = homey;
        //  this._chokidar = chokidar.watch(this._pathName,{awaitWriteFinish:true,persistent:true,ignorePermissionErrors:true,usePolling :true});
        this._homey.settings.on("set", this.settingsChangedEvent.bind(this));
        this._homey.settings.on("error", this.settingsChangedError.bind(this));
    }
    registerListener(observer) {
        super.registerListener(observer);
    }
    removeListener(observer) {
        super.removeListener(observer);
    }
    notifyObservers(eventType, homey, error) {
        super.notifyObservers(eventType, homey, error);
    }
    settingsChangedEvent(homey) {
        try {
            this.notifyObservers(prayerlib.EventsType.OnNext, homey);
        }
        catch (err) {
            console.log(err);
            this.notifyObservers(prayerlib.EventsType.OnError, homey, err);
        }
    }
    settingsChangedError(error) {
        this.notifyObservers(prayerlib.EventsType.OnError, "Error", error);
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
        // debug(error);
        console.log(error);
        sentry.captureException(error);
    }
    async onNext(value) {
        //  debug(`${value} config file has been saved`);
        console.log(`${value} config file has been saved`);
        await this._prayerAppManager.refreshPrayerManagerByConfig();
    }
}
exports.ConfigEventListener = ConfigEventListener;
