import nconf from 'nconf';
nconf.file('env.json');
// process.env.DEBUG = nconf.get("DEBUG");
import PrayersController from "./controllers/prayers.controller";
import * as prayerlib from "@dpanet/prayers-lib";
import { isNullOrUndefined, DateUtil } from "@dpanet/prayers-lib";
import * as chrono from "chrono-node";
import util from "util";
import * as readline from "readline";
import * as Rx from "rxjs";
import * as RxOp from "rxjs/operators";
import * as ramda from "ramda";
import moment from "moment";
import cron from "cron-converter";

async function init(): Promise<void> {
    let configProvider: prayerlib.IConfigProvider = prayerlib.ConfigProviderFactory.createConfigProviderFactory(prayerlib.ClientConfigurator);
    let prayerConfig: prayerlib.IPrayersConfig = await configProvider.getPrayerConfig();
    let locationConfig: prayerlib.ILocationConfig = await configProvider.getLocationConfig();
    let prayerManager: prayerlib.IPrayerManager = await prayerlib.PrayerTimeBuilder
        .createPrayerTimeBuilder(locationConfig, prayerConfig)
        .createPrayerTimeManager();
    let prayersContoller: PrayersController = new PrayersController(configProvider);
    await prayersContoller.initializePrayerManger();
    console.log(util.inspect(prayersContoller.router.getPrayers(), { showHidden: false, depth: null }));
}
let prayers: Array<prayerlib.IPrayers> =
    [{
        prayersDate: new Date(),
        prayerTime: [
            { prayerName: prayerlib.PrayersName.FAJR, prayerTime: moment(new Date()).add(10, "seconds").toDate() },
            { prayerName: prayerlib.PrayersName.SUNRISE, prayerTime: moment(new Date()).add(20, "seconds").toDate() },
            { prayerName: prayerlib.PrayersName.ISHA, prayerTime: moment(new Date()).add(70, "seconds").toDate() },
            { prayerName: prayerlib.PrayersName.DHUHR, prayerTime: moment(new Date()).add(30, "seconds").toDate() },
            { prayerName: prayerlib.PrayersName.ASR, prayerTime: moment(new Date()).add(40, "seconds").toDate() },
            { prayerName: prayerlib.PrayersName.SUNSET, prayerTime: moment(new Date()).add(50, "seconds").toDate() },
            { prayerName: prayerlib.PrayersName.MAGHRIB, prayerTime: moment(new Date()).add(60, "seconds").toDate() },
            { prayerName: prayerlib.PrayersName.MIDNIGHT, prayerTime: moment(new Date()).add(80, "seconds").toDate() }
        ]
    }
    ];
