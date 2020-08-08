//import { isNullOrUndefined } from '../uti';
import ramda, { update } from 'ramda';
import {
    IPrayersConfig,
    ILocationConfig,
    IConfigProvider,
    IConfig,
    ConfigProvider,
    ConfigProviderName,
    DateUtil,
    PrayersName, isNullOrUndefined
} from "@dpanet/prayers-lib";
import homey from "homey"
const configPaths =
{

    PrayersConfigKey: 'prayerConfig',
    LocationConfigKey: 'locationConfig'
}
const ConfigErrorMessages =
{
    BAD_INPUT: 'Prayer setting recond is not found, please try again',
    TIME_OUT: 'Connection cannot be made to data provider, please try again after a while',
    FILE_NOT_FOUND: 'Config file not found, please try again',
    SAVE_FAILED: 'Confile file saving failed'
}
export const enum ConfigSettingsKeys {
    PrayersConfigKey = "prayerConfig",
    LocationConfigKey = "locationConfig",
}
const prayerConfigFE: any =
{
    method: 4,
    school: 0,
    midnight: 0,
    adjustmentMethod: 2,
    latitudeAdjustment: 3
  //  startDate: DateUtil.getNowDate(),
   // endDate: DateUtil.addMonth(1, DateUtil.getNowDate())
    ,
    adjustments: [
        { prayerName: PrayersName.IMSAK, adjustments: 0 },
        { prayerName: PrayersName.FAJR, adjustments: 0 },
        { prayerName: PrayersName.SUNRISE, adjustments: 0 },
        { prayerName: PrayersName.DHUHR, adjustments: 0 },
        { prayerName: PrayersName.ASR, adjustments: 0 },
        { prayerName: PrayersName.SUNSET, adjustments: 0 },
        { prayerName: PrayersName.MAGHRIB, adjustments: 0 },
        { prayerName: PrayersName.ISHA, adjustments: 0 },
        { prayerName: PrayersName.MIDNIGHT, adjustments: 0 }
    ]
};

const locationConfigPE: ILocationConfig =
{
    location: {
        latitude: 21.3890824,
        longtitude: 39.8579118,
        city: "Mecca",
        countryCode: "SA",
        countryName: "Saudi Arabia",
        address: "Mecca Saudi Arabia"
    }
    ,
    timezone:
    {
        timeZoneId: "Asia/Riyadh",
        timeZoneName: "Arabian Standard Time",
        dstOffset: 0,
        rawOffset: 10800
    }

}
export default class HomeyConfigurator extends ConfigProvider {
    private readonly _homey: homey.Homey;
    constructor(homey: homey.Homey) {
        super(ConfigProviderName.HOMEY);
        this._homey = homey;
    }
    public async createDefaultConfig(id?: any): Promise<IConfig> {

        if (!isNullOrUndefined(this._homey.settings)) {
            try {
                this._homey.settings.set(ConfigSettingsKeys.PrayersConfigKey, prayerConfigFE);
                this._homey.settings.set(ConfigSettingsKeys.LocationConfigKey, locationConfigPE);
            }
            catch (err) {
                return Promise.reject(ConfigErrorMessages.SAVE_FAILED)
            }
        }
        else {
            return Promise.reject(ConfigErrorMessages.FILE_NOT_FOUND)
        }
        return Promise.resolve({
            prayerConfig: prayerConfigFE,
            locationConfig: locationConfigPE
        });
    }
    public async getPrayerConfig(config?: IConfig): Promise<IPrayersConfig> {
        try {
            return Promise.resolve(this._homey.settings.get(ConfigSettingsKeys.PrayersConfigKey));
        }
        catch (err) {
            return Promise.reject(ConfigErrorMessages.FILE_NOT_FOUND);
        }

    }
    public async updatePrayerConfig(prayerConfigs: IPrayersConfig, id?: any): Promise<boolean> {
        try {
            let original: IPrayersConfig = await this.getPrayerConfig();
            let updated: IPrayersConfig;
            updated = super.mergePrayerConfig(original, prayerConfigs);
            if (!isNullOrUndefined(updated)) {
                this._homey.settings.set(ConfigSettingsKeys.PrayersConfigKey, updated);
            }
            else {
                return Promise.reject(ConfigErrorMessages.SAVE_FAILED);

            }
            return Promise.resolve(true);
        }
        catch (err) {
            return Promise.reject(err)
        }
    }
    public async getLocationConfig(id?: any): Promise<ILocationConfig> {
        try {
            return Promise.resolve(this._homey.settings.get(ConfigSettingsKeys.LocationConfigKey));
        }
        catch (err) {
            return Promise.reject(ConfigErrorMessages.FILE_NOT_FOUND);
        }
    }
    public async updateLocationConfig(locationConfig: ILocationConfig, id?: any): Promise<boolean> {
        try {
            let original: ILocationConfig = await this.getLocationConfig();
            let updated: ILocationConfig;
            updated = super.mergeLocationConfig(original, locationConfig);
            if (!isNullOrUndefined(updated)) {
                this._homey.settings.set(ConfigSettingsKeys.LocationConfigKey, updated);
            }
            else {
                return Promise.reject(ConfigErrorMessages.SAVE_FAILED);

            }
            return Promise.resolve(true);
        }
        catch (err) {
            return Promise.reject(err)
        }
    }
    public async getConfig(id?: any): Promise<IConfig> {
        let prayerConfig: IPrayersConfig;
        let locationConfig: ILocationConfig;
        try {
            prayerConfig = this._homey.settings.get(ConfigSettingsKeys.PrayersConfigKey);
            locationConfig = this._homey.settings.get(ConfigSettingsKeys.LocationConfigKey);
            if (!isNullOrUndefined(prayerConfig) && !isNullOrUndefined(locationConfig)) {
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
            return Promise.reject(err)
        }
    }


}