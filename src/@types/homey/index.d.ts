
declare module 'homey'
{
  export var env: any;
  import { EventEmitter } from "events";
  export type i18n = string | any;
  // import * as Homey from 'homey';
  export function __(key: i18n): void


  export interface ICapabilities {
    capabilityId: string;
  }
  export class SimpleClass extends EventEmitter {
    constructor();
    public error(...message: any[]): void;
    public log(...message: any[]): void;
  }
  export class Homey extends SimpleClass {
    public api: ManagerApi;
    public apps: ManagerApps;
    public arp: ManagerArp;
    public audio: ManagerAudio;
    public clock: ManagerClock;
    public cloud: ManagerCloud
    public flow: ManagerFlow;
    public geolocation: ManagerGeolocation;
    public i18n: ManagerI18n;
    public images: ManagerImages;
    public ledring: ManagerLedring;
    public notifications: ManagerNotifications;
    public settings: ManagerSettings;
  }
  export class ManagerFlow {
    public _registerCard<T>(cardInstance: FlowCard<T>): FlowCard<T>;
    public createToken<T>(id: string, opts: {
      type: string,
      title: string
    }): Promise<FlowToken>;
    public getActionCard<T>(id: string): FlowCardAction<T>;
    public getConditionCard<T>(id: string): FlowCardCondition<T>;
    public getDeviceTriggerCard<T>(id: string): FlowCardTrigger<T>;
    public unregisterToken<T>(tokenInstance: FlowToken): Promise<any>;
  }
  export class ManagerCloud {
    public createOAuth2Callback(apiUrl: string): Promise<CloudOAuth2Callback>;
    public createWebhook(id: string, secret: string, data: any): Promise<CloudWebhook>;
    public getHomeyId(): Promise<string>;
    public getLocalAddress(): Promise<string>;
    public unregisterWebhook(webhook: CloudWebhook): Promise<any>;

  }
  export class CloudWebhook {

    /**
     * This event is fired when a webhook message has been received.
     * @event CloudWebhook#message
     * @param {Object} args
     * @param {Object} args.headers - Received HTTP headers
     * @param {Object} args.query - Received HTTP query string
     * @param {Object} args.body - Received HTTP body
     */
    public on(args: {
      headers: any;
      query: any;
      body: any;
    }): void;

    unregister(): Promise<any>;

  }
  export class ManagerApps {
    constructor(appId: any);
    /**
     * This is a short-hand method to {@link ManagerApps#getInstalled}.
     * @returns {Promise<boolean>}
     */
    public getInstalled<T>(appInstance: ApiApp<T>): Promise<boolean>;
    /**
     * This is a short-hand method to {@link ManagerApps#getVersion}.
     * @returns {Promise<string>}
     */
    public getVersion<T>(appInstance: ApiApp<T>): Promise<string>;
  }
  export class ManagerArp {
    /**
     * Get an ip's MAC address
     * @param {string} ip
     * @returns {Promise<string>}
     */
    getMAC(ip: string): Promise<string>;
  }
  export class ManagerApi {
    public delete(uri: string): Promise<any>;
    public get(uri: string): Promise<any>;
    public getApi<T>(uri: string): Api<T>;
    public getApiApp<T>(appId: string): Api<T>;
    public getLocalUrl(): Promise<string>;
    public getOwnerApiToken(): Promise<string>;
    public post(uri: string, body: any): Promise<string>;
    public put(uri: string, body: any): Promise<string>;
    public realtime(event: string, data: any): void;
    public unregisterApi<T>(api: Api<T>): void


  }
  export class App extends SimpleClass {
    constructor(uri: string);
    protected onInit(): void;
  }
  export type genericCallbackFunction = (err?: Error, store?: any) => void;