function getPrayersByDate(date: Date): prayerlib.IPrayers {
    let fnDayMatch = (n: prayerlib.IPrayers) => DateUtil.dayMatch(date, n.prayersDate);
    return ramda.find(fnDayMatch, prayers);
}
function getPrayerTime(prayerName: prayerlib.PrayersName, prayerDate?: Date): prayerlib.IPrayersTiming {
    prayerDate = (isNullOrUndefined(prayerDate) ? new Date() : prayerDate);

    let prayersByDate: prayerlib.IPrayers = getPrayersByDate(prayerDate);

    if (!isNullOrUndefined(prayersByDate)) {
        return ramda.find<prayerlib.IPrayersTiming>(n => n.prayerName === prayerName, prayersByDate.prayerTime);
    }
    return null;
}
function getPrayerStartPeriod(): Date {
    return new Date()
}
function getPrayerEndPeriond(): Date {
    return new Date()
}
function getUpcomingPrayer(date?: Date, prayerType?: prayerlib.PrayerType): prayerlib.IPrayersTiming {
    let dateNow: Date;
    if (isNullOrUndefined(date))
        dateNow = DateUtil.getNowTime();
    else
        dateNow = date;

    if (dateNow > getPrayerEndPeriond() || dateNow < getPrayerStartPeriod())
        return null;
    let orderByFn = ramda.sortBy(ramda.prop('prayerTime'));
    let upcomingPrayer: prayerlib.IPrayersTiming = null;
    let fardhPrayers: Array<prayerlib.IPrayerType> = prayerlib.PrayersTypes.filter((n) => n.prayerType === prayerlib.PrayerType.Fardh);
    let todayPrayers: prayerlib.IPrayers = getPrayersByDate(dateNow);
    if (!isNullOrUndefined(todayPrayers)) {
        let listOfPrayers: Array<prayerlib.IPrayersTiming> = orderByFn(todayPrayers.prayerTime);
        //filter on fardh prayers.
        listOfPrayers = ramda.innerJoin
            ((prayerLeft: prayerlib.IPrayersTiming, prayerRight: prayerlib.IPrayerType) => prayerLeft.prayerName === prayerRight.prayerName
                , listOfPrayers
                , fardhPrayers);
        //find next prayer based on prayertype
        for (let i: number = 0, prev, curr; i < listOfPrayers.length; i++) {
            prev = listOfPrayers[i], curr = listOfPrayers[i + 1];
            upcomingPrayer = processUpcomingPrayer(prev, curr, i + 1, listOfPrayers, dateNow);
            if (!isNullOrUndefined(upcomingPrayer))
                return upcomingPrayer;
        }
    }
    return upcomingPrayer;
}
function processUpcomingPrayer(prev: prayerlib.IPrayersTiming, curr: prayerlib.IPrayersTiming, index: number, array: Array<prayerlib.IPrayersTiming>, dateNow: Date): prayerlib.IPrayersTiming {

    if (prev.prayerTime >= dateNow)
        return array[index - 1];
    else if (!isNullOrUndefined(curr) && prev.prayerTime <= dateNow && curr.prayerTime >= dateNow)
        return array[index];
    else if (isNullOrUndefined(curr) && array.length === index) {
        let nextDay: Date = DateUtil.addDay(1, dateNow);
        if (nextDay > getPrayerEndPeriond())
            return null;
        return null//getPrayerTime(prayerlib.PrayersName.FAJR, nextDay);
    }
    return null
}


enum DurationTypes {
    Seconds = "seconds",
    Minutes = "minutes",
    Hours = "hours"
}
enum DurationAfterBefore {
    After = "After",
    Before = "Before"
}
interface ITriggerCondition {
    prayerName?: prayerlib.PrayersName,
    getPrayerEventCalculated(onDate: Date): ITriggerEvent,
    prayerDurationTime: number,
    prayerDurationType: DurationTypes,
    prayerAfterBefore: DurationAfterBefore,
    upcomingPrayerTime?(prayerName: prayerlib.PrayersName, onDate: Date): prayerlib.IPrayersTiming;
    prayerFromDate?: Date,
}
interface ITriggerEvent {
    prayerName?: prayerlib.PrayersName,
    prayerTimeCalculated: Date,
    prayerDurationTime: number,
    prayerDurationType: DurationTypes,
    prayerAfterBefore: DurationAfterBefore,
    upcomingPrayerTime: prayerlib.IPrayersTiming,
    prayerFromDate?: Date
}


class TriggerPrayerEventBuilder implements ITriggerCondition {
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
            let calculatedDate: Date = chrono.casual.parseDate(`${this.prayerDurationTime} ${this.prayerDurationType} ${this.prayerAfterBefore} now`,
                this.upcomingPrayerTime(this.prayerName, onDate).prayerTime);

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

            throw new Error("getParyer Calculation resulted in null ");
        }
    }
    prayerDurationTime: number;
    prayerDurationType: DurationTypes;
    prayerAfterBefore: DurationAfterBefore;
    prayerFromDate: Date;
    upcomingPrayerTime?(prayerName: prayerlib.PrayersName, date: Date): prayerlib.IPrayersTiming;
}


