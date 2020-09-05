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
const Rx = __importStar(require("rxjs"));
const RxOp = __importStar(require("rxjs/operators"));
const prayers_lib_1 = require("@dpanet/prayers-lib");
const exception_handler_1 = require("../exceptions/exception.handler");
const sentry = __importStar(require("@sentry/node"));
class PrayersEventProvider extends prayerlib.TimerEventProvider {
    constructor(prayerManager) {
        super();
        this._prayerTimeObserver = {
            next: (prayersTime) => this.notifyObservers(prayerlib.EventsType.OnNext, prayersTime),
            complete: () => this.notifyObservers(prayerlib.EventsType.OnCompleted, null),
            error: (err) => this.notifyObservers(prayerlib.EventsType.OnError, null, err)
        };
        this._prayerManager = prayerManager;
        this._upcomingPrayerSourceObservable = Rx.defer(() => Rx.timer(this.getUpcomingPrayerTime()).pipe(RxOp.mapTo(this.getUpcomingPrayer())));
        this._validatePrayerTimeObservable = Rx.iif(() => !prayers_lib_1.isNullOrUndefined(this.getUpcomingPrayer()), this._upcomingPrayerSourceObservable, Rx.throwError(new exception_handler_1.UpcomingPrayerNotFoundException("Reached the end of Prayers")));
        this.runNextPrayerSchedule();
        //this._upcomingPrayerSubscription = this._upcomingPrayerControllerObservable.subscribe(this._prayerTimeObserver);
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
    async startProvider(prayerManager) {
        if (!prayers_lib_1.isNullOrUndefined(prayerManager))
            this._prayerManager = prayerManager;
        if (!prayers_lib_1.isNullOrUndefined(this._upcomingPrayerSubscription)) {
            if (!this._upcomingPrayerSubscription.closed)
                this._upcomingPrayerSubscription.unsubscribe();
            this._upcomingPrayerSubscription = this._upcomingPrayerControllerObservable.subscribe(this._prayerTimeObserver);
            console.log('subscribed to next prayer provider');
        }
        else {
            this._upcomingPrayerSubscription = this._upcomingPrayerControllerObservable.subscribe(this._prayerTimeObserver);
            console.log('subscribed to next prayer provider');
        }
    }
    async stopProvider() {
        if (!prayers_lib_1.isNullOrUndefined(this._upcomingPrayerSubscription) && !this._upcomingPrayerSubscription.closed) {
            console.log('stopping prayer event provider');
            this._upcomingPrayerSubscription.unsubscribe();
        }
    }
    runNextPrayerSchedule() {
        this._upcomingPrayerControllerObservable = this._upcomingPrayerSourceObservable.pipe(RxOp.expand(() => this._validatePrayerTimeObservable), RxOp.scan((accum, curr) => ({ ...accum, ...curr })), 
        //takeWhile((prayerTime: prayerlib.IPrayersTiming) => !isNullOrUndefined(prayerTime)),
        // startWith(this.getUpcomingPrayer()),
        RxOp.finalize(() => console.log('completiong of subscriptioin')));
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
        this._prayerAppManager.prayerEventProvider.stopProvider();
        if (error instanceof exception_handler_1.UpcomingPrayerNotFoundException) {
            this._prayerAppManager.refreshPrayerManagerByDate();
        }
        else {
            sentry.captureException(error);
        }
    }
    onNext(value) {
        this._prayerAppManager.triggerNextPrayerEvent(value.prayerName, value.prayerTime);
    }
}
exports.PrayersEventListener = PrayersEventListener;
