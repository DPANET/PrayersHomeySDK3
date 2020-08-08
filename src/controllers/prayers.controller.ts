import config from 'nconf';
import * as prayerlib from "@dpanet/prayers-lib";
import { IController, IPrayersController } from "./controllers.interface";
import { IPrayersView, IPrayersViewRow } from "./views.interface";
import moment from "moment";
//import { NextFunction, NextHandleFunction } from "connect";
import { HttpException } from "../exceptions/exception.handler";
import * as sentry from "@sentry/node";
import * as validationController from "../middlewares/validations.middleware"
import * as validators from "../validators/validations";
import * as retry from "async-retry";
import { listenerCount } from 'cluster';
import * as R from "ramda";
import arrows from "@arrows/composition";
import { IPrayerAdjustments } from '@dpanet/prayers-lib';
sentry.init({ dsn: config.get("DSN") });
export default class PrayersController implements IController {
    path: string;
    router: IPrayersController;
    private _prayersController: PrayersController;
    private _prayerManager: prayerlib.IPrayerManager;
    private _validationController: validationController.ValidationMiddleware;
    private _validatePrayerManager: any;
    private _validateConfigPrayerParam: Function;
    private _validateConfigPrayerBody: Function;
    private _validateConfigLocationObject: Function;
    private _validationConfigPrayerObject: Function;
    private _configProvider: prayerlib.IConfigProvider;
    constructor(configProvider: prayerlib.IConfigProvider) {
        try {

            this.path = "/api/app/com.prayerssapp/PrayerManager";
            this._validationController = new validationController.ValidationMiddleware();
            this._configProvider = configProvider;
            this.initializeValidators();
            //  this.prayerViewMobileRequestValidator =
            // this.initializePrayerManger()
            //     .then(() => {

            //     })
            //     .catch((err) => { throw err });
            this.initializeRoutes();
        }
        catch (err) {
            throw err;
        }
    }
    private initializeValidators() {
        //    this._validatePrayerManager = arrows.curry( this._validationController.validationMiddlewareByObject );
        //     this._validatePrayerManager = this._validatePrayerManager(validators.PrayerMangerValidator.createValidator());
        //console.log("validation run successfuly")
        this._validatePrayerManager = this._validationController
            .validationMiddlewareByObject.bind(this, validators.PrayerMangerValidator.createValidator());
        // // this._validateConfigPrayerParam = this._validationController.validationMiddlewareByRequest
        //     .bind(this, validators.PrayerConfigValidator.createValidator(), validationController.ParameterType.query);
        // this._validateConfigPrayerBody = this._validationController.validationMiddlewareByRequest
        //     .bind(this, validators.PrayerConfigValidator.createValidator(), validationController.ParameterType.body);
        this._validateConfigLocationObject = this._validationController.validationMiddlewareByObject
            .bind(this, validators.LocationConfigValidator.createValidator());
        this._validationConfigPrayerObject = this._validationController.validationMiddlewareByObject
            .bind(this, validators.PrayerConfigValidator.createValidator());
        //  this.validateConfigLocationRequest = this._validationController.validationMiddlewareByObject.bind(this,validato)
    }
    private initializeRoutes() {
        // this.router.all(this.path,authCheck);
        this.router = {
            getPrayersAdjustments: arrows.rail(this.validatePrayerManagerRequest, this.getPrayerAdjsutments),
            getPrayersSettings: arrows.rail(this.validatePrayerManagerRequest, this.getPrayersSettings),
            getPrayers: arrows.rail(this.validatePrayerManagerRequest, this.getPrayers),
            getPrayersView: arrows.rail(this.validatePrayerManagerRequest, this.getPrayerView),
            getPrayersByCalculation: arrows.railAsync(this.validatePrayerConfigRequest, this.validateLocationConfigRequest, this.getPrayersByCalculation),
            loadSettings: arrows.tap(this.reloadConfig),
            setPrayersByCalculation: arrows.railAsync(this.validatePrayerConfigRequest, this.validateLocationConfigRequest, this.updatePrayersByCalculation),
            getPrayersLocationSettings: arrows.rail(this.validatePrayerManagerRequest, this.getPrayerLocation),
            searchLocation: arrows.railAsync(this.searchLocation)
        }
        //console.log("validation run successfuly")
        // this.router.get(this.path + "/PrayersAdjustments", this.validatePrayerManagerRequest, this.getPrayerAdjsutments);
        // this.router.get(this.path + "/PrayersSettings", this.validatePrayerManagerRequest, this.getPrayersSettings);
        // this.router.get(this.path + "/Prayers", this.validatePrayerManagerRequest, this.getPrayers);
        // this.router.get(this.path + "/PrayersViewDesktop", this.validatePrayerManagerRequest, this.getPrayerView);
        // this.router.get(this.path + "/PrayersViewMobile", this.validatePrayerConfigRequest,this.validateLocationConfigRequest, this.getPrayersByCalculation);
        // this.router.get(this.path + "/LoadSettings", this.reloadConfig)
        // this.router.post(this.path + "/PrayersViewMobile/",  this.validatePrayerConfigRequest,this.validateLocationConfigRequest, this.updatePrayersByCalculation);
        // this.router.get(this.path + "/PrayersLocation/", this.validatePrayerManagerRequest, this.getPrayerLocation);
        // this.router.get(this.path +"/SearchLocation/",this.searchLocation)
        //  this.router.put(this.path + "/PrayersSettings/:id", this.putPrayersSettings);
    }
    private searchLocation = async (request: any) => {
        try {
            let locationSettings: prayerlib.ILocationSettings;
            let address = request;
            locationSettings = await prayerlib.LocationBuilder.createLocationBuilder()
                .setLocationAddress(address.address)
                .createLocation();
            return locationSettings;
        }
        catch (err) {
            console.log(err)
            sentry.captureException(err);
            new HttpException(404, err.message);
        }
    }
    private getPrayerLocation = (request: any) => {
        try {

            return this._prayerManager.getPrayerLocationSettings();
        }
        catch (err) {
         
            sentry.captureException(err);
            throw new HttpException(404, err.message);

        }
    }
    private reloadConfig = async (request: any) => {
        try {
            await this.initializePrayerManger();
        }
        catch (err) {
         
            sentry.captureException(err);
            throw new HttpException(404, err.message);

        }
    }
    private validatePrayerConfigRequest = async (request: any) => {
        try {
            console.log("prayerconfig "+request.prayerConfig)
            let result: boolean = this._validationConfigPrayerObject(request.prayerConfig);
            console.log(result);
            return request;
            // fn(request, response, next);
        }
        catch (err) {
            sentry.captureException(err);
            throw new HttpException(404, err.message);
        }
    }
    private validateLocationConfigRequest = async (request: any) => {
        try {
            let result = this._validateConfigLocationObject(request.locationConfig);
            return request;
        }
        catch (err) {
            sentry.captureException(err);
            throw new HttpException(404, err.message);
        }
    }
    private validatePrayerManagerRequest = async (request: any) => {
        try {

            let result: boolean = this._validatePrayerManager(this._prayerManager);
        }
        catch (err) {
            console.log('caught new error')

            sentry.captureException(err);
            throw new HttpException(404, err.message);
        }
    }
    private getPrayerManager() {
        return this._prayerManager;
    }

