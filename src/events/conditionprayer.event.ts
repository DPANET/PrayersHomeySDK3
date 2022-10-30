
import * as prayerlib from '@dpanet/prayers-lib';
import { isNullOrUndefined, DateUtil } from '@dpanet/prayers-lib';
import { cronTimer } from "./observables.extenstion"
import * as Rx from "rxjs";
import * as RxOp from "rxjs/operators";
import * as chrono from "chrono-node";
import * as ramda from "ramda";
import * as manager from '../controllers/homey.controller.';
import * as util from "util"
import { UpcomingPrayerNotFoundException, PrayerProviderNotStaterdException } from "../exceptions/exception.handler"
import * as sentry from "@sentry/node/dist/index";
enum DurationTypes {
    Seconds = "seconds",
    Minutes = "minutes",
    Hours = "hours"
}
enum DurationAfterBefore {
    After = "After",
    Before = "Before"
}
export interface ITriggerCondition {
    prayerName?: prayerlib.PrayersName,
    getPrayerEventCalculated(onDate: Date): ITriggerEvent,
    prayerDurationTime: number,
    prayerDurationType: DurationTypes,
    prayerAfterBefore: DurationAfterBefore,
    upcomingPrayerTime?(prayerName: prayerlib.PrayersName, onDate: Date): prayerlib.IPrayersTiming;
    prayerFromDate?: Date,
}
export interface ITriggerEvent {
    prayerName?: prayerlib.PrayersName,
    prayerTimeCalculated: Date,
    prayerDurationTime: number,
    prayerDurationType: DurationTypes,
    prayerAfterBefore: DurationAfterBefore,
    upcomingPrayerTime: prayerlib.IPrayersTiming,
    prayerFromDate?: Date
}
export class TriggerPrayerEventBuilder implements ITriggerCondition {
    prayerName?: prayerlib.PrayersName;
    constructor({
        prayerName = null,
        prayerDurationTime = 10,
        prayerDurationType = DurationTypes.Minutes,
        prayerAfterBefore = DurationAfterBefore.After,
        prayerFromDate = new Date(),
        upcomingPrayerTime = null
    }: {
        prayerName?: prayerlib.PrayersName;
        prayerDurationTime?: number;
        prayerDurationType?: DurationTypes;
        prayerAfterBefore?: DurationAfterBefore;
        prayerFromDate?: Date;
        upcomingPrayerTime?(prayerName: prayerlib.PrayersName, date: Date): prayerlib.IPrayersTiming;
    } = {}) {
        this.prayerName = prayerName;
        this.prayerDurationType = prayerDurationType;
        this.prayerDurationTime = prayerDurationTime;
        this.prayerAfterBefore = prayerAfterBefore;
        this.prayerFromDate = prayerFromDate;
        this.upcomingPrayerTime = upcomingPrayerTime;

    }
    getPrayerEventCalculated(onDate: Date): ITriggerEvent {
        try {
            let prayerTiming:prayerlib.IPrayersTiming = this.upcomingPrayerTime(this.prayerName, onDate);
            if(isNullOrUndefined(prayerTiming))
            throw new UpcomingPrayerNotFoundException("Prayer Time Not Found from Parameter Passed");
          //  console.log(this.prayerName);
            //console.log(this.upcomingPrayerTime(this.prayerName,onDate));
            let calculatedDate: Date = chrono.casual.parseDate(`${this.prayerDurationTime} ${this.prayerDurationType} ${this.prayerAfterBefore} now`,
                prayerTiming.prayerTime);
            //console.log("calculated Date: " +calculatedDate)
            return {
                upcomingPrayerTime: this.upcomingPrayerTime(this.prayerName, onDate),
                prayerTimeCalculated: calculatedDate,
                prayerAfterBefore: this.prayerAfterBefore,
                prayerDurationTime: this.prayerDurationTime,
                prayerDurationType: this.prayerDurationType,
                prayerName: this.prayerName,
                prayerFromDate: this.prayerFromDate

            }
        } catch (error) {

            throw error;
          //  throw new UpcomingPrayerNotFoundException("getParyer Calculation resulted in null " + error.message);
        }
    }
    prayerDurationTime: number;
    prayerDurationType: DurationTypes;
    prayerAfterBefore: DurationAfterBefore;
    prayerFromDate: Date;
    upcomingPrayerTime?(prayerName: prayerlib.PrayersName, date: Date): prayerlib.IPrayersTiming;

}

