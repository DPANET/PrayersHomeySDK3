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
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrayerRefreshEventListener = exports.PrayersRefreshEventProvider = void 0;
const prayerlib = __importStar(require("@dpanet/prayers-lib"));
const cron = __importStar(require("cron"));
const prayers_lib_1 = require("@dpanet/prayers-lib");
const sentry = __importStar(require("@sentry/node/dist/index"));
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
        if (prayers_lib_1.isNullOrUndefined(this._refreshPrayersEvent) || !this._refreshPrayersEvent.start) {
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
