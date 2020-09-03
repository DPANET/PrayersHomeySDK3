import * as prayerlib from '@dpanet/prayers-lib';
import * as cron from 'cron';
import {isNullOrUndefined} from "@dpanet/prayers-lib";
import * as manager from '../controllers/homey.controller.';
import * as sentry from "@sentry/node";
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
        },null, true);
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