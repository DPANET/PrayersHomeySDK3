"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const nconf_1 = __importDefault(require("nconf"));
const prayerlib = __importStar(require("@dpanet/prayers-lib"));
const moment_1 = __importDefault(require("moment"));
//import { NextFunction, NextHandleFunction } from "connect";
const exception_handler_1 = require("../exceptions/exception.handler");
const sentry = __importStar(require("@sentry/node"));
const validationController = __importStar(require("../middlewares/validations.middleware"));
const validators = __importStar(require("../validators/validations"));
const retry = __importStar(require("async-retry"));
const R = __importStar(require("ramda"));
const composition_1 = __importDefault(require("@arrows/composition"));
sentry.init({ dsn: nconf_1.default.get("DSN") });
class PrayersController {
    constructor(configProvider) {
        this.searchLocation = async (request) => {
            try {
                let locationSettings;
                let address = request;
                locationSettings = await prayerlib.LocationBuilder.createLocationBuilder()
                    .setLocationAddress(address.address)
                    .createLocation();
                return locationSettings;
            }
            catch (err) {
                sentry.captureException(err);
                new exception_handler_1.HttpException(404, err.message);
            }
        };
        this.getPrayerLocation = (request) => {
            try {
                return this._prayerManager.getPrayerLocationSettings();
            }
            catch (err) {
                sentry.captureException(err);
                throw new exception_handler_1.HttpException(404, err.message);
            }
        };
        this.reloadConfig = async (request) => {
            try {
                await this.initializePrayerManger();
            }
            catch (err) {
                sentry.captureException(err);
                throw new exception_handler_1.HttpException(404, err.message);
            }
        };
        this.validatePrayerConfigRequest = async (request) => {
            try {
                console.log("prayerconfig " + request.prayerConfig);
                let result = this._validationConfigPrayerObject(request.prayerConfig);
                console.log(result);
                return request;
                // fn(request, response, next);
            }
            catch (err) {
                sentry.captureException(err);
                throw new exception_handler_1.HttpException(404, err.message);
            }
        };
        this.validateLocationConfigRequest = async (request) => {
            try {
                let result = this._validateConfigLocationObject(request.locationConfig);
                return request;
            }
            catch (err) {
                sentry.captureException(err);
                throw new exception_handler_1.HttpException(404, err.message);
            }
        };
        this.validatePrayerManagerRequest = async (request) => {
            try {
                let result = this._validatePrayerManager(this._prayerManager);
            }
            catch (err) {
                console.log('caught new error');
                sentry.captureException(err);
                throw new exception_handler_1.HttpException(404, err.message);
            }
        };
        this.updatePrayersByCalculation = async (request) => {
            try {
                let prayerConfig = this.buildPrayerConfigObject(request.prayerConfig);
                let locationConfig = request.locationConfig;
                this._prayerManager = await this.refreshPrayerManager(prayerConfig, locationConfig);
                // await this._prayerManager.updatePrayerConfig(this._prayerManager.getPrayerConfig(), null,this._configProvider);
                //await this._prayerManager.updateLocationConfig(this._prayerManager.getLocationConfig(), null,this._configProvider);
                await this._configProvider.updateLocationConfig(locationConfig);
                await this._configProvider.updatePrayerConfig(prayerConfig);
                // prayerConfig = await new prayerlib.Configurator().getPrayerConfig();
                // this._prayerManager = await this.refreshPrayerManager(prayerConfig,locationConfig)
                return true;
            }
            catch (err) {
                sentry.captureException(err);
                throw new exception_handler_1.HttpException(404, err.message);
            }
        };
        this.getPrayersByCalculation = async (request) => {
            try {
                let config = request;
                let prayerConfig = this.buildPrayerConfigObject(config.prayerConfig);
                let locationConfig = config.locationConfig;
                //let locationConfig: prayerlib.ILocationConfig = await new prayerlib.Configurator().getLocationConfig();
                this._prayerManager = await this.refreshPrayerManager(prayerConfig, locationConfig);
                return this.createPrayerViewRow(this.createPrayerView(this._prayerManager.getPrayers()));
            }
            catch (err) {
                sentry.captureException(err);
                throw new exception_handler_1.HttpException(404, err.message);
            }
        };
        this.putPrayersSettings = (request) => {
            let prayerSettings = request.body;
        };
        this.getPrayerAdjsutments = (request) => {
            try {
                console.log('Some Executed Prayer Adjustments');
                let prayerAdjustments = this._prayerManager.getPrayerAdjsutments();
                return prayerAdjustments;
            }
            catch (err) {
                sentry.captureException(err);
                throw new exception_handler_1.HttpException(404, err.message);
            }
        };
        this.getPrayersSettings = (request) => {
            try {
                let prayersSettings = this._prayerManager.getPrayerSettings().toJSON();
                return prayersSettings;
            }
            catch (err) {
                sentry.captureException(err);
                throw new exception_handler_1.HttpException(404, err.message);
            }
        };
        this.getPrayers = (request) => {
            try {
                let prayers = this._prayerManager.getPrayers();
                return prayers;
            }
            catch (err) {
                sentry.captureException(err);
                throw new exception_handler_1.HttpException(404, err.message);
            }
        };
        this.getPrayerView = (request) => {
            try {
                let prayersView = this.createPrayerView(this._prayerManager.getPrayers());
                return prayersView;
            }
            catch (err) {
                sentry.captureException(err);
                throw new exception_handler_1.HttpException(404, err.message);
            }
        };
        this.getPrayerViewRow = (request) => {
            try {
                let prayerViewRow = this.createPrayerViewRow(this.createPrayerView(this._prayerManager.getPrayers()));
                //  response.json(prayerViewRow);
            }
            catch (err) {
                sentry.captureException(err);
                //  next(new HttpException(404, err.message));
            }
        };
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
    initializeValidators() {
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
    initializeRoutes() {
        // this.router.all(this.path,authCheck);
        this.router = {
            getPrayersAdjustments: composition_1.default.rail(this.validatePrayerManagerRequest, this.getPrayerAdjsutments),
            getPrayersSettings: composition_1.default.rail(this.validatePrayerManagerRequest, this.getPrayersSettings),
            getPrayers: composition_1.default.rail(this.validatePrayerManagerRequest, this.getPrayers),
            getPrayersView: composition_1.default.rail(this.validatePrayerManagerRequest, this.getPrayerView),
            getPrayersByCalculation: composition_1.default.railAsync(this.validatePrayerConfigRequest, this.validateLocationConfigRequest, this.getPrayersByCalculation),
            loadSettings: composition_1.default.tap(this.reloadConfig),
            setPrayersByCalculation: composition_1.default.railAsync(this.validatePrayerConfigRequest, this.validateLocationConfigRequest, this.updatePrayersByCalculation),
            getPrayersLocationSettings: composition_1.default.rail(this.validatePrayerManagerRequest, this.getPrayerLocation),
            searchLocation: composition_1.default.railAsync(this.searchLocation)
        };
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
    getPrayerManager() {
        return this._prayerManager;
    }
    buildPrayerConfigObject(prayerConfigObject) {
        for (var key in prayerConfigObject) {
            switch (key) {
                case "_":
                    delete prayerConfigObject['_'];
                    break;
                case "startDate":
                case "endDate":
                    prayerConfigObject[key] = new Date(prayerConfigObject[key]);
                    break;
                case "adjustments":
                    let adjustmentArray = prayerConfigObject[key];
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
    createPrayerViewRow(prayersView) {
        let prayerViewRow = new Array();
        prayersView.forEach((prayerViewObject, index, arr) => {
            prayerViewRow.push({ prayersDate: prayerViewObject.prayersDate, prayerName: prayerlib.PrayersName.FAJR, prayerTime: prayerViewObject.Fajr }, { prayersDate: prayerViewObject.prayersDate, prayerName: prayerlib.PrayersName.SUNRISE, prayerTime: prayerViewObject.Sunrise }, { prayersDate: prayerViewObject.prayersDate, prayerName: prayerlib.PrayersName.DHUHR, prayerTime: prayerViewObject.Dhuhr }, { prayersDate: prayerViewObject.prayersDate, prayerName: prayerlib.PrayersName.ASR, prayerTime: prayerViewObject.Asr }, { prayersDate: prayerViewObject.prayersDate, prayerName: prayerlib.PrayersName.SUNSET, prayerTime: prayerViewObject.Sunset }, { prayersDate: prayerViewObject.prayersDate, prayerName: prayerlib.PrayersName.MAGHRIB, prayerTime: prayerViewObject.Maghrib }, { prayersDate: prayerViewObject.prayersDate, prayerName: prayerlib.PrayersName.ISHA, prayerTime: prayerViewObject.Isha }, { prayersDate: prayerViewObject.prayersDate, prayerName: prayerlib.PrayersName.MIDNIGHT, prayerTime: prayerViewObject.Midnight });
        });
        return prayerViewRow;
    }
    createPrayerView(prayers) {
        let sortObject = (obj) => {
            return {
                prayersDate: moment_1.default(obj.prayersDate).toDate().toDateString(),
                Imsak: moment_1.default(obj.Imsak).format('LT'),
                Fajr: moment_1.default(obj.Fajr).format('LT'),
                Sunrise: moment_1.default(obj.Sunrise).format('LT'),
                Dhuhr: moment_1.default(obj.Dhuhr).format('LT'),
                Asr: moment_1.default(obj.Asr).format('LT'),
                Sunset: moment_1.default(obj.Sunset).format('LT'),
                Maghrib: moment_1.default(obj.Maghrib).format('LT'),
                Isha: moment_1.default(obj.Isha).format('LT'),
                Midnight: moment_1.default(obj.Midnight).format('LT'),
            };
        };
        let swapPrayers = (x) => R.assoc(x.prayerName, x.prayerTime, x);
        let removePrayers = (x) => R.omit(['prayerName', 'prayerTime', 'undefined'], x);
        let prayerTime = R.pipe(swapPrayers, removePrayers);
        let prayerTimes = (x) => R.map(prayerTime, x);
        let prayersList = (x) => R.append({ prayersDate: x.prayersDate }, x.prayerTime);
        let projectPrayers = R.curry(sortObject);
        let pump = R.pipe(prayersList, prayerTimes, R.mergeAll, projectPrayers);
        return R.map(pump, prayers);
    }
    async refreshPrayerManager(prayerConfig, locationConfig) {
        let count = 0;
        try {
            return await retry.default(async (bail) => {
                count += 1;
                let _prayerManager = await prayerlib.PrayerTimeBuilder
                    .createPrayerTimeBuilder(locationConfig, prayerConfig)
                    .createPrayerTimeManager();
                return _prayerManager;
            }, {
                retries: 1,
                minTimeout: 1000
            });
        }
        catch (err) {
            return Promise.reject(err);
        }
    }
    async initializePrayerManger() {
        try {
            let locationConfig = await this._configProvider.getLocationConfig();
            let prayerConfig = await this._configProvider.getPrayerConfig();
            this._prayerManager = await this.refreshPrayerManager(prayerConfig, locationConfig);
        }
        catch (err) {
            sentry.captureException(err);
            throw err;
        }
    }
    static getPrayerController() {
        return;
    }
}
exports.default = PrayersController;