  export class Device<T>
  {
    public getAvailable(): boolean;
    public getCapabilities(): Array<ICapabilities>;
    public getCapabilityValue(capabilityId: string): ICapabilities;
    public getClass(): string;
    public getData(): any;
    public getDriver(): Driver<T>;
    public getName(): string;
    public getSetting(key: string): any;
    public getSettings(): any;
    public getState(): any;
    public getStore(): any;
    public getStoreKeys(): Array<string>;
    public getStoreValue(key: string): any;
    public hasCapability(capabilityId: string): boolean;
    public onAdded(): void;
    public onDeleted(): void;
    public onInit(): void;
    public onRenamed(name: string): void;
    public onSettings(oldSettings: any, newSettings: any, changedKeys: Array<any>, callback: genericCallbackFunction): void;
    public ready(callback: () => void): void;
    public registerCapabilityListener(capabilityId: string, fn: (value: any, opt: any, callback: genericCallbackFunction) => void): void;
    public registerMultipleCapabilityListener(capabilityIds: Array<string>, fn: (valueObj: any, optsObj: any, callback: genericCallbackFunction) => void, timeout: number): void;
    public setAlbumArtImage(image: Image, callback?: (err: Error) => void): Promise<T>;
    public setAvailable(callback?: genericCallbackFunction): Promise<T>;
    public setCapabilityValue(capabilityId: string, value: any, callback?: genericCallbackFunction): Promise<T>;
    public setSettings(settings: any, callback?: genericCallbackFunction): Promise<T>;
    public setStoreValue(key: string, value: any, callback?: genericCallbackFunction): Promise<T>;
    public setUnavailable(message: string, callback?: genericCallbackFunction): Promise<T>;
    public setWarning(message: string, callback?: genericCallbackFunction): Promise<T>;
    public triggerCapabilityListener(capabilityId: string, value: any, opts: any, callback?: genericCallbackFunction): Promise<T>;
    public unsetStoreValue(key: string, callback?: genericCallbackFunction): Promise<T>;
    public usetWarning(callback?: genericCallbackFunction): Promise<T>;
  }
  export class Driver<T>{
    public getDevice(deviceData: any): Device<T>;
    public getDevices(): Array<Device<T>>;
    public onInit(): void;
    public onMapDeviceClass(device: Device<T>): Device<T>;
    public onPair(socket: EventEmitter): void;
    public onPairListDevices(data: any, callback: (err: Error, result: Array<Device<T>>) => void): void;
    public ready(callback: () => void): void;
  }
  export class Image {

  }
  export class FlowArgument {
    public registerAutocompleteListener(fn: (query: string, args: any) => Promise<any>): FlowArgument;
  }
  export class FlowCard<T> extends EventEmitter {
    constructor(id: string);
    public getArgument(): FlowArgument;
    public getArgumentValues(): Promise<Array<any>>;
    public registerRunListener(listener: (args: any, state: any) => Promise<any>): FlowCard<T>;
  }
  export class FlowCardCondition<T> extends FlowCard<T>
  {
    constructor(id: string);
  }
  export class FlowCardTrigger<T> extends FlowCard<T>
  {
    constructor(id: string);
    trigger(tokens: any, state: any): Promise<T>;

  }
  export class FlowCardAction<T> extends FlowCard<T>
  {
    constructor(id: string);

  }
  export class FlowCardTriggerDevice<T> extends FlowCard<T>
  {
    constructor(id: string);
    trigger(device: Device<T>, tokens: any, state: any, callback: genericCallbackFunction): Promise<T>;

  }

  export interface IFlowToken {
    type: string,
    title: string
  }
  export type FlowTokenType = string | number | boolean | Image;
  export class FlowToken {
    constructor(id: string, opts: IFlowToken);
    setValue(value: FlowTokenType): Promise<any>;
    unregister(): Promise<any>;
  }
  export interface INotification {
    excerpt: string;

  }
  export class ManagerNotifications {
    createNotification(options: INotification): Promise<void>;
  }
  export class Speaker<T>
  {
    constructor(isActive: boolean, isRegistered: boolean);
    register(speakerState: string, callback?: genericCallbackFunction): Promise<T>;
    sendCommand(command: string, args: Array<T>, callback?: genericCallbackFunction): Promise<T>;
    setInactive(message: string, callback?: genericCallbackFunction): Promise<T>;
    unregister(callback?: genericCallbackFunction): Promise<T>;
    updateState(state: string, callback?: genericCallbackFunction): Promise<T>;
  }
  export type AudioType = Buffer | string
  export class ManagerAudio {
    static playMp3<T>(sampleId: string, sample?: AudioType): Promise<T>;
    static playWav<T>(sampleId: string, sample?: AudioType): Promise<T>;
    static removeMp3<T>(sampleId: string): Promise<T>;
    static removeWav<T>(sampleId: string): Promise<T>;
  }
  export class CloudOAuth2Callback extends EventEmitter {
  }

