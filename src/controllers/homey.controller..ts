//const debug = require('debug')(process.env.DEBUG);
import config = require('nconf');
import * as prayerlib from '@dpanet/prayers-lib';
import { PrayersEventProvider, PrayersEventListener } from '../events/nextprayer.event';
import { PrayersRefreshEventProvider, PrayerRefreshEventListener } from '../events/prayerrefresh.event';
import { ConfigEventProvider, ConfigEventListener } from '../events/config.event';
import { PrayerConditionTriggerEventProvider, PrayerConditionTriggerEventListener, ITriggerEvent, ITriggerCondition, TriggerPrayerEventBuilder } from '../events/conditionprayer.event';
import Homey from 'homey';
import { isNullOrUndefined } from 'util';
import * as sentry from "@sentry/node";
import * as util from "util"
import { ITimerObservable, DateUtil } from '@dpanet/prayers-lib';
import * as ramda from "ramda";
sentry.init({ dsn: config.get("DSN") });
//const to = require('await-to-js').default;

const athanTypes: any = { athan_short: "assets/prayers/prayer_short.mp3", athan_full: "assets/prayers/prayer_full.mp3" };

export class PrayersAppManager {


    private static _prayerAppManger: PrayersAppManager;
    private _homey: Homey.Homey;
    private _homeyPrayersTriggerAll: Homey.FlowCardTrigger<Homey.FlowCardTrigger<any>>;
    private _homeyPrayersTriggerSpecific: Homey.FlowCardTrigger<Homey.FlowCardTrigger<any>>;
    private _homeyPrayersTriggerBeforAfterSpecific: Homey.FlowCardTrigger<Homey.FlowCardTrigger<any>>;
    private _homeyPrayersAthanAction: Homey.FlowCardAction<Homey.FlowCardAction<any>>;
    private _prayersRefreshEventProvider: PrayersRefreshEventProvider;
    private _prayersRefreshEventListener: PrayerRefreshEventListener;
    private _prayerEventProvider: PrayersEventProvider; ///= new event.PrayersEventProvider(prayerManager);
    private _configEventListener: ConfigEventListener;
    private _configEventProvider: ConfigEventProvider;
    private _prayerConditionTriggerEventProvider: PrayerConditionTriggerEventProvider;
    private _prayerConditionTriggerEventListener: PrayerConditionTriggerEventListener;
    private _prayersEventProviders: Array<prayerlib.ITimerObservable<any>>;
    private _prayerConditionTriggerConditions: Array<ITriggerCondition>;
    // private _coinfigFilePath:string;
    private _configProvider: prayerlib.IConfigProvider
    public get prayerEventProvider(): PrayersEventProvider {
        return this._prayerEventProvider;
    }
    public set prayerEventProvider(value: PrayersEventProvider) {
        this._prayerEventProvider = value;
    }
    private _prayerEventListener: PrayersEventListener;

