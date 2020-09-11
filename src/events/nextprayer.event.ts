import * as prayerlib from '@dpanet/prayers-lib';
import * as manager from '../controllers/homey.controller.';
import * as Rx from "rxjs";
import * as RxOp from "rxjs/operators";
import { isNullOrUndefined } from '@dpanet/prayers-lib';
import { UpcomingPrayerNotFoundException } from "../exceptions/exception.handler"
import * as sentry from "@sentry/node/dist/index"
export class PrayersEventProvider extends prayerlib.TimerEventProvider<prayerlib.IPrayersTiming>
{

    constructor(prayerManager: prayerlib.IPrayerManager) {
        super();
        this._prayerManager = prayerManager;
        this._upcomingPrayerSourceObservable = Rx.defer(() => Rx.timer(this.getUpcomingPrayerTime()).pipe(RxOp.mapTo(this.getUpcomingPrayer())));
        this._validatePrayerTimeObservable = Rx.iif(() => !isNullOrUndefined(this.getUpcomingPrayer()), this._upcomingPrayerSourceObservable,
            Rx.throwError(new UpcomingPrayerNotFoundException("Reached the end of Prayers")));
        this.runNextPrayerSchedule();
        //this._upcomingPrayerSubscription = this._upcomingPrayerControllerObservable.subscribe(this._prayerTimeObserver);
    }
    private _prayerManager: prayerlib.IPrayerManager;
    private _upcomingPrayerSubscription: Rx.Subscription;
    private _upcomingPrayerControllerObservable: Rx.Observable<prayerlib.IPrayersTiming>;
    private _upcomingPrayerSourceObservable: Rx.Observable<any>;
    private _validatePrayerTimeObservable: Rx.Observable<any>;

    private _prayerTimeObserver: Rx.Observer<any> =
        {
            next: (prayersTime: prayerlib.IPrayersTiming) => this.notifyObservers(prayerlib.EventsType.OnNext, prayersTime),
            complete: () => this.notifyObservers(prayerlib.EventsType.OnCompleted, null),
            error: (err: Error) => this.notifyObservers(prayerlib.EventsType.OnError, null, err)
        }

    public registerListener(observer: prayerlib.IObserver<prayerlib.IPrayersTiming>): void {
        super.registerListener(observer);

    }
    public removeListener(observer: prayerlib.IObserver<prayerlib.IPrayersTiming>): void {
        super.removeListener(observer);
    }
    public notifyObservers(eventType: prayerlib.EventsType, prayersTime: prayerlib.IPrayersTiming, error?: Error): void {
        super.notifyObservers(eventType, prayersTime, error);
    }
    private getUpcomingPrayerTime(): Date { return this._prayerManager.getUpcomingPrayer().prayerTime; };
    private getUpcomingPrayer(): prayerlib.IPrayersTiming { return this._prayerManager.getUpcomingPrayer() };

    public async startProvider(prayerManager?: prayerlib.IPrayerManager): Promise<void> {
        if (!isNullOrUndefined(prayerManager))
            this._prayerManager = prayerManager;
        if (!isNullOrUndefined(this._upcomingPrayerSubscription)) {
            if (!this._upcomingPrayerSubscription.closed)
                this._upcomingPrayerSubscription.unsubscribe();
            this._upcomingPrayerSubscription = this._upcomingPrayerControllerObservable.subscribe(this._prayerTimeObserver);
        }
        else {
            this._upcomingPrayerSubscription = this._upcomingPrayerControllerObservable.subscribe(this._prayerTimeObserver);

        }

    }
    public async stopProvider(): Promise<void> {
        if (!isNullOrUndefined(this._upcomingPrayerSubscription) && !this._upcomingPrayerSubscription.closed) {
            this._upcomingPrayerSubscription.unsubscribe();
        }
    }
    private runNextPrayerSchedule(): void {
        this._upcomingPrayerControllerObservable = this._upcomingPrayerSourceObservable.pipe(
            RxOp.expand(() => this._validatePrayerTimeObservable),
            RxOp.scan((accum: prayerlib.IPrayersTiming, curr: prayerlib.IPrayersTiming) => ({ ...accum, ...curr })),
            //takeWhile((prayerTime: prayerlib.IPrayersTiming) => !isNullOrUndefined(prayerTime)),
            // startWith(this.getUpcomingPrayer()),
            RxOp.finalize(() => console.log('completiong of subscription'))
        )

    }
}
export class PrayersEventListener implements prayerlib.IObserver<prayerlib.IPrayersTiming>
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
        this._prayerAppManager.prayerEventProvider.stopProvider();

        if (error instanceof UpcomingPrayerNotFoundException) {
            this._prayerAppManager.refreshPrayerManagerByDate();
        }
        else
         {sentry.captureException(error);
         }
    }
    onNext(value: prayerlib.IPrayersTiming): void {
     
        this._prayerAppManager.triggerNextPrayerEvent(value.prayerName, value.prayerTime);
    }
}