    private updatePrayersByCalculation = async (request: any) => {
        try {
            let prayerConfig: prayerlib.IPrayersConfig = this.buildPrayerConfigObject(request.prayerConfig);
            let locationConfig: prayerlib.ILocationConfig = request.locationConfig;
            this._prayerManager = await this.refreshPrayerManager(prayerConfig, locationConfig);
           // await this._prayerManager.updatePrayerConfig(this._prayerManager.getPrayerConfig(), null,this._configProvider);
            //await this._prayerManager.updateLocationConfig(this._prayerManager.getLocationConfig(), null,this._configProvider);
            await this._configProvider.updateLocationConfig(locationConfig);
            await this._configProvider.updatePrayerConfig(prayerConfig)
            // prayerConfig = await new prayerlib.Configurator().getPrayerConfig();
            // this._prayerManager = await this.refreshPrayerManager(prayerConfig,locationConfig)
            return true
        }
        catch (err) {
            sentry.captureException(err);
            throw new HttpException(404, err.message);
        }
    }
    private getPrayersByCalculation = async (request: any) => {
        try {
            let config: any = request;
            let prayerConfig: prayerlib.IPrayersConfig = this.buildPrayerConfigObject(config.prayerConfig);
            let locationConfig: prayerlib.ILocationConfig = config.locationConfig;
            //let locationConfig: prayerlib.ILocationConfig = await new prayerlib.Configurator().getLocationConfig();
            this._prayerManager = await this.refreshPrayerManager(prayerConfig, locationConfig);
            return this.createPrayerViewRow(this.createPrayerView(this._prayerManager.getPrayers()));
        } catch (err) {
            sentry.captureException(err);
            throw new HttpException(404, err.message);
        }
    }
    private buildPrayerConfigObject(prayerConfigObject: any): prayerlib.IPrayersConfig {
        for (var key in prayerConfigObject) {
            switch (key) {
                case "_": delete prayerConfigObject['_'];
                    break;
                case "startDate":
                case "endDate":
                    prayerConfigObject[key] = new Date(prayerConfigObject[key]);
                    break;
                case "adjustments":
                    let adjustmentArray: Array<any> = prayerConfigObject[key];
                    for (var adjustkey in adjustmentArray) {
                        adjustmentArray[adjustkey].adjustments = parseInt(adjustmentArray[adjustkey].adjustments);
                    }
                    break;
                case "method":
                case "school":
                case "latitudeAdjustment":
                case "midnight":
                case "adjustmentMethod":
                    prayerConfigObject[key] = parseInt(prayerConfigObject[key]);
                    break;
            }
        }
        return prayerConfigObject;
    }
    private putPrayersSettings = (request: any) => {
        let prayerSettings: prayerlib.IPrayersSettings = request.body;
    }
    private getPrayerAdjsutments = (request: any): prayerlib.IPrayerAdjustments[] => {
        try {
            console.log('Some Executed Prayer Adjustments')
            let prayerAdjustments: prayerlib.IPrayerAdjustments[] = this._prayerManager.getPrayerAdjsutments();
            return prayerAdjustments;
        }
        catch (err) {
            sentry.captureException(err);
            throw new HttpException(404, err.message);
        }
    }

