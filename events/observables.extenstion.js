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
const cron_converter_1 = __importDefault(require("cron-converter"));
const Rx = __importStar(require("rxjs"));
const RxOp = __importStar(require("rxjs/operators"));
const prayers_lib_1 = require("@dpanet/prayers-lib");
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
exports.cronTimer = cronTimer;
