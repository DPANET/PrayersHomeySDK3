//const debug = require('debug')(process.env.DEBUG);
import config= require('nconf');
import * as prayerlib from '@dpanet/prayers-lib';
import {PrayersEventProvider,PrayersEventListener} from '../events/nextprayer.event';
import {PrayersRefreshEventProvider,PrayerRefreshEventListener} from '../events/prayerrefresh.event';
import {ConfigEventProvider,ConfigEventListener} from '../events/config.event';
import {PrayerConditionTriggerEventProvider,PrayerConditionTriggerEventListener,ITriggerEvent,ITriggerCondition} from '../events/conditionprayer.event';
import Homey from 'homey';
import { isNullOrUndefined } from 'util';
import * as sentry from "@sentry/node";
import * as util from "util"
sentry.init({ dsn: config.get("DSN") });
//const to = require('await-to-js').default;

const athanTypes: any = { athan_short: "assets/prayers/prayer_short.mp3", athan_full: "assets/prayers/prayer_full.mp3" };

export class PrayersAppManager {


    private static _prayerAppManger: PrayersAppManager;
    private _homey:Homey.Homey;
    private _homeyPrayersTriggerAll: Homey.FlowCardTrigger<Homey.FlowCardTrigger<any>>;
    private _homeyPrayersTriggerSpecific: Homey.FlowCardTrigger<Homey.FlowCardTrigger<any>>;
    private _homeyPrayersTriggerBeforAfterSpecific: Homey.FlowCardTrigger<Homey.FlowCardTrigger<any>>;
    private _homeyPrayersAthanAction: Homey.FlowCardAction<Homey.FlowCardAction<any>>;
    private _prayersRefreshEventProvider: PrayersRefreshEventProvider;
    private _prayersRefreshEventListener: PrayerRefreshEventListener;
    private _prayerEventProvider: PrayersEventProvider; ///= new event.PrayersEventProvider(prayerManager);
    private _configEventListener: ConfigEventListener;
    private _configEventProvider: ConfigEventProvider;
    private _prayerConditionTriggerEventProvider:PrayerConditionTriggerEventProvider;
    private _prayerConditionTriggerEventListener:PrayerConditionTriggerEventListener;
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
    private _locationConfig:prayerlib.ILocationConfig;
    // private  _prayerEvents:prayerlib.
    static async initApp(homey:Homey.Homey,configProvider: prayerlib.IConfigProvider): Promise<void> {
        try {
            appmanager._prayerConfig = await configProvider.getPrayerConfig();
            appmanager._locationConfig =await configProvider.getLocationConfig();
            appmanager._prayerManager = await prayerlib.PrayerTimeBuilder
                .createPrayerTimeBuilder(appmanager._locationConfig, appmanager._prayerConfig)
                //.setPrayerMethod(prayerlib.Methods.Mecca)
              //  .setPrayerPeriod(prayerlib.DateUtil.getNowDate(), prayerlib.DateUtil.addDay(1, prayerlib.DateUtil.getNowDate()))
             //   .setLocationByCoordinates(Homey.ManagerGeolocation.getLatitude(), Homey.ManagerGeolocation.getLongitude())
                .createPrayerTimeManager();
            console.log("InitApp is running")
            this._prayerAppManger._homey= homey;
            this._prayerAppManger._configProvider = configProvider;
            appmanager.initPrayersSchedules();
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
    public initPrayersSchedules() {
    
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

    }

    //schedule refresh of prayers schedule based on date 
    public scheduleRefresh(date: Date) {
        this._prayersRefreshEventProvider.startPrayerRefreshSchedule(date);
    }

    //test flow card trigger
    private async onUpdateFlowCardUpdate()
    {
         this._homeyPrayersTriggerBeforAfterSpecific.on('update',async ()=>
        {
            console.log('updates: ');
            let values:Array<any> = await this._homeyPrayersTriggerBeforAfterSpecific.getArgumentValues();
            console.log(values.entries());
            values.forEach((value,index)=>
            {
            console.log("index " +index)
            console.log(util.inspect(value, {showHidden: false, depth: null}))
            }
            )
        });
    }

    //initialize Homey Events
    public initEvents(): void {
        this._homeyPrayersTriggerAll = this._homey.flow.getTriggerCard('prayer_trigger_all');
        this._homeyPrayersTriggerSpecific = this._homey.flow.getTriggerCard('prayer_trigger_specific');
        this._homeyPrayersTriggerBeforAfterSpecific= this._homey.flow.getTriggerCard('prayer_trigger_before_after_specific');
        this._homeyPrayersAthanAction = this._homey.flow.getActionCard('athan_action');
        this._homeyPrayersTriggerAll.registerRunListener(async (args, state) => {
            return true;});
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
            )
        this._homeyPrayersTriggerSpecific
            //.register()
            .registerRunListener(async (args, state) => {
                return (args.athan_dropdown === state.prayer_name);
            });
        this.onUpdateFlowCardUpdate();
    }

    //play athan based on trigger
    public async playAthan(sampleId: string, fileName: string): Promise<boolean> {
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
    //trigger homey event based on prayer scheduling event.
    public triggerNextPrayerEvent(prayerName: string, prayerTime: Date): void {
        try{
        let timeZone: string = this._prayerManager.getPrayerTimeZone().timeZoneId;
        let prayerTimeZone: string = prayerlib.DateUtil.getDateByTimeZone(prayerTime, timeZone);
        this._homeyPrayersTriggerAll
            .trigger({ prayer_name: prayerName, prayer_time: prayerTimeZone }, null)
            .then(() => console.log('event all run'))
            .catch((err) => {
                this.prayerEventProvider.stopProvider();
                sentry.captureException(err);
                console.log(err);
            });

        this._homeyPrayersTriggerSpecific.trigger({ prayer_name: prayerName, prayer_time: prayerTimeZone }, null)
            .then(() => console.log('event specific run'))
            .catch((err) => {
                this.prayerEventProvider.stopProvider();
                sentry.captureException(err);
                console.log(err);
            });
        }
        catch(error)
        {
            console.log(error);
            
        }
    }

    //trigger homey event based on before or after spepcific prayer event
    public triggerConditionPrayerEvent(triggerConditionEvent:ITriggerEvent)
    {
        try{

        this._homeyPrayersTriggerAll
            .trigger(triggerConditionEvent, null)
            .then(() => console.log('prayer_trigger_before_after_specific'))
            .catch((err) => {
                this._prayerConditionTriggerEventProvider.stopProvider();
                sentry.captureException(err);
                console.log(err);
            });
        }
        catch(error)
        {
            console.log(error);
            sentry.captureException(error);

        }
    }
    //refresh prayer manager in case we reach the end of the array.
    public refreshPrayerManagerByDate(): void {
        let startDate: Date = prayerlib.DateUtil.getNowDate();
        let endDate: Date = prayerlib.DateUtil.addMonth(1, startDate);
        
        this.prayerManager.updatePrayersDate(startDate, endDate)
            .then((value) => {
                this.prayerEventProvider.startProvider(value)
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
       try{
        appmanager._prayerConfig = await this._configProvider.getPrayerConfig();
        appmanager._locationConfig = await this._configProvider.getLocationConfig()
        appmanager._prayerManager = await prayerlib.PrayerTimeBuilder
            .createPrayerTimeBuilder(appmanager._locationConfig, appmanager._prayerConfig)
           // .setLocationByCoordinates(Homey.ManagerGeolocation.getLatitude(), Homey.ManagerGeolocation.getLongitude())
            .createPrayerTimeManager();
        this.prayerEventProvider.startProvider(appmanager._prayerManager);
        }catch(err)
        {
            console.log(err);
            sentry.captureException(err);
            let date: Date = prayerlib.DateUtil.addDay(1, startDate);
            this.scheduleRefresh(date);
        }
    }
}
export var appmanager: PrayersAppManager = PrayersAppManager.prayerAppManger;