    private getPrayersSettings = (request: any) => {
        try {
            let prayersSettings: prayerlib.IPrayersSettings = (this._prayerManager.getPrayerSettings() as prayerlib.PrayersSettings).toJSON();
            return prayersSettings;
        }
        catch (err) {
            sentry.captureException(err);
            throw new HttpException(404, err.message);

        }
    }
    private getPrayers = (request: any) => {
        try {
            let prayers: prayerlib.IPrayers[] = (this._prayerManager.getPrayers() as prayerlib.Prayers[]);
            return prayers;
        }
        catch (err) {
            sentry.captureException(err);

            throw new HttpException(404, err.message);
        }
    }
    private getPrayerView = (request: any) => {
        try {
            let prayersView: IPrayersView[] = this.createPrayerView(this._prayerManager.getPrayers());
            return prayersView;
        }
        catch (err) {
            sentry.captureException(err);
            throw new HttpException(404, err.message);
        }

    }
    private getPrayerViewRow = (request:any) => {
        try {
            let prayerViewRow: Array<IPrayersViewRow> = this.createPrayerViewRow(this.createPrayerView(this._prayerManager.getPrayers()));
          //  response.json(prayerViewRow);
        }
        catch (err) {
            sentry.captureException(err);

          //  next(new HttpException(404, err.message));
        }
    }
    private createPrayerViewRow(prayersView: IPrayersView[]) {
        let prayerViewRow: Array<IPrayersViewRow> = new Array<IPrayersViewRow>();
        prayersView.forEach((prayerViewObject, index, arr) => {
            prayerViewRow.push(
                { prayersDate: prayerViewObject.prayersDate, prayerName: prayerlib.PrayersName.FAJR, prayerTime: prayerViewObject.Fajr },
                { prayersDate: prayerViewObject.prayersDate, prayerName: prayerlib.PrayersName.SUNRISE, prayerTime: prayerViewObject.Sunrise },
                { prayersDate: prayerViewObject.prayersDate, prayerName: prayerlib.PrayersName.DHUHR, prayerTime: prayerViewObject.Dhuhr },
                { prayersDate: prayerViewObject.prayersDate, prayerName: prayerlib.PrayersName.ASR, prayerTime: prayerViewObject.Asr },
                { prayersDate: prayerViewObject.prayersDate, prayerName: prayerlib.PrayersName.SUNSET, prayerTime: prayerViewObject.Sunset },
                { prayersDate: prayerViewObject.prayersDate, prayerName: prayerlib.PrayersName.MAGHRIB, prayerTime: prayerViewObject.Maghrib },
                { prayersDate: prayerViewObject.prayersDate, prayerName: prayerlib.PrayersName.ISHA, prayerTime: prayerViewObject.Isha },
                { prayersDate: prayerViewObject.prayersDate, prayerName: prayerlib.PrayersName.MIDNIGHT, prayerTime: prayerViewObject.Midnight });
        });
        return prayerViewRow;
    }

