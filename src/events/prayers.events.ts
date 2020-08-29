//const debug = require('debug')(process.env.DEBUG);
import config = require('nconf');
import * as prayerlib from '@dpanet/prayers-lib';
import * as manager from '../controllers/homey.controller.';
const to = require('await-to-js').default;
import { isNullOrUndefined } from 'util';
import * as cron from 'cron';
import { DateUtil, EventsType } from '@dpanet/prayers-lib';
import { ConfigSettingsKeys } from "../configurations/configuration.controller";
//import chokidar = require('chokidar');
import * as sentry from "@sentry/node";
import Homey from "homey"
sentry.init({ dsn: config.get("DSN") });
import { Observable,defer, Observer, timer, Subscription, iif, throwError } from "rxjs";
import { mergeMap, takeWhile, startWith, finalize, scan, expand } from "rxjs/operators";

export class PrayersEventProvider extends prayerlib.EventProvider<prayerlib.IPrayersTiming>
{
    //  private _prayerTimerObservable:Observable<prayerlib.IPrayersTiming>;
    constructor(prayerManager: prayerlib.IPrayerManager) {
        super();
        this._prayerManager = prayerManager;
        this._upcomingPrayerSourceObservable =defer(()=>timer(this.getUpcomingPrayerTime()));
        this._validatePrayerTimeObservable= iif(() => !isNullOrUndefined(this.getUpcomingPrayer()), this._upcomingPrayerSourceObservable,
        throwError(new Error("Reached the end of Prayers")));
        this.runNextPrayerSchedule();
        this._upcomingPrayerSubscription = this._upcomingPrayerControllerObservable.subscribe(this._prayerTimeObserver);

    }
    private _prayerManager: prayerlib.IPrayerManager;
    private _upcomingPrayerEvent: cron.CronJob;
    private _upcomingPrayerSubscription: Subscription;
    private _upcomingPrayerControllerObservable: Observable<prayerlib.IPrayersTiming>;
    private _upcomingPrayerSourceObservable: Observable<any>;
    private _validatePrayerTimeObservable: Observable<any>; 
    
