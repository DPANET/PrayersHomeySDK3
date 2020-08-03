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
    if (mod != null) for (var k in mod) if (k !== "default" && Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const debug_1 = __importDefault(require("debug"));
const debug = debug_1.default("app:router");
const nconf_1 = __importDefault(require("nconf"));
const prayerlib = __importStar(require("@dpanet/prayers-lib"));
const moment_1 = __importDefault(require("moment"));
//import { NextFunction, NextHandleFunction } from "connect";
const exception_handler_1 = require("../exceptions/exception.handler");
const sentry = __importStar(require("@sentry/node"));
const validationController = __importStar(require("../middlewares/validations.middleware"));
const validators = __importStar(require("../validators/validations"));
const retry = __importStar(require("async-retry"));
const ramda_1 = __importDefault(require("ramda"));
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
                debug(err);
                sentry.captureException(err);
                new exception_handler_1.HttpException(404, err.message);
            }
        };
        this.getPrayerLocation = (request) => {
            try {
                return this._prayerManager.getPrayerLocationSettings();
            }
            catch (err) {
                debug(err);
                sentry.captureException(err);
                throw new exception_handler_1.HttpException(404, err.message);
            }
        };
        this.reloadConfig = async (request) => {
            try {
                await this.initializePrayerManger();
            }
            catch (err) {
                debug(err);
                sentry.captureException(err);
                throw new exception_handler_1.HttpException(404, err.message);
            }
        };
        this.validatePrayerConfigRequest = async (request) => {
            try {
                let result = this._validationConfigPrayerObject(request.prayerConfig);
                console.log(result);
                return request;
                // fn(request, response, next);
            }
            catch (err) {
                debug(err);
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
                debug(err);
                sentry.captureException(err);
                throw new exception_handler_1.HttpException(404, err.message);
            }
        };
        this.validatePrayerManagerRequest = async (request) => {
            try {
                let result = this._validatePrayerManager(this._prayerManager);
            }
            catch (err) {
                debug(err);
                console.log('caught new error');
                sentry.captureException(err);
                throw new exception_handler_1.HttpException(404, err.message);
            }
        };
        this.updatePrayersByCalculation = async (request) => {
            try {
                let prayerConfig = this.buildPrayerConfigObject(request.body.prayerConfig);
                let locationConfig = request.body.locationConfig;
                this._prayerManager = await this.refreshPrayerManager(prayerConfig, locationConfig);
                await this._prayerManager.updatePrayerConfig(this._prayerManager.getPrayerConfig(), { profileID: request.body.profileID });
                await this._prayerManager.updateLocationConfig(this._prayerManager.getLocationConfig(), { profileID: request.body.profileID });
                // prayerConfig = await new prayerlib.Configurator().getPrayerConfig();
                // this._prayerManager = await this.refreshPrayerManager(prayerConfig,locationConfig)
                return true;
            }
            catch (err) {
                debug(err);
                sentry.captureException(err);
                throw new exception_handler_1.HttpException(404, err.message);
            }
        };
        this.getPrayersByCalculation = async (request) => {
            try {
                let config = request;
                let prayerConfig = this.buildPrayerConfigObject(config.prayerConfig);
                let locationConfig = config.locationConfig;
                debug(locationConfig);
                //let locationConfig: prayerlib.ILocationConfig = await new prayerlib.Configurator().getLocationConfig();
                this._prayerManager = await this.refreshPrayerManager(prayerConfig, locationConfig);
                debug(this._prayerManager.getPrayerAdjsutments());
                return this.createPrayerViewRow(this.createPrayerView(this._prayerManager.getPrayers()));
            }
            catch (err) {
                debug(err);
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
                debug(err);
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
                debug(err);
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
                debug(err);
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
                debug(err);
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
                debug(err);
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
            .bind(this, validators.LocationValidator.createValidator());
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
        let swapPrayers = (x) => ramda_1.default.assoc(x.prayerName, x.prayerTime, x);
        let removePrayers = (x) => ramda_1.default.omit(['prayerName', 'prayerTime', 'undefined'], x);
        let prayerTime = ramda_1.default.pipe(swapPrayers, removePrayers);
        let prayerTimes = (x) => ramda_1.default.map(prayerTime, x);
        let prayersList = (x) => ramda_1.default.append({ prayersDate: x.prayersDate }, x.prayerTime);
        let projectPrayers = ramda_1.default.curry(sortObject);
        let pump = ramda_1.default.pipe(prayersList, prayerTimes, ramda_1.default.mergeAll, projectPrayers);
        return ramda_1.default.map(pump, prayers);
    }
    async refreshPrayerManager(prayerConfig, locationConfig) {
        let count = 0;
        try {
            return await retry.default(async (bail) => {
                count += 1;
                debug(`the number is now reached ${count}`);
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
            debug(err);
            sentry.captureException(err);
            throw err;
        }
    }
    static getPrayerController() {
        return;
    }
}
exports.default = PrayersController;