  export class Api<T>
  {
    constructor(uri: string);
    delete(path: string, callback?: genericCallbackFunction): Promise<T>;
    get(path: string, callback?: genericCallbackFunction): Promise<T>;
    post(path: string, body: any, callback?: genericCallbackFunction): Promise<T>;
    put(path: string, body: any, callback?: genericCallbackFunction): Promise<T>;
    register(): Api<T>;
    unregister(): void;
  }
  export class ApiApp<T> extends Api<T>
  {
    constructor(appId: string);
    getInstalled(callback?: (err: Error, installed: boolean) => void): Promise<T>;
    getVersion(callback?: (err: Error, version: string) => void): Promise<T>;
  }

  export class ManagerGeolocation extends EventEmitter {
    static getAccuracy(): number;
    static getLatitude(): number;
    static getLongitude(): number;
    static getMode(): string;
  }
  export class ManagerClock extends EventEmitter {
    static getTimezone(): string;
  }
  export class CronTask extends EventEmitter {

  }
  export type CronWhenType = string | Date;
  export class ManagerCron {
    static getTask<T>(name: string, callback?: (err: Error, task: CronTask) => void): Promise<T>;
    static getTasks<T>(callback?: (err: Error, logs: Array<CronTask>) => void): Promise<T>;
    static registerTask<T>(name: string, when: CronWhenType, data: any, callback?: (err: Error, task: CronTask) => void): Promise<T>;
    static unregisterAllTasks<T>(callback?: (err: Error) => void): Promise<T>;
    static unregisterTask<T>(name: string, callback?: (err: Error) => void): Promise<T>;
  }
  export class ManagerI18n {
    /**
     * Translate a string, as defined in the app's `/locales/<language>.json` file.
     * This method is also available at @{link Homey#__}
     * @function ManagerI18n#__
     * @name ManagerI18n#__
     * @param {string} key
     * @param {Object} properties - An object of properties to replace. For example, in your json define <em>Hello, __name__!</em>. The property <em>name</em> would contain a string, e.g. <em>Dave</em>.
     * @returns {string} The translated string
     * @example <caption><code>/locales/en.json</code></caption>
     * {
     *   "welcome": "Welcome, __name__!"
     * }
     * @example <caption>/app.js</caption>
     * const Homey = require('homey');
     *
     * let welcomeMessage = Homey.__('welcome', {
     *   name: 'Dave'
     * }
     * console.log( welcomeMessage ); // "Welcome, Dave!"
     */
    __(input: any, context: any): any;

    /**
     * Get Homey's current language
     * @returns {string} The language as a 2-character string (e.g. `en`)
     */
    getLanguage(): string;
    /**
     * Get Homey's current units
     * @returns {string} `metric` or `imperial`
     */
    getUnits(): string;
  }
  export class ManagerImages {
    /**
     * Get a registered {@link Image}.
     * @param {String} id
     * @returns {Image|Error}
     */
    getImage(id: string): Image;

    createImage(): Promise<Image>;
    /**
     * Unregister a {@link Image}.
     * @param {Image} imageInstance
     * @returns {Promise<void>}
     */
    unregisterImage(imageInstance: Image): Promise<void>;
  }

  export class ManagerLedring {

