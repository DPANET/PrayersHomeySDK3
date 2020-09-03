import cron from "cron-converter";
import * as Rx from "rxjs";
import * as RxOp from "rxjs/operators";
import {isNullOrUndefined} from "@dpanet/prayers-lib";
 function cronDateGenerator(cronText: string, fromDate: Date):cron.Seeker {
    let croneExpression: cron = new cron();
    croneExpression.fromString(cronText);
    let schedule: cron.Seeker = croneExpression.schedule(fromDate);
    let interval: number = 0;
    let upcomingDate: Date;
    
    return schedule;
}

export function cronTimer(cronText: string, fromDate?: Date): Rx.Observable<any> {
    try{
    let schedule:cron.Seeker =cronDateGenerator(cronText, isNullOrUndefined(fromDate) ? new Date() : fromDate);
    //schedule.pristine = true;
    let timerOperator:Rx.Observable<Date> = Rx.defer(()=>Rx.timer(schedule.date.toDate()).pipe(RxOp.mapTo(schedule.date.toDate())));
    let timOperatorValidator:Rx.Observable<Date>= Rx.iif(()=> !isNullOrUndefined(schedule.next()),timerOperator,Rx.EMPTY);
    return timOperatorValidator.pipe( RxOp.expand((date:Date)=> timOperatorValidator),RxOp.tap((val)=>console.log('Timer is still Running')),
    RxOp.finalize(()=>console.log("completed running")));
    }catch(err)
    {
        return Rx.throwError(err);
    }

}