    private createPrayerView(prayers: prayerlib.IPrayers[]) {
        let sortObject = (obj: IPrayersView): IPrayersView => {
            return {
                prayersDate: moment(obj.prayersDate).toDate().toDateString(),
                Imsak: moment(obj.Imsak).format('LT'),
                Fajr: moment(obj.Fajr).format('LT'),
                Sunrise: moment(obj.Sunrise).format('LT'),
                Dhuhr: moment(obj.Dhuhr).format('LT'),
                Asr: moment(obj.Asr).format('LT'),
                Sunset: moment(obj.Sunset).format('LT'),
                Maghrib: moment(obj.Maghrib).format('LT'),
                Isha: moment(obj.Isha).format('LT'),
                Midnight: moment(obj.Midnight).format('LT'),
            }
        }
        let swapPrayers = (x: any) => R.assoc(x.prayerName, x.prayerTime, x)
        let removePrayers = (x: any) => R.omit(['prayerName', 'prayerTime', 'undefined'], x)
        let prayerTime = R.pipe(swapPrayers, removePrayers)
        let prayerTimes = (x: any) => R.map(prayerTime, x)
        let prayersList = (x: any) => R.append({ prayersDate: x.prayersDate }, x.prayerTime)
        let projectPrayers = R.curry(sortObject)
        let pump = R.pipe(prayersList, prayerTimes, R.mergeAll, projectPrayers)
        return R.map(pump, prayers);
    }
    private async refreshPrayerManager(prayerConfig: prayerlib.IPrayersConfig, locationConfig: prayerlib.ILocationConfig): Promise<prayerlib.IPrayerManager> {
        let count: number = 0
        try {
            return await retry.default(async bail => {
                count += 1;
                let _prayerManager: prayerlib.IPrayerManager = await prayerlib.PrayerTimeBuilder
                    .createPrayerTimeBuilder(locationConfig, prayerConfig)
                    .createPrayerTimeManager();
                return _prayerManager;
            }
                , {
                    retries: 1,
                    minTimeout: 1000
                })
        }
        catch (err) {
            return Promise.reject(err);
        }
    }
    public async initializePrayerManger(): Promise<void> {
        try {

            let locationConfig: prayerlib.ILocationConfig = await this._configProvider.getLocationConfig();
            let prayerConfig: prayerlib.IPrayersConfig = await this._configProvider.getPrayerConfig();
            this._prayerManager = await this.refreshPrayerManager(prayerConfig, locationConfig);
        }
        catch (err) {
            sentry.captureException(err);
            throw err;
        }
    }
    static getPrayerController(): PrayersController {

        return;

    }
}


