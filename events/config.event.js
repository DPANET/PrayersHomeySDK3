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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigEventListener = exports.ConfigEventProvider = void 0;
const prayerlib = __importStar(require("@dpanet/prayers-lib"));
const sentry = __importStar(require("@sentry/node/dist/index"));
class ConfigEventProvider extends prayerlib.EventProvider {
    //  private _chokidar: chokidar.FSWatcher;
    constructor(homey) {
        super();
        this._homey = homey;
        //  this._chokidar = chokidar.watch(this._pathName,{awaitWriteFinish:true,persistent:true,ignorePermissionErrors:true,usePolling :true});
        this._homey.settings.on("set", this.settingsChangedEvent.bind(this));
        this._homey.settings.on("error", this.settingsChangedError.bind(this));
    }
    registerListener(observer) {
        super.registerListener(observer);
    }
    removeListener(observer) {
        super.removeListener(observer);
    }
    notifyObservers(eventType, homey, error) {
        super.notifyObservers(eventType, homey, error);
    }
    settingsChangedEvent(homey) {
        try {
            this.notifyObservers(prayerlib.EventsType.OnNext, homey);
        }
        catch (err) {
            console.log(err);
            this.notifyObservers(prayerlib.EventsType.OnError, homey, err);
        }
    }
    settingsChangedError(error) {
        this.notifyObservers(prayerlib.EventsType.OnError, "Error", error);
    }
}
exports.ConfigEventProvider = ConfigEventProvider;
class ConfigEventListener {
    constructor(prayerAppManager) {
        this._prayerAppManager = prayerAppManager;
    }
    onCompleted() {
    }
    onError(error) {
        // debug(error);
        console.log(error);
        sentry.captureException(error);
    }
    async onNext(value) {
        console.log(`${value} config file has been saved`);
        await this._prayerAppManager.refreshPrayerManagerByConfig();
    }
}
exports.ConfigEventListener = ConfigEventListener;