    createAnimation(opts: {
      frames: Array<LedringAnimation>,
      priority: string,
      transition: number,
      duration: number | boolean,
      options: {
        fps: number,
        tfps: number,
        rpm: number
      }
    }): Promise<LedringAnimation>;
    createProgressAnimation(opts:
      {
        priority: string,
        options: {
          color: string
        }
      }): Promise<void>;

    createSystemAnimation(systemId: string,
      opts: {
        priority: string,
        duration: number | boolean
      }): Promise<LedringAnimation>;
    /**
     * Register a LED Ring animation.
     * @param {LedringAnimation} animationInstance
     * @returns {Promise<LedringAnimation>}
     */
    registerAnimation(animationInstance: LedringAnimation): Promise<LedringAnimation>;
    /**
     * Unregister a LED Ring animation.
     * @param {LedringAnimation} animationInstance
     * @returns {Promise<LedringAnimation>}
     */
    unregisterAnimation(animationInstance: LedringAnimation): Promise<LedringAnimation>;
    /**
     * Register a LED Ring screensaver.
     * @param {string} name - Name of the animation as defined in your app's `app.json`.
     * @param {LedringAnimation} animationInstance
     * @returns {Promise<any>}
     */
    registerScreensaver(name: string, animationInstance: LedringAnimation): Promise<any>;
    /**
     * Unregister a LED Ring screensaver.
     * @param {string} name - Name of the animation as defined in your app's `app.json`.
     * @param {LedringAnimation} animationInstance
     * @returns {Promise<any>}
     */
    unregisterScreensaver(name: string, animationInstance: LedringAnimation): Promise<any>;
  }
  export class LedringAnimation {
    /**
     * @event LedringAnimation#start
     * @desc When the animation has started
     */
    /**
     * @event LedringAnimation#stop
     * @desc When the animation has stopped
     */
    /**
     * @event LedringAnimation#finish
     * @desc When the animation has finished (duration has been reached)
     */
    /**
     * Start the animation.
     * @returns {Promise<any>}
     */
    start(): Promise<any>;
    /**
     * Stop the animation.
     * @returns {Promise<any>}
     */
    stop(): Promise<any>;
    /**
     * Update the animation frames.
     * @param {Array} frames
     * @returns {Promise<any>}
     */
    updateFrames(frames: any[]): Promise<any>;
    /**
     * Register the animation. This is a shorthand method to {@link ManagerLedring#registerAnimation}.
     * @returns {Promise<LedringAnimation>}
     */
    register(): Promise<LedringAnimation>;
    /**
     * Unregister the animation. This is a shorthand method to {@link ManagerLedring#unregisterAnimation}.
     * @returns {Promise<LedringAnimation>}
     */
    unregister(): Promise<LedringAnimation>;
    /**
     * Register this animation as a screensaver. This is a shorthand method to {@link ManagerLedring#registerScreensaver}.
     * @param {String} screensaverName - The name of the screensaver, as defined in `/app.json`
     * @returns {Promise<any>}
     */
    registerScreensaver(screensaverId: any): Promise<any>;
    /**
     * Unregister this animation as a screensaver. This is a shorthand method to {@link ManagerLedring#unregisterScreensaver}.
     * @param {String} screensaverName - The name of the screensaver, as defined in `/app.json`
     * @returns {Promise<any>}
     */
    unregisterScreensaver(screensaverId: any): Promise<any>;
  }
  export class ManagerSettings extends EventEmitter {
    /**
     * Get all settings keys.
     * @returns {String[]}
     */
    getKeys(): Array<String>;
    /**
     * Get a setting.
     * @param {string} key
     * @returns {Mixed} value
     */
    get(key: string): any;
    /**
     * Fires when a setting has been set.
     * @event ManagerSettings#set
     * @param {String} key
     */
    /**
     * Set a setting.
     * @param {string} key
     * @param {Mixed} value
     */
    set(key: string, value: any): void;
    /**
     * Fires when a setting has been unset.
     * @event ManagerSettings#unset
     * @param {String} key
     */
    /**
     * Unset (delete) a setting.
     * @param {string} key
     */
    unset(key: string): void;
  }
}

