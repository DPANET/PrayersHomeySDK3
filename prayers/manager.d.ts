import * as prayerlib from '@dpanet/prayers-lib';
import * as events from './events';
import Homey = require('homey');
export declare class PrayersAppManager {
    private static _prayerAppManger;
    private _homeyPrayersTrigger;
    private _homeyPrayersAthanAction;
    private _prayersRefreshEventProvider;
    private _prayersRefreshEventListener;
    homeyPrayersTrigger: Homey.FlowCardTrigger<Homey.FlowCardTrigger<any>>;
    private _prayerEventProvider;
    prayerEventProvider: events.PrayersEventProvider;
    private _prayerEventListener;
    static prayerAppManger: PrayersAppManager;
    private _prayerManager;
    prayerManager: prayerlib.IPrayerManager;
    private _prayerConfig;
    static initApp(): Promise<void>;
    initPrayersSchedules(): void;
    reschedulePrayers(): void;
    scheduleRefresh(date: Date): void;
    initEvents(): void;
    playAthan(sampleId: string, fileName: string): Promise<boolean>;
    initAthan(): void;
    refreshPrayerManager(): void;
}
export declare var appmanager: PrayersAppManager;
