import * as prayerlib from '@dpanet/prayers-lib';
import * as manager from './manager';
export declare class PrayersEventProvider extends prayerlib.EventProvider<prayerlib.IPrayersTiming> {
    private _prayerManager;
    private _upcomingPrayerEvent;
    constructor(prayerManager: prayerlib.IPrayerManager);
    registerListener(observer: prayerlib.IObserver<prayerlib.IPrayersTiming>): void;
    removeListener(observer: prayerlib.IObserver<prayerlib.IPrayersTiming>): void;
    notifyObservers(eventType: prayerlib.EventsType, prayersTime: prayerlib.IPrayersTiming, error?: Error): void;
    startPrayerSchedule(prayerManager?: prayerlib.IPrayerManager): void;
    stopPrayerSchedule(): void;
    private runNextPrayerSchedule;
}
export declare class PrayersEventListener implements prayerlib.IObserver<prayerlib.IPrayersTiming> {
    private _prayerAppManager;
    constructor(prayerAppManager: manager.PrayersAppManager);
    onCompleted(): void;
    onError(error: Error): void;
    onNext(value: prayerlib.IPrayersTiming): void;
}
export declare class PrayersRefreshEventProvider extends prayerlib.EventProvider<prayerlib.IPrayerManager> {
    private _prayerManager;
    private _refreshPrayersEvent;
    constructor(prayerManager: prayerlib.IPrayerManager);
    registerListener(observer: prayerlib.IObserver<prayerlib.IPrayerManager>): void;
    removeListener(observer: prayerlib.IObserver<prayerlib.IPrayerManager>): void;
    notifyObservers(eventType: prayerlib.EventsType, prayersTime: prayerlib.IPrayerManager, error?: Error): void;
    startPrayerRefreshSchedule(date: Date): void;
    stopPrayerRefreshSchedule(): void;
    private runNextPrayerSchedule;
}
export declare class PrayerRefreshEventListener implements prayerlib.IObserver<prayerlib.IPrayerManager> {
    private _prayerAppManager;
    constructor(prayerAppManager: manager.PrayersAppManager);
    onCompleted(): void;
    onError(error: Error): void;
    onNext(value: prayerlib.IPrayerManager): void;
}