    private _prayerTimeObserver: Observer<any> =
        {
            next: (prayersTime: prayerlib.IPrayersTiming) => this.notifyObservers(EventsType.OnNext, prayersTime),
            complete: () => this.notifyObservers(EventsType.OnCompleted, null),
            error: (err: Error) => this.notifyObservers(EventsType.OnError, null, err)
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

    public startPrayerSchedule(prayerManager?: prayerlib.IPrayerManager): void {
        //     if(!isNullOrUndefined(this._upcomingPrayerEvent))
        //     this.stopPrayerSchedule();
        //     if (!isNullOrUndefined(prayerManager))
        //         this._prayerManager = prayerManager;
        //    // if (isNullOrUndefined(this._upcomingPrayerEvent) || !this._upcomingPrayerEvent.running) {
        //         this.runNextPrayerSchedule();
        //if(this._upcomingPrayerSubscription.closed)
        if (!isNullOrUndefined(prayerManager))
            this._prayerManager = prayerManager;
        if (this._upcomingPrayerSubscription.closed) {
            this._upcomingPrayerSubscription = this._upcomingPrayerControllerObservable.subscribe(this._prayerTimeObserver);
        }
        else {
            this._upcomingPrayerSubscription.unsubscribe();
            this._upcomingPrayerSubscription = this._upcomingPrayerControllerObservable.subscribe(this._prayerTimeObserver);
        }
        //this.runNextPrayerSchedule();

    }
    public stopPrayerSchedule(): void {
        if (!this._upcomingPrayerSubscription.closed)
            this._upcomingPrayerSubscription.unsubscribe();
    }
    private runNextPrayerSchedule(): void {
        this._upcomingPrayerControllerObservable = this._upcomingPrayerSourceObservable.pipe(
            expand(() => timer(60000).pipe(mergeMap(() => this._validatePrayerTimeObservable))),
            scan((accum: prayerlib.IPrayersTiming, curr: prayerlib.IPrayersTiming) => ({ ...accum, ...curr }),
                this.getUpcomingPrayer()),
            takeWhile((prayerTime: prayerlib.IPrayersTiming) => !isNullOrUndefined(prayerTime)),
           // startWith(this.getUpcomingPrayer()),
            finalize(() => console.log('completiong of subscriptioin'))
        )
        // let prayerTiming: prayerlib.IPrayersTiming = this._prayerManager.getUpcomingPrayer();
        // if(isNullOrUndefined(prayerTiming))
        // {
        // this.notifyObservers(prayerlib.EventsType.OnCompleted, null);
        // return;
        // }
        // this._upcomingPrayerEvent = new cron.CronJob(prayerTiming.prayerTime, () => {
        //     this.notifyObservers(prayerlib.EventsType.OnNext, prayerTiming)
        // },
        //     null, true);
        // this._upcomingPrayerEvent.addCallback(() => {
        //     setTimeout(() => {
        //         this.runNextPrayerSchedule()
        //         //this.notifyObservers(prayerlib.EventsType.OnCompleted, null);
        //     }, 60000);
        // });
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
        this._prayerAppManager.prayerEventProvider.stopPrayerSchedule();
        this._prayerAppManager.refreshPrayerManagerByDate();
        //sentry.captureException(error);
    }
    onNext(value: prayerlib.IPrayersTiming): void {
        this._prayerAppManager.triggerEvent(value.prayerName, value.prayerTime);
    }
}

export class PrayersRefreshEventProvider extends prayerlib.EventProvider<prayerlib.IPrayerManager>
{
    private _prayerManager: prayerlib.IPrayerManager;
    private _refreshPrayersEvent: cron.CronJob;
    constructor(prayerManager: prayerlib.IPrayerManager) {
        super();
        this._prayerManager = prayerManager;
    }
    public registerListener(observer: prayerlib.IObserver<prayerlib.IPrayerManager>): void {
        super.registerListener(observer);
    }
    public removeListener(observer: prayerlib.IObserver<prayerlib.IPrayerManager>): void {
        super.removeListener(observer);
    }
    public notifyObservers(eventType: prayerlib.EventsType, prayersTime: prayerlib.IPrayerManager, error?: Error): void {
        super.notifyObservers(eventType, prayersTime, error);
    }
    public startPrayerRefreshSchedule(date: Date): void {
        if (isNullOrUndefined(this._refreshPrayersEvent) || !this._refreshPrayersEvent.start) {
            this.runNextPrayerSchedule(date);
        }
    }
    public stopPrayerRefreshSchedule(): void {
        if (this._refreshPrayersEvent.running)
            this._refreshPrayersEvent.stop();
    }
    private runNextPrayerSchedule(date: Date): void {
        this._refreshPrayersEvent = new cron.CronJob(date, async () => {
            this.notifyObservers(prayerlib.EventsType.OnCompleted, this._prayerManager);
        },
            null, true);
    }

}
export class PrayerRefreshEventListener implements prayerlib.IObserver<prayerlib.IPrayerManager>
{
    private _prayerAppManager: manager.PrayersAppManager
    constructor(prayerAppManager: manager.PrayersAppManager) {
        this._prayerAppManager = prayerAppManager;
    }
    onCompleted(): void {
        this._prayerAppManager.refreshPrayerManagerByConfig();
    }
    onError(error: Error): void {
        console.log(error);
        sentry.captureException(error);
    }
    onNext(value: prayerlib.IPrayerManager): void {
    }
}
export class ConfigEventProvider extends prayerlib.EventProvider<string>
{
    private _homey: Homey.Homey;
    //  private _chokidar: chokidar.FSWatcher;
    constructor(homey: Homey.Homey) {
        super();
        this._homey = homey;
        //  this._chokidar = chokidar.watch(this._pathName,{awaitWriteFinish:true,persistent:true,ignorePermissionErrors:true,usePolling :true});
        this._homey.settings.on("set", this.settingsChangedEvent.bind(this));
        this._homey.settings.on("error", this.settingsChangedError.bind(this));
    }
    public registerListener(observer: prayerlib.IObserver<string>): void {
        super.registerListener(observer);
    }
    public removeListener(observer: prayerlib.IObserver<string>): void {
        super.removeListener(observer);
    }
    public notifyObservers(eventType: prayerlib.EventsType, homey: string, error?: Error): void {
        super.notifyObservers(eventType, homey, error);
    }
    private settingsChangedEvent(homey: string) {

        try {
            this.notifyObservers(prayerlib.EventsType.OnNext, homey);
        }
        catch (err) {
            console.log(err);
            this.notifyObservers(prayerlib.EventsType.OnError, homey, err)
        }

    }
    private settingsChangedError(error: Error) {
        this.notifyObservers(prayerlib.EventsType.OnError, "Error", error);
    }
}

export class ConfigEventListener implements prayerlib.IObserver<string>
{
    private _prayerAppManager: manager.PrayersAppManager
    constructor(prayerAppManager: manager.PrayersAppManager) {
        this._prayerAppManager = prayerAppManager;
    }
    onCompleted(): void {
    }
    onError(error: Error): void {
        // debug(error);
        console.log(error);
        sentry.captureException(error);
    }
    async onNext(value: string): Promise<void> {
        //  debug(`${value} config file has been saved`);
        console.log(`${value} config file has been saved`);
        await this._prayerAppManager.refreshPrayerManagerByConfig();
    }
}