    public static get prayerAppManger(): PrayersAppManager {
        if (!isNullOrUndefined(PrayersAppManager._prayerAppManger))
            return PrayersAppManager._prayerAppManger;
        else {
            PrayersAppManager._prayerAppManger = new PrayersAppManager();
            return PrayersAppManager._prayerAppManger
        }
    }
    public static set prayerAppManger(value: PrayersAppManager) {
        PrayersAppManager._prayerAppManger = value;

    }
    private _prayerManager: prayerlib.IPrayerManager;
    public get prayerManager(): prayerlib.IPrayerManager {
        return this._prayerManager;
    }
    public set prayerManager(value: prayerlib.IPrayerManager) {
        this._prayerManager = value;
    }
    private _prayerConfig: prayerlib.IPrayersConfig;
    private _locationConfig: prayerlib.ILocationConfig;
    // private  _prayerEvents:prayerlib.
    static async initApp(homey: Homey.Homey, configProvider: prayerlib.IConfigProvider): Promise<void> {
        try {
            appmanager._prayerConfig = await configProvider.getPrayerConfig();
            appmanager._locationConfig = await configProvider.getLocationConfig();
            appmanager._prayerManager = await prayerlib.PrayerTimeBuilder
                .createPrayerTimeBuilder(appmanager._locationConfig, appmanager._prayerConfig)
                //.setPrayerMethod(prayerlib.Methods.Mecca)
                //  .setPrayerPeriod(prayerlib.DateUtil.getNowDate(), prayerlib.DateUtil.addDay(1, prayerlib.DateUtil.getNowDate()))
                //   .setLocationByCoordinates(Homey.ManagerGeolocation.getLatitude(), Homey.ManagerGeolocation.getLongitude())
                .createPrayerTimeManager();
            console.log("InitApp is running")
            this._prayerAppManger._homey = homey;
            this._prayerAppManger._configProvider = configProvider;
            appmanager.initPrayersEvents();
            appmanager.initEvents();
            console.log(prayerlib.DateUtil.getNowTime())
            console.log(appmanager._prayerManager.getUpcomingPrayer());
        }
        catch (err) {
            sentry.captureException(err);
            console.log(err);
        }
    }
    // initallize prayer scheduling and refresh events providers and listeners
    public initPrayersEvents() {

        console.log("Prayer Schedule  Are being Initatized");
        //  this._coinfigFilePath =path.join(config.get("CONFIG_FOLDER_PATH"),config.get("PRAYER_CONFIG")) ;
        this._prayerEventProvider = new PrayersEventProvider(this._prayerManager);
        this._prayerEventListener = new PrayersEventListener(this);
        this._prayerEventProvider.registerListener(this._prayerEventListener);
        //this._prayerEventProvider.startPrayerSchedule();
        this._prayersRefreshEventProvider = new PrayersRefreshEventProvider(this._prayerManager);
        this._prayersRefreshEventListener = new PrayerRefreshEventListener(this);
        this._prayersRefreshEventProvider.registerListener(this._prayersRefreshEventListener);
        this._configEventProvider = new ConfigEventProvider(this._homey);
        this._configEventListener = new ConfigEventListener(this);
        this._configEventProvider.registerListener(this._configEventListener);
        this._prayersEventProviders = new Array();
        this._prayerConditionTriggerConditions = new Array();
    }

    //schedule refresh of prayers schedule based on date 
    public scheduleRefresh(date: Date) {
        this._prayersRefreshEventProvider.startPrayerRefreshSchedule(date);
    }
    //initialize Homey Events
    public initEvents(): void {
        this._homeyPrayersTriggerAll = this._homey.flow.getTriggerCard('prayer_trigger_all');
        this._homeyPrayersTriggerSpecific = this._homey.flow.getTriggerCard('prayer_trigger_specific');
        this._homeyPrayersTriggerBeforAfterSpecific = this._homey.flow.getTriggerCard('prayer_trigger_before_after_specific');
        this._homeyPrayersAthanAction = this._homey.flow.getActionCard('athan_action');
        this.registerNextPrayerEvent();
        this.registerAthanPrayerEvent();
        this.registerConditionPrayerEvent();
    }
    //register homey athan trigger event based on prayer scheduling event.
    private registerAthanPrayerEvent() {
        this._homeyPrayersAthanAction
            //.register()
            .registerRunListener(async (args, state) => {
                this._homey.audio.playMp3(args.athan_dropdown, athanTypes[args.athan_dropdown])
                    .then((value) => {
                        console.log(value);
                        return value;
                    })
                    .catch((err) => {
                        sentry.captureException(err);
                        console.log(err);
                        return Promise.resolve(false);
                    });
            }
            );
    }
    //play athan based on trigger
    private async playAthan(sampleId: string, fileName: string): Promise<boolean> {
        console.log(sampleId);
        let err: Error, result: any;
        this._homey.audio.playMp3(sampleId, fileName)
            .then((value) => {
                console.log(value);
                return Promise.resolve(true);
            })
            .catch((err) => {
                console.log(err);
                sentry.captureException(err);
                return Promise.resolve(true);
            });
        return Promise.resolve(true);

    }

