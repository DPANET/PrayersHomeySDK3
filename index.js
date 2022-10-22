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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const nconf_1 = __importDefault(require("nconf"));
nconf_1.default.file('env.json');
// process.env.DEBUG = nconf.get("DEBUG");
const prayers_controller_1 = __importDefault(require("./controllers/prayers.controller"));
const prayerlib = __importStar(require("@dpanet/prayers-lib"));
const prayers_lib_1 = require("@dpanet/prayers-lib");
const chrono = __importStar(require("chrono-node"));
const util_1 = __importDefault(require("util"));
const readline = __importStar(require("readline"));
const Rx = __importStar(require("rxjs"));
const RxOp = __importStar(require("rxjs/operators"));
const ramda = __importStar(require("ramda"));
const moment_1 = __importDefault(require("moment"));
const cron_converter_1 = __importDefault(require("cron-converter"));
async function init() {
    let configProvider = prayerlib.ConfigProviderFactory.createConfigProviderFactory(prayerlib.ClientConfigurator);
    let prayerConfig = await configProvider.getPrayerConfig();
    let locationConfig = await configProvider.getLocationConfig();
    let prayerManager = await prayerlib.PrayerTimeBuilder
        .createPrayerTimeBuilder(locationConfig, prayerConfig)
        .createPrayerTimeManager();
    let prayersContoller = new prayers_controller_1.default(configProvider);
    await prayersContoller.initializePrayerManger();
    console.log(util_1.default.inspect(prayersContoller.router.getPrayers(), { showHidden: false, depth: null }));
}
let prayers = [{
        prayersDate: prayers_lib_1.DateUtil.getNowTime(),
        prayerTime: [
            { prayerName: prayerlib.PrayersName.FAJR, prayerTime: (0, moment_1.default)(prayers_lib_1.DateUtil.getNowTime()).add(10, "seconds").toDate() },
            { prayerName: prayerlib.PrayersName.SUNRISE, prayerTime: (0, moment_1.default)(prayers_lib_1.DateUtil.getNowTime()).add(20, "seconds").toDate() },
            { prayerName: prayerlib.PrayersName.ISHA, prayerTime: (0, moment_1.default)(prayers_lib_1.DateUtil.getNowTime()).add(70, "seconds").toDate() },
            { prayerName: prayerlib.PrayersName.DHUHR, prayerTime: (0, moment_1.default)(prayers_lib_1.DateUtil.getNowTime()).add(30, "seconds").toDate() },
            { prayerName: prayerlib.PrayersName.ASR, prayerTime: (0, moment_1.default)(prayers_lib_1.DateUtil.getNowTime()).add(40, "seconds").toDate() },
            { prayerName: prayerlib.PrayersName.SUNSET, prayerTime: (0, moment_1.default)(prayers_lib_1.DateUtil.getNowTime()).add(50, "seconds").toDate() },
            { prayerName: prayerlib.PrayersName.MAGHRIB, prayerTime: (0, moment_1.default)(prayers_lib_1.DateUtil.getNowTime()).add(60, "seconds").toDate() },
            { prayerName: prayerlib.PrayersName.MIDNIGHT, prayerTime: (0, moment_1.default)(prayers_lib_1.DateUtil.getNowTime()).add(80, "seconds").toDate() }
        ]
    }
];
function getPrayersByDate(date) {
    let fnDayMatch = (n) => prayers_lib_1.DateUtil.dayMatch(date, n.prayersDate);
    return ramda.find(fnDayMatch, prayers);
}
function getPrayerTime(prayerName, prayerDate) {
    prayerDate = ((0, prayers_lib_1.isNullOrUndefined)(prayerDate) ? prayers_lib_1.DateUtil.getNowTime() : prayerDate);
    let prayersByDate = getPrayersByDate(prayerDate);
    if (!(0, prayers_lib_1.isNullOrUndefined)(prayersByDate)) {
        return ramda.find(n => n.prayerName === prayerName, prayersByDate.prayerTime);
    }
    return null;
}
function getPrayerStartPeriod() {
    return new Date();
}
function getPrayerEndPeriond() {
    return new Date();
}
function getUpcomingPrayer(date, prayerType) {
    let dateNow;
    if ((0, prayers_lib_1.isNullOrUndefined)(date))
        dateNow = prayers_lib_1.DateUtil.getNowTime();
    else
        dateNow = date;
    if (dateNow > getPrayerEndPeriond() || dateNow < getPrayerStartPeriod())
        return null;
    let orderByFn = ramda.sortBy(ramda.prop('prayerTime'));
    let upcomingPrayer = null;
    let fardhPrayers = prayerlib.PrayersTypes.filter((n) => n.prayerType === prayerlib.PrayerType.Fardh);
    let todayPrayers = getPrayersByDate(dateNow);
    if (!(0, prayers_lib_1.isNullOrUndefined)(todayPrayers)) {
        let listOfPrayers = orderByFn(todayPrayers.prayerTime);
        //filter on fardh prayers.
        listOfPrayers = ramda.innerJoin((prayerLeft, prayerRight) => prayerLeft.prayerName === prayerRight.prayerName, listOfPrayers, fardhPrayers);
        //find next prayer based on prayertype
        for (let i = 0, prev, curr; i < listOfPrayers.length; i++) {
            prev = listOfPrayers[i], curr = listOfPrayers[i + 1];
            upcomingPrayer = processUpcomingPrayer(prev, curr, i + 1, listOfPrayers, dateNow);
            if (!(0, prayers_lib_1.isNullOrUndefined)(upcomingPrayer))
                return upcomingPrayer;
        }
    }
    return upcomingPrayer;
}
function processUpcomingPrayer(prev, curr, index, array, dateNow) {
    if (prev.prayerTime >= dateNow)
        return array[index - 1];
    else if (!(0, prayers_lib_1.isNullOrUndefined)(curr) && prev.prayerTime <= dateNow && curr.prayerTime >= dateNow)
        return array[index];
    else if ((0, prayers_lib_1.isNullOrUndefined)(curr) && array.length === index) {
        let nextDay = prayers_lib_1.DateUtil.addDay(1, dateNow);
        if (nextDay > getPrayerEndPeriond())
            return null;
        return null; //getPrayerTime(prayerlib.PrayersName.FAJR, nextDay);
    }
    return null;
}
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
            throw new Error("getParyer Calculation resulted in null ");
        }
    }
}
async function conditionPipe() {
    let conditionOne = new TriggerPrayerEventBuilder({
        prayerName: prayerlib.PrayersName.ISHA,
        prayerDurationTime: 5,
        prayerAfterBefore: DurationAfterBefore.After,
        prayerDurationType: DurationTypes.Seconds,
        upcomingPrayerTime: getPrayerTime
    });
    let conditionTwo = new TriggerPrayerEventBuilder({
        prayerName: prayerlib.PrayersName.ASR,
        prayerDurationTime: 30,
        prayerAfterBefore: DurationAfterBefore.Before,
        prayerDurationType: DurationTypes.Seconds,
        upcomingPrayerTime: getPrayerTime
    });
    let sortWith = ramda.sortWith([
        ramda.descend(ramda.prop('prayerName')),
        ramda.descend(ramda.prop('prayerAfterBefore')),
        ramda.descend(ramda.prop('prayerDurationType')),
        ramda.descend(ramda.prop('prayerDurationTime'))
    ]);
    console.log("Welcome");
    let sortedConditions = new Array(conditionOne, conditionTwo);
    sortedConditions = sortWith(sortedConditions);
    let cronTimerObservable = cronTimer("*/1 * * * *", prayers_lib_1.DateUtil.getNowTime());
    let schedulePrayersObservable = (conditions, fromDate) => Rx.from(conditions).pipe(RxOp.tap(() => { console.log("Started"); }), RxOp.distinctUntilChanged(), RxOp.map((condition) => condition.getPrayerEventCalculated(fromDate)), RxOp.tap((event) => { if ((0, prayers_lib_1.isNullOrUndefined)(event.upcomingPrayerTime))
        throw new Error("Upcoming Prayer is Null"); }), RxOp.filter((event) => event.prayerTimeCalculated >= prayers_lib_1.DateUtil.getNowTime()), RxOp.tap((x) => { console.log("prayername : " + x.prayerName + " Prayer Time " + x.prayerTimeCalculated); }), RxOp.mergeMap((event) => Rx.timer(event.prayerTimeCalculated).pipe(RxOp.mapTo(event))));
    // Restore from merge map to switchMap  
    // let combinedObservable: Rx.Observable<any> = cronTimerObservable
    //     .pipe(
    //         RxOp.mergeMap((date: Date) => schedulePrayersObservable(sortedConditions, date)));
    let combinedObservable = schedulePrayersObservable(sortedConditions, getPrayerTime(prayerlib.PrayersName.FAJR).prayerTime);
    let subscription = combinedObservable.subscribe({
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
function generateEvent(cronText, fromDate) {
    let schedule = cronDateGenerator(cronText, (0, prayers_lib_1.isNullOrUndefined)(fromDate) ? new Date() : fromDate);
    console.log(schedule.date.toDate());
    console.log(schedule.next());
}
//generateEvent("0 2 * * *",new Date());
function cronDateGenerator(cronText, fromDate) {
    let croneExpression = new cron_converter_1.default();
    croneExpression.fromString(cronText);
    let schedule = croneExpression.schedule(fromDate);
    let interval = 0;
    let upcomingDate;
    return schedule;
}
function cronTimer(cronText, fromDate) {
    try {
        let schedule = cronDateGenerator(cronText, (0, prayers_lib_1.isNullOrUndefined)(fromDate) ? new Date() : fromDate);
        //schedule.pristine = true;
        let timerOperator = Rx.defer(() => Rx.timer(schedule.date.toDate()).pipe(RxOp.mapTo(schedule.date.toDate())));
        let timOperatorValidator = Rx.iif(() => !(0, prayers_lib_1.isNullOrUndefined)(schedule.next()), timerOperator, Rx.EMPTY);
        return timOperatorValidator.pipe(RxOp.expand((date) => timOperatorValidator), RxOp.tap((val) => console.log('Timer is still Running')), RxOp.finalize(() => console.log("completed running")));
    }
    catch (err) {
        return Rx.throwError(err);
    }
}
function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }));
}
