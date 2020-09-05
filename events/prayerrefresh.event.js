"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const prayerlib = __importStar(require("@dpanet/prayers-lib"));
const cron = __importStar(require("cron"));
const prayers_lib_1 = require("@dpanet/prayers-lib");
const sentry = __importStar(require("@sentry/node"));
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
