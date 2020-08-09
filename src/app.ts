console.log("I'm Running**************");
import Homey = require('homey');
import config = require('nconf');
config.file('env.json');
// console.log(config.get("DEBUG"));
// process.env.DEBUG = config.get("DEBUG");
// import fs from "fs-extra";
// cloneConfig();
// console.log("finished clonning file is running");

import * as manager from "./prayers/manager";
import prayersController from "./controllers/prayers.controller";
import HomeyConfigurator, {ConfigSettingsKeys} from "./configurations/configuration.controller";
import { IPrayersView, IPrayersViewRow } from "./controllers/controllers.interface";
import * as sentry from "@sentry/node";
import * as prayerlib from "@dpanet/prayers-lib";
import util from "util";

sentry.init({ dsn: config.get("DSN") });
class PrayersApp extends Homey.App {
  private _prayersController: prayersController;
  private _homeyConfigurator: prayerlib.IConfigProvider;
  private _iConfig:prayerlib.IConfig;
  async onInit() {
    try {

      this.log(` Prayers Alert App is running! `);
      this.initalizeConfig();
      this.log( new Date('2020-08-09 15:00'));
    // await this.initalizeTest();
      this._prayersController = new prayersController(this._homeyConfigurator);
       await this._prayersController.initializePrayerManger();
       manager.PrayersAppManager.initApp(this.homey,this._homeyConfigurator);
      this.log('I ran successfully');
    }
    catch (err) {
      sentry.captureException(err);
      this.log(err);
    }

  }
  async initalizeTest() {
    let configProvider:prayerlib.IConfigProvider = prayerlib.ConfigProviderFactory.createConfigProviderFactory(prayerlib.ClientConfigurator);
    let prayerConfig: prayerlib.IPrayersConfig = await configProvider.getPrayerConfig();
    let locationConfig: prayerlib.ILocationConfig = await configProvider.getLocationConfig();
    let prayerManager: prayerlib.IPrayerManager = await prayerlib.PrayerTimeBuilder
            .createPrayerTimeBuilder(locationConfig, prayerConfig)
            .createPrayerTimeManager() ;
    //let prayersContoller:PrayersController = new PrayersController(configProvider);
    //await prayersContoller.initializePrayerManger();
    console.log(util.inspect(  prayerManager.getPrayers(), {showHidden: false, depth: null}));
  }
  public getPrayersAdjustments(): prayerlib.IPrayerAdjustments[] {
    return this._prayersController.router.getPrayersAdjustments() as prayerlib.IPrayerAdjustments[];
  }
  public getPrayersSettings(): prayerlib.IPrayersSettings {
    return this._prayersController.router.getPrayersSettings() as prayerlib.IPrayersSettings;
  }
  public getPrayers(): prayerlib.IPrayers {
    //console.log(util.inspect(this._prayersController.router.getPrayers(), {showHidden: false, depth: null}))
    //console.log(this._prayersController.router.getPrayers());
    return this._prayersController.router.getPrayers() as prayerlib.IPrayers;
  }
  public getPrayersView(): IPrayersView[] {
    return this._prayersController.router.getPrayersView() as IPrayersView[];
  }
  public async getPrayersByCalculation(config: any): Promise<IPrayersViewRow[]> {
    return await this._prayersController.router.getPrayersByCalculation(config) as IPrayersViewRow[]
  }
  public async loadSettings(): Promise<void> {
    await this._prayersController.router.loadSettings();
  }
  public async setPrayersByCalculation(config: any): Promise<IPrayersViewRow[]> {
    return await this._prayersController.router.setPrayersByCalculation(config) as IPrayersViewRow[]

  }
  public getPrayersLocationSettings(): prayerlib.ILocationSettings {
    return this._prayersController.router.getPrayersLocationSettings() as prayerlib.ILocationSettings;
  }
  public async searchLocation(locationConfig: any): Promise<prayerlib.ILocationSettings> {
    return await this._prayersController.router.searchLocation(locationConfig) as prayerlib.ILocationSettings;
  }
  public async initalizeConfig() {
    //fs.copySync(Homey.env.NODE_CONFIG_DIR, Homey.env.CONFIG_FOLDER_PATH, { overwrite: false });
    try {
    //  this.homey.settings.unset(ConfigSettingsKeys.LocationConfigKey);
      //this.homey.settings.unset(ConfigSettingsKeys.PrayersConfigKey);
      this._homeyConfigurator = prayerlib.ConfigProviderFactory.createConfigProviderFactory(HomeyConfigurator, this.homey);
      this._iConfig = await this._homeyConfigurator.getConfig();


    } catch (err) {
     // await this._homeyConfigurator.createDefaultConfig()
      console.log(err)
    }
  }
}


module.exports = PrayersApp;