    //register homey trigger event based on prayer scheduling event.
    private async registerNextPrayerEvent() {
        try {
            this._homeyPrayersTriggerAll.registerRunListener(async (args, state) => {
                return true;
            });
            this._homeyPrayersTriggerSpecific
                //.register()
                .registerRunListener(async (args, state) => {
                    return (args.prayerName === state.prayerName);
                });

            await this.updateNextPrayerEvent();
            this._homeyPrayersTriggerSpecific.on('update', this.updateNextPrayerEvent.bind(this));
            this._homeyPrayersTriggerAll.on('update', this.updateNextPrayerEvent.bind(this));
        }
        catch (err) {
            console.log(err);
            await this._prayerEventProvider.stopProvider();
            sentry.captureException(err);
        }

    }
    //update homey trigger event based on prayer scheduling event.
    private async updateNextPrayerEvent() {
        try {
            console.log('registerNextPrayerEvent: ');
            if (!this._prayersEventProviders.includes(this._prayerEventProvider))
                this._prayersEventProviders.push(this._prayerEventProvider);
            let triggerAllArgumentValues: Array<any> = new Array<any>();
            let triggerSpecificArgumentValues: Array<any> = new Array<any>();
            triggerAllArgumentValues = await this._homeyPrayersTriggerAll.getArgumentValues();
            triggerSpecificArgumentValues = await this._homeyPrayersTriggerSpecific.getArgumentValues();
            console.log("number of registered nextPrayer All listener is " + triggerAllArgumentValues.length);
            console.log("number of registered nextPrayer specific listener is " + triggerSpecificArgumentValues.length);

            if (triggerAllArgumentValues.length > 0 || triggerSpecificArgumentValues.length > 0) {
                await this._prayerEventProvider.startProvider();
            }
            else {
                await this.prayerEventProvider.stopProvider();
            }
        } catch (err) {
            console.log(err);
            await this._prayerEventProvider.stopProvider();
            sentry.captureException(err);
        }
    }

