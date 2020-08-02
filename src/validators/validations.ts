import {Validator,IValid,IPrayerManager} from  "../models/prayers.model";
//import * as prayer from "@dpanet/prayers-lib/lib/entities/prayer";
import Joi from '@hapi/joi';
export class PrayerMangerValidator extends Validator<IPrayerManager>
{

    private _prayerManagerSchema: Joi.Schema;
    private _adjustmentsSchema: object;
    private constructor() 
    {
       super("PrayerManagerValidator");
       this.setSchema();

    }
    private setSchema(): void {

        this._prayerManagerSchema = Joi.any()
        .required()
        .label("Prayer Manager")
        .messages(this.customErrorMessage());
    }
    public validate(validateObject: IPrayerManager): boolean {
        return  super.genericValidator( this._prayerManagerSchema.validate(validateObject, { abortEarly: false, allowUnknown: true }));
    }
    public static createValidator(): IValid<IPrayerManager> {
        return new PrayerMangerValidator();
    }
}

export * from  "@dpanet/prayers-lib/lib/validators/interface.validators.js";
export * from "@dpanet/prayers-lib/lib/validators/validator.js";