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
exports.PrayerConditionTriggerEventListener = exports.PrayerConditionTriggerEventProvider = exports.TriggerPrayerEventBuilder = void 0;
const prayerlib = __importStar(require("@dpanet/prayers-lib"));
const prayers_lib_1 = require("@dpanet/prayers-lib");
const observables_extenstion_1 = require("./observables.extenstion");
const Rx = __importStar(require("rxjs"));
const RxOp = __importStar(require("rxjs/operators"));
const chrono = __importStar(require("chrono-node"));
const ramda = __importStar(require("ramda"));
const util = __importStar(require("util"));
var DurationTypes;
(function (DurationTypes) {
    DurationTypes["Seconds"] = "seconds";
    DurationTypes["Minutes"] = "minutes";
    DurationTypes["Hours"] = "hours";
})(DurationTypes || (DurationTypes = {}));
var DurationAfterBefore;
(function (DurationAfterBefore) {
    DurationAfterBefore["After"] = "After";
    DurationAfterBefore["Before"] = "Before";
})(DurationAfterBefore || (DurationAfterBefore = {}));
class TriggerPrayerEventBuilder {
    constructor({ prayerName = null, prayerDurationTime = 10, prayerDurationType = DurationTypes.Minutes, prayerAfterBefore = DurationAfterBefore.After, prayerFromDate = new Date(), upcomingPrayerTime = null } = {}) {
        this.prayerName = prayerName;
        this.prayerDurationType = prayerDurationType;
        this.prayerDurationTime = prayerDurationTime;
        this.prayerAfterBefore = prayerAfterBefore;
        this.prayerFromDate = prayerFromDate;
        this.upcomingPrayerTime = upcomingPrayerTime;
    }
    getPrayerEventCalculated(onDate) {
        try {
            console.log(this.prayerName);
            console.log(this.upcomingPrayerTime(this.prayerName, onDate));
            let calculatedDate = chrono.casual.parseDate(`${this.prayerDurationTime} ${this.prayerDurationType} ${this.prayerAfterBefore} now`, this.upcomingPrayerTime(this.prayerName, onDate).prayerTime);
            return {
                upcomingPrayerTime: this.upcomingPrayerTime(this.prayerName, onDate),
                prayerTimeCalculated: calculatedDate,
                prayerAfterBefore: this.prayerAfterBefore,
                prayerDurationTime: this.prayerDurationTime,
                prayerDurationType: this.prayerDurationType,
                prayerName: this.prayerName,
                prayerFromDate: this.prayerFromDate
            };
        }
        catch (error) {
            throw new Error("getParyer Calculation resulted in null " + error.message);
        }
    }
}
exports.TriggerPrayerEventBuilder = TriggerPrayerEventBuilder;
class PrayerConditionTriggerEventProvider extends prayerlib.TimerEventProvider {
    constructor(prayerManager, fromDate, triggerCondition) {
        super();
        this._triggerConditions = triggerCondition;
        this._prayerManager = prayerManager;
        this._prayerTimeObserver =
            {
                next: (triggerEvent) => this.notifyObservers(prayerlib.EventsType.OnNext, triggerEvent),
                complete: () => this.notifyObservers(prayerlib.EventsType.OnCompleted, null),
                error: (err) => this.notifyObservers(prayerlib.EventsType.OnError, null, err)
            };
        let sortWith = ramda.sortWith([
            ramda.descend(ramda.prop('prayerName')),
            ramda.descend(ramda.prop('prayerAfterBefore')),
            ramda.descend(ramda.prop('prayerDurationType')),
            ramda.descend(ramda.prop('prayerDurationTime'))
        ]);
        this._triggerConditions = sortWith(this._triggerConditions);
        console.log(util.inspect(this._triggerConditions, { showHidden: false, depth: null }));
        this.initSchedulersObservables(fromDate);
    }
    registerListener(observer) {
        super.registerListener(observer);
    }
    removeListener(observer) {
        super.removeListener(observer);
    }
    notifyObservers(eventType, prayerTriggerEvent, error) {
        super.notifyObservers(eventType, prayerTriggerEvent, error);
    }
    async startProvider(prayerManager) {
        try {
            if (!prayers_lib_1.isNullOrUndefined(prayerManager))
                this._prayerManager = prayerManager;
            if (!prayers_lib_1.isNullOrUndefined(this._schedulePrayersSubscription)) {
                if (!this._schedulePrayersSubscription.closed)
                    this._schedulePrayersSubscription.unsubscribe();
                this._schedulePrayersSubscription = this._schedulePrayersObservable.subscribe(this._prayerTimeObserver);
            }
            else {
                this._schedulePrayersSubscription = this._schedulePrayersObservable.subscribe(this._prayerTimeObserver);
            }
        }
        catch (err) {
            throw new Error("Star Provider Failed \n" + err.message);
        }
    }
    async stopProvider() {
        try {
            if (!prayers_lib_1.isNullOrUndefined(this._schedulePrayersSubscription) && !this._schedulePrayersSubscription.closed) {
                this._schedulePrayersSubscription.unsubscribe();
            }
        }
        catch (err) {
            throw new Error("Stop Provider Failed \n" + err.message);
        }
    }
    initSchedulersObservables(fromDate) {
        let cronTimerObservable = observables_extenstion_1.cronTimer("2 0 * * *", fromDate);
        let schedulePrayersObservable = (conditions, fromDate) => Rx.from(conditions).pipe(RxOp.distinctUntilChanged(), RxOp.map((condition) => condition.getPrayerEventCalculated(fromDate)), RxOp.tap((event) => { if (prayers_lib_1.isNullOrUndefined(event.upcomingPrayerTime))
            throw new Error("Upcoming Prayer is Null"); }), RxOp.filter((event) => event.prayerTimeCalculated >= prayers_lib_1.DateUtil.getNowTime()), RxOp.tap(console.log), RxOp.mergeMap((event) => Rx.timer(event.prayerTimeCalculated).pipe(RxOp.mapTo(event))));
        this._schedulePrayersObservable = cronTimerObservable
            .pipe(RxOp.switchMap((date) => schedulePrayersObservable(this._triggerConditions, date)));
    }
}
exports.PrayerConditionTriggerEventProvider = PrayerConditionTriggerEventProvider;
class PrayerConditionTriggerEventListener {
    constructor(prayerAppManager) {
        this._prayerAppManager = prayerAppManager;
    }
    onCompleted() {
        console.log("completed");
    }
    onError(error) {
        console.log(error.message);
        this._prayerAppManager.prayerEventProvider.stopProvider();
        this._prayerAppManager.refreshPrayerManagerByDate();
    }
    onNext(value) {
        //this._prayerAppManager.triggerEvent(value.prayerName, value.\\);
        this._prayerAppManager.triggerConditionPrayerEvent(value);
    }
}
exports.PrayerConditionTriggerEventListener = PrayerConditionTriggerEventListener;