    //trigger homey event based on prayer scheduling event.
    public triggerNextPrayerEvent(prayerName: string, prayerTime: Date): void {
        try {
            let timeZone: string = this._prayerManager.getPrayerTimeZone().timeZoneId;
            let prayerTimeZone: string = prayerlib.DateUtil.getDateByTimeZone(prayerTime, timeZone);
            this._homeyPrayersTriggerAll
                .trigger({ prayerName: prayerName, prayerTime: prayerTime }, { prayerName: prayerName })
                .then(() => console.log('event all run'))
                .catch((err) => {
                    this.prayerEventProvider.stopProvider();
                    sentry.captureException(err);
                    console.log(err);
                });

            this._homeyPrayersTriggerSpecific
                .trigger({ prayerName: prayerName, prayerTime: prayerTime }, { prayerName: prayerName })
                .then(() => console.log('event specific run'))
                .catch((err) => {
                    this.prayerEventProvider.stopProvider();
                    sentry.captureException(err);
                    console.log(err);
                });
        }
        catch (error) {
            console.log(error);
            sentry.captureException(error);

        }
    }
    //register homey trigger event based on prayer after/before condition event.
    private async registerConditionPrayerEvent() {
        try {
            this._homeyPrayersTriggerBeforAfterSpecific.registerRunListener(async (args: ITriggerCondition, state: ITriggerEvent) => {
                if (args.prayerName === state.prayerName
                    && args.prayerAfterBefore === state.prayerAfterBefore
                    && args.prayerDurationTime === state.prayerDurationTime
                    && args.prayerDurationType === state.prayerDurationType)
                    return true;
                return false;
            });
            await this.updateConditionPrayerEvent();
            this._homeyPrayersTriggerBeforAfterSpecific.on('update', this.updateConditionPrayerEvent.bind(this));
        } catch (err) {
            console.log(err);
            sentry.captureException(err);
        }
    }
    private async updateConditionPrayerEvent() {
        try {
            console.log('registerConditionPrayerEvent: ');
            let argumentValues: Array<any> = new Array<any>();
            let triggerPrayerEventBuilder: TriggerPrayerEventBuilder ;
            // let conditions: Array<ITriggerCondition> = new Array<ITriggerCondition>();
            argumentValues = await this._homeyPrayersTriggerBeforAfterSpecific.getArgumentValues();
            console.log("number of registered before and after listener is " + argumentValues.length);
            if (!isNullOrUndefined(this._prayerConditionTriggerEventProvider)) {
                this._prayerConditionTriggerEventProvider.stopProvider();
                if (this._prayersEventProviders.includes(this._prayerConditionTriggerEventProvider)) {
                    console.log("removing instance of register condition");
                    this._prayersEventProviders = ramda.without([this._prayerConditionTriggerEventProvider], this._prayersEventProviders);
                }
            }
            
            if (argumentValues.length > 0) {
                argumentValues.forEach((condition: ITriggerCondition) => {
                    triggerPrayerEventBuilder=  new TriggerPrayerEventBuilder({
                        prayerAfterBefore: condition.prayerAfterBefore,
                        prayerDurationTime: condition.prayerDurationTime,
                        prayerDurationType: condition.prayerDurationType,
                        prayerFromDate: DateUtil.getNowTime(),
                        prayerName: condition.prayerName,
                        upcomingPrayerTime: this._prayerManager.getPrayerTime.bind(this._prayerManager)
                    });
                    console.log("prayer time by date:" + this.prayerManager.getPrayerTime(prayerlib.PrayersName.ASR,DateUtil.getNowTime()))
                    console.log(triggerPrayerEventBuilder.getPrayerEventCalculated(DateUtil.getNowTime()));
                    
                    this._prayerConditionTriggerConditions.push(triggerPrayerEventBuilder);
                });
                
                this._prayerConditionTriggerEventProvider = new PrayerConditionTriggerEventProvider(this._prayerManager,
                    DateUtil.getNowDate(), this._prayerConditionTriggerConditions);
                this._prayerConditionTriggerEventProvider.startProvider();
                if (!this._prayersEventProviders.includes(this._prayerConditionTriggerEventProvider))
                    this._prayersEventProviders.push(this._prayerConditionTriggerEventProvider);
            }
        } catch (err) {
            console.log(err);
            if (!isNullOrUndefined(this._prayerConditionTriggerEventProvider)) {
                this._prayerConditionTriggerEventProvider.stopProvider();
                if (this._prayersEventProviders.includes(this._prayerConditionTriggerEventProvider)) {
                    this._prayersEventProviders = ramda.without([this._prayerConditionTriggerEventProvider], this._prayersEventProviders);
                }
            }
            sentry.captureException(err);
        }
    }
    //trigger homey event based on before or after spepcific prayer event
    public triggerConditionPrayerEvent(triggerConditionEvent: ITriggerEvent) {
        try {

            this._homeyPrayersTriggerBeforAfterSpecific
                .trigger({ prayerName: triggerConditionEvent.prayerName, prayerTimeCalculated: triggerConditionEvent.prayerTimeCalculated }, triggerConditionEvent)
                .then(() => console.log('prayer_trigger_before_after_specific'))
                .catch((err) => {
                    this._prayerConditionTriggerEventProvider.stopProvider();
                    sentry.captureException(err);
                    console.log(err);
                });
        }
        catch (error) {
            console.log(error);
            this._prayerConditionTriggerEventProvider.stopProvider();
            sentry.captureException(error);

        }
    }
    //refresh prayer manager in case we reach the end of the array.
    public refreshPrayerManagerByDate(): void {
        let startDate: Date = prayerlib.DateUtil.getNowDate();
        let endDate: Date = prayerlib.DateUtil.addMonth(1, startDate);

        this.prayerManager.updatePrayersDate(startDate, endDate)
            .then(async (value) => {
                this._prayersEventProviders.forEach(async (provider: ITimerObservable<any>) => await provider.startProvider(value));
                //this._prayerManager = value;
            })
            //retry every date until the prayer refresh task is done.
            .catch((err) => {
                console.log(err);
                sentry.captureException(err);
                let date: Date = prayerlib.DateUtil.addDay(1, startDate);
                this.scheduleRefresh(date);
            });
    }
    public async refreshPrayerManagerByConfig() {
        let startDate: Date = prayerlib.DateUtil.getNowDate();
        let endDate: Date = prayerlib.DateUtil.addMonth(1, startDate);
        try {
            appmanager._prayerConfig = await this._configProvider.getPrayerConfig();
            appmanager._locationConfig = await this._configProvider.getLocationConfig()
            appmanager._prayerManager = await prayerlib.PrayerTimeBuilder
                .createPrayerTimeBuilder(appmanager._locationConfig, appmanager._prayerConfig)
                // .setLocationByCoordinates(Homey.ManagerGeolocation.getLatitude(), Homey.ManagerGeolocation.getLongitude())
                .createPrayerTimeManager();
            this._prayersEventProviders.forEach(async (provider: ITimerObservable<any>) => await provider.startProvider(this._prayerManager));
        } catch (err) {
            console.log(err);
            sentry.captureException(err);
            let date: Date = prayerlib.DateUtil.addDay(1, startDate);
            this.scheduleRefresh(date);
        }
    }
}
export var appmanager: PrayersAppManager = PrayersAppManager.prayerAppManger;
