import Homey = require('homey');
import config = require('nconf');
config.file('env.json');
process.env.DEBUG = config.get("DEBUG");
import fs from "fs-extra";
cloneConfig();
import * as manager from "./prayers/manager";
import prayersController from "./controllers/prayers.controller";
import { IPrayersController, IPrayersView, IPrayersViewRow } from "./controllers/controllers.interface";
import { App } from "./routes/main.router";
import * as sentry from "@sentry/node";
import * as prayerlib from "@dpanet/prayers-lib";
import { realpath } from 'fs';
import { UserWithThatEmailAlreadyExistsException } from './exceptions/exception.handler';

sentry.init({ dsn: config.get("DSN") });
class PrayersApp extends Homey.App {
  private _prayersController: prayersController;
  async onInit() {
    try {

      this.log(` Prayers Alert App is running! `);
      this._prayersController = new prayersController(prayerlib.ConfigProviderFactory.createConfigProviderFactory(prayerlib.ConfigProviderName.CLIENT));
      await this._prayersController.initializePrayerManger();
      // manager.PrayersAppManager.initApp(this.homey);
      this.log('I ran successfully');
    }
    catch (err) {
      sentry.captureException(err);
      this.log(err);
    }

  }
  public getPrayersAdjustments(): prayerlib.IPrayerAdjustments[] {
    return this._prayersController.router.getPrayersAdjustments() as prayerlib.IPrayerAdjustments[];
  }
  public getPrayersSettings(): prayerlib.IPrayersSettings {
    return this._prayersController.router.getPrayersSettings() as prayerlib.IPrayersSettings;
  }
  public getPrayers(): prayerlib.IPrayers {
    return this._prayersController.router.getPrayers() as prayerlib.IPrayers;
  }
  public getPrayersView(): IPrayersView[] {
    return this._prayersController.router.getPrayersView() as IPrayersView[];
  }
  public async getPrayersByCalculation(config: any): Promise<IPrayersViewRow[]> {
    //Send Config
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
}
function cloneConfig() {
  fs.copySync(Homey.env.NODE_CONFIG_DIR, Homey.env.CONFIG_FOLDER_PATH, { overwrite: false });
}
module.exports = PrayersApp;

