"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
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
exports.PrayerConditionTriggerEventListener = exports.PrayerConditionTriggerEventProvider = exports.TriggerPrayerEventBuilder = void 0;
const prayerlib = __importStar(require("@dpanet/prayers-lib"));
const prayers_lib_1 = require("@dpanet/prayers-lib");
const observables_extenstion_1 = require("./observables.extenstion");
const Rx = __importStar(require("rxjs"));
const RxOp = __importStar(require("rxjs/operators"));
const chrono = __importStar(require("chrono-node"));
const ramda = __importStar(require("ramda"));
const util = __importStar(require("util"));
const exception_handler_1 = require("../exceptions/exception.handler");
const sentry = __importStar(require("@sentry/node/dist/index"));
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
            let prayerTiming = this.upcomingPrayerTime(this.prayerName, onDate);
            if ((0, prayers_lib_1.isNullOrUndefined)(prayerTiming))
                throw new exception_handler_1.UpcomingPrayerNotFoundException("Prayer Time Not Found from Parameter Passed");
            //  console.log(this.prayerName);
            //console.log(this.upcomingPrayerTime(this.prayerName,onDate));
            let calculatedDate = chrono.casual.parseDate(`${this.prayerDurationTime} ${this.prayerDurationType} ${this.prayerAfterBefore} now`, prayerTiming.prayerTime);
            //console.log("calculated Date: " +calculatedDate)
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
            throw error;
            //  throw new UpcomingPrayerNotFoundException("getParyer Calculation resulted in null " + error.message);
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
        //console.log('notify observer '+ prayerTriggerEvent)
        super.notifyObservers(eventType, prayerTriggerEvent, error);
    }
    async startProvider(prayerManager) {
        try {
            if (!(0, prayers_lib_1.isNullOrUndefined)(prayerManager))
                this._prayerManager = prayerManager;
            if (!(0, prayers_lib_1.isNullOrUndefined)(this._schedulePrayersSubscription)) {
                if (!this._schedulePrayersSubscription.closed)
                    this._schedulePrayersSubscription.unsubscribe();
                this._schedulePrayersSubscription = this._schedulePrayersObservable.subscribe(this._prayerTimeObserver);
            }
            else {
                this._schedulePrayersSubscription = this._schedulePrayersObservable.subscribe(this._prayerTimeObserver);
            }
        }
        catch (err) {
            throw new exception_handler_1.PrayerProviderNotStaterdException("Star Provider Failed \n" + err.message);
        }
    }
    async stopProvider() {
        try {
            if (!(0, prayers_lib_1.isNullOrUndefined)(this._schedulePrayersSubscription) && !this._schedulePrayersSubscription.closed) {
                this._schedulePrayersSubscription.unsubscribe();
            }
        }
        catch (err) {
            throw new exception_handler_1.PrayerProviderNotStaterdException("Stop Provider Failed \n" + err.message);
        }
    }
    dateToCronObservable(fromDate) {
        let cronTimerObservable;
        let minutes = fromDate.getUTCMinutes();
        let seconds = fromDate.getUTCSeconds();
        let hours = fromDate.getUTCHours();
        let schedule = "".concat(minutes.toString(), " ", hours.toString(), " * * *");
        console.log("the cron schedule : " + schedule);
        return (0, observables_extenstion_1.cronTimer)(schedule, fromDate);
    }
    initSchedulersObservables(fromDate) {
        let SchedulingType;
        (function (SchedulingType) {
            SchedulingType["INIT"] = "Init";
            SchedulingType["RECURRINGG"] = "Recurring";
        })(SchedulingType || (SchedulingType = {}));
        let cronTimerObservable = (0, observables_extenstion_1.cronTimer)("2 0 * * *", prayers_lib_1.DateUtil.getNowDate());
        // let schedulePrayersObservableInit:Function = (conditions: Array<ITriggerCondition>, onDate: Date,schedulingType:SchedulingType): Rx.Observable<ITriggerEvent> =>
        //     Rx.from(conditions).pipe(
        //         RxOp.distinctUntilChanged(),
        //         RxOp.map((condition: ITriggerCondition): ITriggerEvent =>  schedulingType == SchedulingType.INIT ? condition.getPrayerEventCalculated(onDate):condition.getPrayerEventCalculated(DateUtil.addDay(1,onDate)) ,
        //         RxOp.tap((event: ITriggerEvent) => { if (isNullOrUndefined(event.upcomingPrayerTime)) throw new UpcomingPrayerNotFoundException("Upcoming Prayer is Null") }),
        //         RxOp.filter((event: ITriggerEvent) => new Date(event.prayerTimeCalculated) >= DateUtil.getNowTime()),
        //         RxOp.tap(console.log),
        //         RxOp.mergeMap((event: ITriggerEvent) => Rx.timer(event.prayerTimeCalculated).pipe(RxOp.mapTo(event))),
        //         RxOp.finalize(()=> console.log("Completed Inner Subscription Condition Prayers"))
        //     );
        let schedulePrayersObservable = (conditions, onDate, schedulingType) => Rx.from(conditions).pipe(RxOp.distinctUntilChanged(), RxOp.map((condition) => schedulingType == SchedulingType.INIT ? condition.getPrayerEventCalculated(onDate) : condition.getPrayerEventCalculated(prayers_lib_1.DateUtil.addDay(1, onDate))), 
        // RxOp.tap((x)=>console.log("the scheduling type is : "+ schedulingType + " and the value of calculation :")),
        //RxOp.tap(console.log),
        RxOp.tap((event) => { if ((0, prayers_lib_1.isNullOrUndefined)(event.upcomingPrayerTime))
            throw new exception_handler_1.UpcomingPrayerNotFoundException("Upcoming Prayer is Null"); }), RxOp.filter((event) => event.prayerTimeCalculated >= prayers_lib_1.DateUtil.getNowTime()), RxOp.tap(console.log), RxOp.mergeMap((event) => Rx.timer(event.prayerTimeCalculated).pipe(RxOp.mapTo(event))), RxOp.finalize(() => console.log("Completed Inner Subscription Condition Prayers")));
        //schedule remaing of the day event trigger conditions
        let schedulePrayerObservableRemaining = schedulePrayersObservable(this._triggerConditions, prayers_lib_1.DateUtil.getNowTime(), SchedulingType.INIT);
        // schedule tomorrow first trigger conditions
        let schedulePrayerObservableFirstDay = schedulePrayersObservable(this._triggerConditions, prayers_lib_1.DateUtil.addDay(1, prayers_lib_1.DateUtil.getNowDate()), SchedulingType.INIT);
        // cron schedulers on Everyday at specific time
        // cronTimerObservable=this.dateToCronObservable(DateUtil.addMinutes(fromDate,2));
        // schedule recurring trigger conditions every day.
        let schedulePrayerObservableEveryOtherDay = cronTimerObservable.pipe(RxOp.mergeMap((date) => schedulePrayersObservable(this._triggerConditions, date, SchedulingType.RECURRINGG)));
        // merge observables
        this._schedulePrayersObservable = Rx.merge(schedulePrayerObservableRemaining, schedulePrayerObservableEveryOtherDay);
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
        this._prayerAppManager.prayerConditionTriggerEventProvider.stopProvider();
        if (error instanceof exception_handler_1.UpcomingPrayerNotFoundException) {
            this._prayerAppManager.refreshPrayerManagerByDate();
        }
        else {
            sentry.captureException(error);
        }
    }
    onNext(value) {
        //this._prayerAppManager.triggerEvent(value.prayerName, value.\\);
        console.log("On Next " + value);
        this._prayerAppManager.triggerConditionPrayerEvent(value);
    }
}
exports.PrayerConditionTriggerEventListener = PrayerConditionTriggerEventListener;
