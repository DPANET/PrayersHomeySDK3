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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cronTimer = void 0;
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
