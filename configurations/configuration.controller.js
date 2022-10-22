"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const prayers_lib_1 = require("@dpanet/prayers-lib");
const configPaths = {
    PrayersConfigKey: 'prayerConfig',
    LocationConfigKey: 'locationConfig'
};
const ConfigErrorMessages = {
    BAD_INPUT: 'Prayer setting recond is not found, please try again',
    TIME_OUT: 'Connection cannot be made to data provider, please try again after a while',
    FILE_NOT_FOUND: 'Config file not found, please try again',
    SAVE_FAILED: 'Confile file saving failed'
};
const prayerConfigFE = {
    method: 4,
    school: 0,
    midnight: 0,
    adjustmentMethod: 2,
    latitudeAdjustment: 3
    //  startDate: DateUtil.getNowDate(),
    // endDate: DateUtil.addMonth(1, DateUtil.getNowDate())
    ,
    adjustments: [
        { prayerName: prayers_lib_1.PrayersName.IMSAK, adjustments: 0 },
        { prayerName: prayers_lib_1.PrayersName.FAJR, adjustments: 0 },
        { prayerName: prayers_lib_1.PrayersName.SUNRISE, adjustments: 0 },
        { prayerName: prayers_lib_1.PrayersName.DHUHR, adjustments: 0 },
        { prayerName: prayers_lib_1.PrayersName.ASR, adjustments: 0 },
        { prayerName: prayers_lib_1.PrayersName.SUNSET, adjustments: 0 },
        { prayerName: prayers_lib_1.PrayersName.MAGHRIB, adjustments: 0 },
        { prayerName: prayers_lib_1.PrayersName.ISHA, adjustments: 0 },
        { prayerName: prayers_lib_1.PrayersName.MIDNIGHT, adjustments: 0 }
    ]
};
const locationConfigPE = {
    location: {
        latitude: 21.3890824,
        longtitude: 39.8579118,
        city: "Mecca",
        countryCode: "SA",
        countryName: "Saudi Arabia",
        address: "Mecca Saudi Arabia"
    },
    timezone: {
        timeZoneId: "Asia/Riyadh",
        timeZoneName: "Arabian Standard Time",
        dstOffset: 0,
        rawOffset: 10800
    }
};
class HomeyConfigurator extends prayers_lib_1.ConfigProvider {
    constructor(homey) {
        super(prayers_lib_1.ConfigProviderName.HOMEY);
        this._homey = homey;
    }
    async createDefaultConfig(id) {
        if (!(0, prayers_lib_1.isNullOrUndefined)(this._homey.settings)) {
            try {
                this._homey.settings.set("prayerConfig" /* ConfigSettingsKeys.PrayersConfigKey */, prayerConfigFE);
                this._homey.settings.set("locationConfig" /* ConfigSettingsKeys.LocationConfigKey */, locationConfigPE);
            }
            catch (err) {
                return Promise.reject(ConfigErrorMessages.SAVE_FAILED);
            }
        }
        else {
            return Promise.reject(ConfigErrorMessages.FILE_NOT_FOUND);
        }
        return Promise.resolve({
            prayerConfig: prayerConfigFE,
            locationConfig: locationConfigPE
        });
    }
    async getPrayerConfig(config) {
        try {
            return Promise.resolve(this._homey.settings.get("prayerConfig" /* ConfigSettingsKeys.PrayersConfigKey */));
        }
        catch (err) {
            return Promise.reject(ConfigErrorMessages.FILE_NOT_FOUND);
        }
    }
    async updatePrayerConfig(prayerConfigs, id) {
        try {
            let original = await this.getPrayerConfig();
            let updated;
            updated = super.mergePrayerConfig(original, prayerConfigs);
            if (!(0, prayers_lib_1.isNullOrUndefined)(updated)) {
                this._homey.settings.set("prayerConfig" /* ConfigSettingsKeys.PrayersConfigKey */, updated);
            }
            else {
                return Promise.reject(ConfigErrorMessages.SAVE_FAILED);
            }
            return Promise.resolve(true);
        }
        catch (err) {
            return Promise.reject(err);
        }
    }
    async getLocationConfig(id) {
        try {
            return Promise.resolve(this._homey.settings.get("locationConfig" /* ConfigSettingsKeys.LocationConfigKey */));
        }
        catch (err) {
            return Promise.reject(ConfigErrorMessages.FILE_NOT_FOUND);
        }
    }
    async updateLocationConfig(locationConfig, id) {
        try {
            let original = await this.getLocationConfig();
            let updated;
            updated = super.mergeLocationConfig(original, locationConfig);
            if (!(0, prayers_lib_1.isNullOrUndefined)(updated)) {
                this._homey.settings.set("locationConfig" /* ConfigSettingsKeys.LocationConfigKey */, updated);
            }
            else {
                return Promise.reject(ConfigErrorMessages.SAVE_FAILED);
            }
            return Promise.resolve(true);
        }
        catch (err) {
            return Promise.reject(err);
        }
    }
    async getConfig(id) {
        let prayerConfig;
        let locationConfig;
        try {
            prayerConfig = this._homey.settings.get("prayerConfig" /* ConfigSettingsKeys.PrayersConfigKey */);
            locationConfig = this._homey.settings.get("locationConfig" /* ConfigSettingsKeys.LocationConfigKey */);
            if (!(0, prayers_lib_1.isNullOrUndefined)(prayerConfig) && !(0, prayers_lib_1.isNullOrUndefined)(locationConfig)) {
                return Promise.resolve({
                    prayerConfig: prayerConfigFE,
                    locationConfig: locationConfigPE
                });
            }
            else {
                return Promise.resolve(this.createDefaultConfig());
            }
        }
        catch (err) {
            return Promise.reject(err);
        }
    }
}
exports.default = HomeyConfigurator;
