"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
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
        prayersDate: new Date(),
        prayerTime: [
            { prayerName: prayerlib.PrayersName.FAJR, prayerTime: moment_1.default(new Date()).add(10, "seconds").toDate() },
            { prayerName: prayerlib.PrayersName.SUNRISE, prayerTime: moment_1.default(new Date()).add(20, "seconds").toDate() },
            { prayerName: prayerlib.PrayersName.ISHA, prayerTime: moment_1.default(new Date()).add(70, "seconds").toDate() },
            { prayerName: prayerlib.PrayersName.DHUHR, prayerTime: moment_1.default(new Date()).add(30, "seconds").toDate() },
            { prayerName: prayerlib.PrayersName.ASR, prayerTime: moment_1.default(new Date()).add(40, "seconds").toDate() },
            { prayerName: prayerlib.PrayersName.SUNSET, prayerTime: moment_1.default(new Date()).add(50, "seconds").toDate() },
            { prayerName: prayerlib.PrayersName.MAGHRIB, prayerTime: moment_1.default(new Date()).add(60, "seconds").toDate() },
            { prayerName: prayerlib.PrayersName.MIDNIGHT, prayerTime: moment_1.default(new Date()).add(80, "seconds").toDate() }
        ]
    }
];
function getPrayersByDate(date) {
    let fnDayMatch = (n) => prayers_lib_1.DateUtil.dayMatch(date, n.prayersDate);
    return ramda.find(fnDayMatch, prayers);
}
function getPrayerTime(prayerName, prayerDate) {
    prayerDate = (prayers_lib_1.isNullOrUndefined(prayerDate) ? new Date() : prayerDate);
    let prayersByDate = getPrayersByDate(prayerDate);
    if (!prayers_lib_1.isNullOrUndefined(prayersByDate)) {
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
    if (prayers_lib_1.isNullOrUndefined(date))
        dateNow = prayers_lib_1.DateUtil.getNowTime();
    else
        dateNow = date;
    if (dateNow > getPrayerEndPeriond() || dateNow < getPrayerStartPeriod())
        return null;
    let orderByFn = ramda.sortBy(ramda.prop('prayerTime'));
    let upcomingPrayer = null;
    let fardhPrayers = prayerlib.PrayersTypes.filter((n) => n.prayerType === prayerlib.PrayerType.Fardh);
    let todayPrayers = getPrayersByDate(dateNow);
    if (!prayers_lib_1.isNullOrUndefined(todayPrayers)) {
        let listOfPrayers = orderByFn(todayPrayers.prayerTime);
        //filter on fardh prayers.
        listOfPrayers = ramda.innerJoin((prayerLeft, prayerRight) => prayerLeft.prayerName === prayerRight.prayerName, listOfPrayers, fardhPrayers);
        //find next prayer based on prayertype
        for (let i = 0, prev, curr; i < listOfPrayers.length; i++) {
            prev = listOfPrayers[i], curr = listOfPrayers[i + 1];
            upcomingPrayer = processUpcomingPrayer(prev, curr, i + 1, listOfPrayers, dateNow);
            if (!prayers_lib_1.isNullOrUndefined(upcomingPrayer))
                return upcomingPrayer;
        }
    }
    return upcomingPrayer;
}
function processUpcomingPrayer(prev, curr, index, array, dateNow) {
    if (prev.prayerTime >= dateNow)
        return array[index - 1];
    else if (!prayers_lib_1.isNullOrUndefined(curr) && prev.prayerTime <= dateNow && curr.prayerTime >= dateNow)
        return array[index];
    else if (prayers_lib_1.isNullOrUndefined(curr) && array.length === index) {
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
        prayerName: prayerlib.PrayersName.ASR,
        prayerDurationTime: 1,
        prayerAfterBefore: DurationAfterBefore.After,
        prayerDurationType: DurationTypes.Minutes,
        upcomingPrayerTime: getPrayerTime
    });
    let conditionTwo = new TriggerPrayerEventBuilder({
        prayerName: prayerlib.PrayersName.FAJR,
        prayerDurationTime: 5,
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
    let sortedConditions = new Array(conditionOne, conditionTwo, conditionOne, conditionTwo);
    sortedConditions = sortWith(sortedConditions);
    let cronTimerObservable = cronTimer("2 0 * * *", prayers_lib_1.DateUtil.getNowDate());
    let schedulePrayersObservable = (conditions, fromDate) => Rx.from(conditions).pipe(RxOp.distinctUntilChanged(), RxOp.map((condition) => condition.getPrayerEventCalculated(fromDate)), RxOp.tap((event) => { if (prayers_lib_1.isNullOrUndefined(event.upcomingPrayerTime))
        throw new Error("Upcoming Prayer is Null"); }), RxOp.filter((event) => event.prayerTimeCalculated >= prayers_lib_1.DateUtil.getNowTime()), RxOp.tap(console.log), RxOp.mergeMap((event) => Rx.timer(event.prayerTimeCalculated).pipe(RxOp.mapTo(event))));
    let combinedObservable = cronTimerObservable
        .pipe(RxOp.switchMap((date) => schedulePrayersObservable(sortedConditions, date)));
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
//generateEvent();
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
        let schedule = cronDateGenerator(cronText, prayers_lib_1.isNullOrUndefined(fromDate) ? new Date() : fromDate);
        //schedule.pristine = true;
        let timerOperator = Rx.defer(() => Rx.timer(schedule.date.toDate()).pipe(RxOp.mapTo(schedule.date.toDate())));
        let timOperatorValidator = Rx.iif(() => !prayers_lib_1.isNullOrUndefined(schedule.next()), timerOperator, Rx.EMPTY);
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
