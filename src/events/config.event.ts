import * as prayerlib from "@dpanet/prayers-lib";
import Homey from "homey";
import * as manager from '../controllers/homey.controller.';
import * as sentry from "@sentry/node";
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
        console.log(`${value} config file has been saved`);
        await this._prayerAppManager.refreshPrayerManagerByConfig();
    }
}