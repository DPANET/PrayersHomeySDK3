//import $ = require('jquery');
import moment from "moment";
import Noty from "noty";
import * as prayerlib from "@dpanet/prayers-lib/lib/entities/prayer";
import * as locationlib from "@dpanet/prayers-lib/lib/entities/location";
import * as prayerConfig from "@dpanet/prayers-lib/lib/configurators/inteface.configuration";
import * as prayerValidator from "@dpanet/prayers-lib/lib/validators/interface.validators";
import * as prayerConfigValidator from "@dpanet/prayers-lib/lib/validators/validator";

const google = require( "@google/maps");
//import { isNullOrUndefined } from 'util';
// const DataTable = require("datatables.net")(window, $);
//const daterangepicker = require("daterangepicker");
// const DataTableResp = require("datatables.net-responsive")(window, $);
// const DataTableRowGroup = require("datatables.net-rowgroup")(window, $);
var mainURL=`${location.origin}/api/app/com.dev.prayerssapp` ;
//var mainURL = 'http://192.168.86.81/api/app/com.dev.prayerssapp';
export async function buildObject() {
    let noty: Noty;
    await $('document').ready(async () => {
        try {
            initForm();
            await loadPrayerPrayerSettings()
            await loadPrayerAdjustments();
            await loadPrayerLocation();
        }
        catch (err) {
            let noty: Noty = loadNotification();
            noty.setText(err.message, true);
            noty.show();
        }
    }
    );
}
async function loadPrayerLocation() {
    return await $.ajax({
        url: `${mainURL}/PrayerManager/PrayersLocationSettings`,
        // error: genericErrorHandler,
        dataType: "json",
        success: (prayersLocation: locationlib.ILocationSettings) => {
            loadLocationSettings(prayersLocation)
          },
    }).catch((jqXHR: JQueryXHR, textStatus: string, errorThrown: string) => { throw new Error(jqXHR.responseJSON.message) });
}
function loadLocationSettings(prayersLocation:locationlib.ILocationSettings)
{
    $("#city").val(`${prayersLocation.city}/ ${prayersLocation.countryCode}`);
    $("#coordinates").val(`(${prayersLocation.latitude},${prayersLocation.longtitude})`);
   // $("#time-zone").val(`(${prayersLocation.timeZoneId})`); 
   $("#coordinates").data("location",prayersLocation);
}
function initForm() {
    $("#view-button").on("click", refreshDataTable);
    $("#submit-button").on("click", saveDataTable);
    $('#load-button').on("click", reloadSettings);
    $('input[name="daterangepicker"]').daterangepicker(
        {
            startDate: moment(new Date()),//moment(prayerSettings.startDate),
            endDate: moment(new Date()).add(1, "M")//moment(prayerSettings.endDate)
        }
    )
    $('#search-button').on("click",searchLocation);
   // initMap();

}
 function initMap()
{


let options:any = {

    types:['address']
}
let searchinput:any = document.getElementById('search-input');

    let autocomplete:any = new google.maps.places.Autocomplete(searchinput);
    autocomplete.addListener(
    'place_changed',
    ()=>{
           // $('#search-input').val(autocomplete.getPlace());
    }); 

}
async function searchLocation()
{
    try{
    let searchText:string = $('#search-input').val() as string;
    if (!isNullOrUndefined(searchText))
    {
        await $.ajax({
            url: `${mainURL}/PrayerManager/SearchLocation`,
            // error: genericErrorHandler,
            dataType: "JSON",
            type: "GET",
            data:{'address':searchText},
            success: async (prayerLocationSettings:locationlib.ILocationSettings) => {
                     loadLocationSettings(prayerLocationSettings);
            },
        }).catch((jqXHR: JQueryXHR, textStatus: string, errorThrown: string) => { throw new Error(jqXHR.responseJSON.message) });
    }
}    catch (err) {
    let noty: Noty = loadNotification();
    noty.setText(err.message, true);
    noty.show();
}
}
async function reloadSettings() {
    await $.ajax({
        url: `${mainURL}/PrayerManager/LoadSettings`,
        // error: genericErrorHandler,
        dataType: "json",
        type: "GET",
        success: async () => {
            await loadPrayerPrayerSettings();
            await loadPrayerAdjustments();
            await loadPrayerLocation();
        },
    }).catch((jqXHR: JQueryXHR, textStatus: string, errorThrown: string) => { throw new Error(jqXHR.responseJSON.message) })
}