async function conditionPipe() {
    let conditionOne: ITriggerCondition = new TriggerPrayerEventBuilder({
        prayerName: prayerlib.PrayersName.ASR,
        prayerDurationTime: 1,
        prayerAfterBefore: DurationAfterBefore.After,
        prayerDurationType: DurationTypes.Minutes,
        upcomingPrayerTime: getPrayerTime
    });
    let conditionTwo: ITriggerCondition = new TriggerPrayerEventBuilder({
        prayerName: prayerlib.PrayersName.FAJR,
        prayerDurationTime: 5,
        prayerAfterBefore: DurationAfterBefore.Before,
        prayerDurationType: DurationTypes.Seconds,
        upcomingPrayerTime: getPrayerTime
    });
    let sortWith: any = ramda.sortWith<any>([
        ramda.descend(ramda.prop('prayerName'))
        , ramda.descend(ramda.prop('prayerAfterBefore'))
        , ramda.descend(ramda.prop('prayerDurationType'))
        , ramda.descend(ramda.prop('prayerDurationTime'))
    ]);

    let sortedConditions: Array<ITriggerCondition> = new Array(conditionOne, conditionTwo, conditionOne, conditionTwo);
    sortedConditions = sortWith(sortedConditions);
    let cronTimerObservable: Rx.Observable<Date> = cronTimer("* * * * *");
    let schedulePrayersObservable: Function = (conditions: Array<ITriggerCondition>, fromDate: Date): Rx.Observable<ITriggerEvent> =>
        Rx.from(conditions).pipe(
            RxOp.distinctUntilChanged(),
            RxOp.map((condition: ITriggerCondition): ITriggerEvent => condition.getPrayerEventCalculated(fromDate)),
            RxOp.tap((event: ITriggerEvent) => { if (isNullOrUndefined(event.upcomingPrayerTime)) throw new Error("Upcoming Prayer is Null") }),
            RxOp.filter((event: ITriggerEvent) => event.prayerTimeCalculated >= DateUtil.getNowTime()),
            RxOp.tap(console.log),
            RxOp.mergeMap((event: ITriggerEvent) => Rx.timer(event.prayerTimeCalculated).pipe(RxOp.mapTo(event)))
        );

    let combinedObservable: Rx.Observable<any> = cronTimerObservable
        .pipe(
            RxOp.switchMap((date: Date) => schedulePrayersObservable(sortedConditions, date)));

    let subscription: Rx.Subscription = combinedObservable.subscribe({
        next: (x) => console.log(x),
        error: console.log,
        complete: () => console.log("completed manually")
    });

    // setTimeout( ()=> 
    // //combinedObservable= null
    // ,60000);
    //await askQuestion("Enter Something\n");

}
//buildLocationObject();
//pipe();
//console.log(getUpcomingPrayer());
//task();
conditionPipe();
//generateEvent();

function cronDateGenerator(cronText: string, fromDate: Date): cron.Seeker {
    let croneExpression: cron = new cron();
    croneExpression.fromString(cronText);
    let schedule: cron.Seeker = croneExpression.schedule(fromDate);
    let interval: number = 0;
    let upcomingDate: Date;

    return schedule;
}
function cronTimer(cronText: string, fromDate?: Date): Rx.Observable<any> {
    try {
        let schedule: cron.Seeker = cronDateGenerator(cronText, isNullOrUndefined(fromDate) ? new Date() : fromDate);
        //schedule.pristine = true;
        let timerOperator: Rx.Observable<Date> = Rx.defer(() => Rx.timer(schedule.date.toDate()).pipe(RxOp.mapTo(schedule.date.toDate())));
        let timOperatorValidator: Rx.Observable<Date> = Rx.iif(() => !isNullOrUndefined(schedule.next()), timerOperator, Rx.EMPTY);
        return timOperatorValidator.pipe(RxOp.expand((date: Date) => timOperatorValidator), RxOp.tap((val) => console.log('Timer is still Running')),
            RxOp.finalize(() => console.log("completed running")));
    } catch (err) {
        return Rx.throwError(err);
    }

}


function askQuestion(query: string) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }))
}




init();