export class PrayerConditionTriggerEventProvider extends prayerlib.TimerEventProvider<ITriggerEvent>
{
    private _prayerManager: prayerlib.IPrayerManager;
    private _triggerConditions: Array<ITriggerCondition>;
    private _prayerTimeObserver: Rx.Observer<any>;
    private _schedulePrayersObservable: Rx.Observable<any>;
    private _schedulePrayersSubscription: Rx.Subscription;
    constructor(prayerManager: prayerlib.IPrayerManager, fromDate: Date, triggerCondition: Array<ITriggerCondition>) {
        super();
        this._triggerConditions = triggerCondition;
        this._prayerManager = prayerManager;
        this._prayerTimeObserver =
        {
            next: (triggerEvent: ITriggerEvent) => this.notifyObservers(prayerlib.EventsType.OnNext, triggerEvent),
            complete: () => this.notifyObservers(prayerlib.EventsType.OnCompleted, null),
            error: (err: Error) => this.notifyObservers(prayerlib.EventsType.OnError, null, err)
        };

        let sortWith: any = ramda.sortWith<any>([
            ramda.descend(ramda.prop('prayerName'))
            , ramda.descend(ramda.prop('prayerAfterBefore'))
            , ramda.descend(ramda.prop('prayerDurationType'))
            , ramda.descend(ramda.prop('prayerDurationTime'))
        ]);
        this._triggerConditions = sortWith(this._triggerConditions);
        console.log(util.inspect(this._triggerConditions, {showHidden: false, depth: null}))
        this.initSchedulersObservables(fromDate);

    }
    public registerListener(observer: prayerlib.IObserver<ITriggerEvent>): void {
        super.registerListener(observer);

    }
    public removeListener(observer: prayerlib.IObserver<ITriggerEvent>): void {
        super.removeListener(observer);
    }
    public notifyObservers(eventType: prayerlib.EventsType, prayerTriggerEvent: ITriggerEvent, error?: Error): void {
        //console.log('notify observer '+ prayerTriggerEvent)
        super.notifyObservers(eventType, prayerTriggerEvent, error);
    }
    public async startProvider(prayerManager?: any): Promise<void> {
        try {
            if (!isNullOrUndefined(prayerManager))
                this._prayerManager = prayerManager;
            if (!isNullOrUndefined(this._schedulePrayersSubscription)) {
                if (!this._schedulePrayersSubscription.closed)
                    this._schedulePrayersSubscription.unsubscribe();
                this._schedulePrayersSubscription = this._schedulePrayersObservable.subscribe(this._prayerTimeObserver);
            }
            else{
                this._schedulePrayersSubscription = this._schedulePrayersObservable.subscribe(this._prayerTimeObserver);

            }
        }
        catch (err) {
            throw new PrayerProviderNotStaterdException("Star Provider Failed \n" + err.message);
        }
    }
    public async stopProvider(): Promise<void> {
        try {
            if (!isNullOrUndefined(this._schedulePrayersSubscription) && !this._schedulePrayersSubscription.closed) {
                this._schedulePrayersSubscription.unsubscribe();
            }
        }
        catch (err) {
            throw new PrayerProviderNotStaterdException("Stop Provider Failed \n" + err.message);
        }
    }
    private dateToCronObservable(fromDate:Date) :Rx.Observable<Date>
    {
        let cronTimerObservable: Rx.Observable<Date>;
        let minutes: number = fromDate.getUTCMinutes();
        let seconds:number = fromDate.getUTCSeconds();
        let hours:number =fromDate.getUTCHours();
        let schedule:string = "".concat(minutes.toString()," ",hours.toString()," * * *");
        console.log("the cron schedule : " + schedule);
        return cronTimer(schedule, fromDate);
        
    }
    public initSchedulersObservables(fromDate: Date) {
        enum SchedulingType {
            INIT = "Init",
            RECURRINGG = "Recurring"
        }
        let cronTimerObservable: Rx.Observable<Date>;// = cronTimer("2 0 * * *", fromDate);
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
            let schedulePrayersObservable:Function = (conditions: Array<ITriggerCondition>, onDate: Date, schedulingType:SchedulingType): Rx.Observable<ITriggerEvent> =>
            Rx.from(conditions).pipe(
                RxOp.distinctUntilChanged(),
                RxOp.map((condition: ITriggerCondition): ITriggerEvent => schedulingType == SchedulingType.INIT ? condition.getPrayerEventCalculated(onDate) : condition.getPrayerEventCalculated(DateUtil.addDay(1,fromDate))  ),
                RxOp.tap((x)=>console.log("the scheduling type is : "+ schedulingType + " and the value of calculation :")),
                RxOp.tap(console.log),
                RxOp.tap((event: ITriggerEvent) => { if (isNullOrUndefined(event.upcomingPrayerTime)) throw new UpcomingPrayerNotFoundException("Upcoming Prayer is Null") }),
                RxOp.filter((event: ITriggerEvent) => new Date(event.prayerTimeCalculated) >= DateUtil.getNowTime()),
                RxOp.tap(console.log),
                RxOp.mergeMap((event: ITriggerEvent) => Rx.timer(event.prayerTimeCalculated).pipe(RxOp.mapTo(event))),
                RxOp.finalize(()=> console.log("Completed Inner Subscription Condition Prayers"))
            );

        //schedule remaing of the day event trigger conditions
        let schedulePrayerObservableRemaining: Rx.Observable<any> = schedulePrayersObservable(this._triggerConditions,fromDate,SchedulingType.INIT);
        
        // schedule tomorrow first trigger conditions
        let schedulePrayerObservableFirstDay: Rx.Observable<any>= schedulePrayersObservable(this._triggerConditions,DateUtil.addDay(1,fromDate),SchedulingType.INIT);
        
        // cron schedulers on Everyday at specific time
        cronTimerObservable=this.dateToCronObservable(DateUtil.addMinutes(fromDate,2));
        // schedule recurring trigger conditions every day.
        let schedulePrayerObservableEveryOtherDay: Rx.Observable<any> = cronTimerObservable.pipe(RxOp.switchMap((date: Date) => schedulePrayersObservable(this._triggerConditions,date, SchedulingType.RECURRINGG)));
        
        // merge observables
        this._schedulePrayersObservable = Rx.merge(schedulePrayerObservableRemaining,schedulePrayerObservableFirstDay,schedulePrayerObservableEveryOtherDay);



    }
}

export class PrayerConditionTriggerEventListener implements prayerlib.IObserver<ITriggerEvent>
{
    private _prayerAppManager: manager.PrayersAppManager
    constructor(prayerAppManager: manager.PrayersAppManager) {
        this._prayerAppManager = prayerAppManager;
    }
    onCompleted(): void {
        console.log("completed");
    }
    onError(error: Error): void {
        console.log(error.message);
        this._prayerAppManager.prayerConditionTriggerEventProvider.stopProvider();
        if (error instanceof UpcomingPrayerNotFoundException) {
            this._prayerAppManager.refreshPrayerManagerByDate();
        }
        else
         {sentry.captureException(error);
         }
    }
    onNext(value: ITriggerEvent): void {
        //this._prayerAppManager.triggerEvent(value.prayerName, value.\\);
        console.log("On Next "+value);
        this._prayerAppManager.triggerConditionPrayerEvent(value);
    }
}