function notify(type: Noty.Type, message: string) {
    let noty: Noty = loadNotification();
    noty.setType(type, true);
    noty.setText(message, true);

    noty.show();
}
function loadNotification(): Noty {
    return new Noty({
        layout: 'top',
        theme: "bootstrap-v4",
        type: "error", // success, error, warning, information, notification
        text: 'Test Hi', // [string|html] can be HTML or STRING
        force: false, // [boolean] adds notification to the beginning of queue when set to true      
        timeout: false, // [integer|boolean] delay for closing event in milliseconds. Set false for sticky notifications
        progressBar: false, // [boolean] - displays a progress bar
        animation: {
            open: 'animated slideInDown', // Animate.css class names
            close: 'animated slideOutUp' // Animate.css class names
        },
        closeWith: ['click', 'button'], // ['click', 'button', 'hover', 'backdrop'] // backdrop click will close all notifications
        modal: false, // [boolean] if true adds an overlay
        killer: false, // [boolean] if true closes all notifications and shows itself
    });
}
function refreshPrayerConfigForm(): prayerConfig.IPrayersConfig {
    let prayerAdjustment: prayerlib.IPrayerAdjustments[] = new Array<prayerlib.IPrayerAdjustments>();
    prayerAdjustment.push(
        { prayerName: prayerlib.PrayersName.FAJR, adjustments: $("#fajr-time").val() as number },
        { prayerName: prayerlib.PrayersName.DHUHR, adjustments: $("#dhur-time").val() as number },
        { prayerName: prayerlib.PrayersName.ASR, adjustments: $("#asr-time").val() as number },
        { prayerName: prayerlib.PrayersName.MAGHRIB, adjustments: $("#maghrib-time").val() as number },
        { prayerName: prayerlib.PrayersName.ISHA, adjustments: $("#isha-time").val() as number },
    );
    let prayersConfig: prayerConfig.IPrayersConfig = {
        method: $("#method").val() as prayerlib.Methods,
        school: $("#school").val() as prayerlib.Schools,
        latitudeAdjustment: $("#latitude").val() as prayerlib.LatitudeMethod,
        midnight: $("#midnight").val() as prayerlib.MidnightMode,
        adjustments: prayerAdjustment,
        adjustmentMethod: prayerlib.AdjsutmentMethod.Server,
        startDate: $("#prayer-time-period").data('daterangepicker').startDate.toDate(),
        endDate: $("#prayer-time-period").data('daterangepicker').endDate.toDate()
    }
    return prayersConfig;
}
function refreshLocationConfig():prayerConfig.ILocationConfig{
    let coordinates:string=$("#coordinates").val() as string
    let latlngArray:Array<string> = new Array<string>();
    coordinates=coordinates.replace("(","");
    coordinates=coordinates.replace(")","");
    latlngArray= coordinates.split(",");
    let latlng:locationlib.ILocationSettings= $("#coordinates").data("location");
    let locationConfig:prayerConfig.ILocationConfig=
    
    {
        location:{
            latitude:latlng.latitude,
            longtitude:latlng.longtitude,
            city:latlng.city,
            countryCode:latlng.countryCode,
            countryName:latlng.countryName,
            address:latlng.city
        },
        timezone:{
            timeZoneId:latlng.timeZoneId,
            timeZoneName:latlng.timeZoneName,
            rawOffset:latlng.rawOffset,
            dstOffset:latlng.dstOffset
        }
    }
    return locationConfig;
}
function validatePrayerForm(prayersConfig: prayerConfig.IPrayersConfig): boolean {

    let validator: prayerValidator.IValid<prayerConfig.IPrayersConfig> = prayerConfigValidator.PrayerConfigValidator.createValidator();
    let result: boolean = validator.validate(prayersConfig);
    if (result)
        return result;
    else {
        let err: prayerValidator.IValidationError = validator.getValidationError();
        let message: string[] = err.details.map((detail: any) => `${detail.value.label} with value ${detail.value.value}: ${detail.message}`);
        let messageShort = message.reduce((prvs, curr, index, array) => prvs.concat('<br>', curr));
        throw new Error(messageShort);
    }
}
function validateLocationForm(locationConfig:prayerConfig.ILocationConfig):boolean
{
    let validator: prayerValidator.IValid<locationlib.ILocationSettings > = prayerConfigValidator.LocationValidator.createValidator();
    let result: boolean = validator.validate(locationConfig.location);
    if (result)
        return result;
    else {
        let err: prayerValidator.IValidationError = validator.getValidationError();
        let message: string[] = err.details.map((detail: any) => `${detail.value.label} with value ${detail.value.value}: ${detail.message}`);
        let messageShort = message.reduce((prvs, curr, index, array) => prvs.concat('<br>', curr));
        throw new Error(messageShort);
    }
}
async function refreshDataTable() {
    try {

        let prayersConfig: prayerConfig.IPrayersConfig = refreshPrayerConfigForm();
        let locationConfig:prayerConfig.ILocationConfig = refreshLocationConfig();
        let prayerValidationResult: boolean = validatePrayerForm(prayersConfig);
        let locationValidationResult:boolean = validateLocationForm(locationConfig);
        if (prayerValidationResult && locationValidationResult) {
            if ($('#prayers-table-mobile').is(':hidden')) {
                await loadDataTable();
                $('#prayers-table-mobile').show();
            }
            else {
                await $('#prayers-table-mobile').DataTable().ajax.reload();
            }
        }
    } catch (err) {
        let noty: Noty = loadNotification();
        noty.setText(err.message, true);
        noty.show();
    }
}
async function saveDataTable() {
    try {
        let prayersConfig: prayerConfig.IPrayersConfig = refreshPrayerConfigForm();
        let locationConfig:prayerConfig.ILocationConfig = refreshLocationConfig();
        let prayerValidationResult: boolean = validatePrayerForm(prayersConfig);
        let locationValidationResult:boolean = validateLocationForm(locationConfig);
        if  (prayerValidationResult && locationValidationResult) {
          await  $.ajax({
                url: `${mainURL}/PrayerManager/PrayersByCalculation`, type: "POST",
                data:
                // (d) => {
                //     try {
                //         let config={ "prayerConfig":refreshPrayerConfigForm(),
                //         "locationConfig": refreshLocationConfig()}
                //         return config;
                //     }
                //     catch (err) {
                //         //notify("error", err.message);
                //     }
                // },
                JSON.stringify(
                { "prayerConfig":refreshPrayerConfigForm(),
                "locationConfig": refreshLocationConfig()}),// JSON.stringify(prayersConfig),
                dataType: "json",
                //crossDomain:true,
                processData:true,
                contentType: "application/json; charset=utf-8",
                 error: dataRefreshErrorHandler,
                success: () => notify("success", "Configuration is saved")
            }).catch((jqXHR: JQueryXHR, textStatus: string, errorThrown: string) => { throw new Error(jqXHR.responseJSON.message) });

        }
    }
    catch (err) {
        let noty: Noty = loadNotification();
        noty.setText(err.message, true);
        noty.show();
    }
}
async function loadDataTable() {
    $.fn.dataTable.ext.errMode = 'throw';
    let paramlist:Array<object>= new Array<object>();
    await $('#prayers-table-mobile').DataTable(
        {
            ajax: {
                url: `${mainURL}/PrayerManager/PrayersByCalculation`,
                type: 'GET',
                dataType: "json",
                data: (d) => {
                    try {
                        let config={ "prayerConfig":refreshPrayerConfigForm(),
                        "locationConfig": refreshLocationConfig()}
                        return config;
                    }
                    catch (err) {
                        notify("error", err.message);
                    }
                },
                 error: dataRefreshErrorHandler,
                dataSrc: (d) => { return d; }
            },
            autoWidth: false,
            searching: false,
            paging: true,
            ordering: false,
            responsive: true,
            language: {
                loadingRecords: "Loading...",
                processing: "Processing...",
                zeroRecords: "No records to display",
                emptyTable: "No data available in table"
            },
            rowGroup:
            {
                dataSrc: 'prayersDate'
            },
            columns: [
                { data: 'prayerName', responsivePriority: 2, className: "th" },
                { data: 'prayerTime', responsivePriority: 3, className: "th" }
            ]
        }
    );
}
async function dataRefreshErrorHandler(jqXHR: JQueryXHR, textStatus: string, errorThrown: string) {
    if (jqXHR.status >= 400 && !isNullOrUndefined(jqXHR.responseJSON.message))
        notify("error", jqXHR.responseJSON.message);
    else
        notify("error", jqXHR.responseText);
    $('#prayers-table-mobile').DataTable().clear().draw();
}
async function genericErrorHandler(jqXHR: JQueryXHR, textStatus: string, errorThrown: string) {
    if (jqXHR.status >= 400 && !isNullOrUndefined(jqXHR.responseText))
        notify("error", jqXHR.responseJSON.message);
    else
        notify("error", errorThrown);
}
async function loadPrayerPrayerSettings(): Promise<JQuery.jqXHR<any>> {
    return await $.ajax({
        url: `${mainURL}/PrayerManager/PrayersSettings`,
        // error: genericErrorHandler,
        dataType: "json",
        success: (prayerSettings: prayerlib.IPrayersSettings) => {
            $("#method").val(prayerSettings.method.id);
            $("#school").val(prayerSettings.school.id);
            $("#latitude").val(prayerSettings.latitudeAdjustment.id);
            $("#midnight").val(prayerSettings.midnight.id);
          

        },
    }).catch((jqXHR: JQueryXHR, textStatus: string, errorThrown: string) => { throw new Error(jqXHR.responseJSON.message) })
}
async function loadPrayerAdjustments() {
    return await $.ajax({
        url: `${mainURL}/PrayerManager/PrayersAdjustments/`,
        dataType: "json",
        // error: genericErrorHandler,
        success: (prayerAdjustment: prayerlib.IPrayerAdjustments[]) => {
            prayerAdjustment.forEach(element => {
                switch (element.prayerName) {
                    case "Fajr": $("#fajr-time").val(element.adjustments);
                        break;
                    case "Dhuhr": $("#dhur-time").val(element.adjustments);
                        break;
                    case "Asr": $("#asr-time").val(element.adjustments);
                        break;
                    case "Maghrib": $("#maghrib-time").val(element.adjustments);
                        break;
                    case "Isha": $("#isha-time").val(element.adjustments);
                        break;
                }
            });
        }
    }).catch((jqXHR: JQueryXHR, textStatus: string, errorThrown: string) => { throw new Error(jqXHR.responseJSON.message) });
}

function isNullOrUndefined<T>(obj: T | null | undefined): obj is null | undefined {
    return typeof obj === "undefined" || obj === null;
}
buildObject();
//  async function  getDB(): Promise<lowdb.LowdbAsync<any>> {
//     let _fileName: string = 'config/config.json';  
//     let _db: lowdb.LowdbAsync<any>;

//     return _db = await lowdb(new lowdbfile(_fileName));
// }

