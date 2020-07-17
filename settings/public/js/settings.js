"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
//import $ = require('jquery');
const prayerlib = __importStar(require("../../models/prayers.model"));
const moment_1 = __importDefault(require("moment"));
const noty_1 = __importDefault(require("noty"));
const google = require("google");
//import { isNullOrUndefined } from 'util';
// const DataTable = require("datatables.net")(window, $);
//const daterangepicker = require("daterangepicker");
// const DataTableResp = require("datatables.net-responsive")(window, $);
// const DataTableRowGroup = require("datatables.net-rowgroup")(window, $);
var mainURL = `${location.origin}/api/app/com.prayerssapp`;
async function buildObject() {
    let noty;
    await $('document').ready(async () => {
        try {
            initForm();
            await loadPrayerPrayerSettings();
            await loadPrayerAdjustments();
            await loadPrayerLocation();
        }
        catch (err) {
            let noty = loadNotification();
            noty.setText(err.message, true);
            noty.show();
        }
    });
}
exports.buildObject = buildObject;
async function loadPrayerLocation() {
    return await $.ajax({
        url: `${mainURL}/PrayerManager/PrayersLocation`,
        // error: genericErrorHandler,
        dataType: "json",
        success: (prayersLocation) => {
            loadLocationSettings(prayersLocation);
        },
    }).catch((jqXHR, textStatus, errorThrown) => { throw new Error(jqXHR.responseJSON.message); });
}
function loadLocationSettings(prayersLocation) {
    $("#city").val(`${prayersLocation.city}/ ${prayersLocation.countryCode}`);
    $("#coordinates").val(`(${prayersLocation.latitude},${prayersLocation.longtitude})`);
    $("#time-zone").val(`(${prayersLocation.timeZoneId})`);
}
function initForm() {
    $("#view-button").on("click", refreshDataTable);
    $("#submit-button").on("click", saveDataTable);
    $('#load-button').on("click", reloadSettings);
    $('input[name="daterangepicker"]').daterangepicker({
        startDate: moment_1.default(new Date()),
        endDate: moment_1.default(new Date()).add(1, "M") //moment(prayerSettings.endDate)
    });
    $('#search-button').on("click", searchLocation);
    // initMap();
}
function initMap() {
    let options = {
        types: ['address']
    };
    let searchinput = document.getElementById('search-input');
    let autocomplete = new google.maps.places.Autocomplete(searchinput);
    autocomplete.addListener('place_changed', () => {
        // $('#search-input').val(autocomplete.getPlace());
    });
}
async function searchLocation() {
    try {
        let searchText = $('#search-input').val();
        if (!isNullOrUndefined(searchText)) {
            await $.ajax({
                url: `${mainURL}/PrayerManager/SearchLocation`,
                // error: genericErrorHandler,
                dataType: "JSON",
                type: "GET",
                data: { 'address': searchText },
                success: async (prayerLocationSettings) => {
                    loadLocationSettings(prayerLocationSettings);
                },
            }).catch((jqXHR, textStatus, errorThrown) => { throw new Error(jqXHR.responseJSON.message); });
        }
    }
    catch (err) {
        let noty = loadNotification();
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
    }).catch((jqXHR, textStatus, errorThrown) => { throw new Error(jqXHR.responseJSON.message); });
}
function notify(type, message) {
    let noty = loadNotification();
    noty.setType(type, true);
    noty.setText(message, true);
    noty.show();
}
function loadNotification() {
    return new noty_1.default({
        layout: 'top',
        theme: "bootstrap-v4",
        type: "error",
        text: 'Test Hi',
        force: false,
        timeout: false,
        progressBar: false,
        animation: {
            open: 'animated slideInDown',
            close: 'animated slideOutUp' // Animate.css class names
        },
        closeWith: ['click', 'button'],
        modal: false,
        killer: false,
    });
}
function refreshPrayerConfigForm() {
    let prayerAdjustment = new Array();
    prayerAdjustment.push({ prayerName: prayerlib.PrayersName.FAJR, adjustments: $("#fajr-time").val() }, { prayerName: prayerlib.PrayersName.DHUHR, adjustments: $("#dhur-time").val() }, { prayerName: prayerlib.PrayersName.ASR, adjustments: $("#asr-time").val() }, { prayerName: prayerlib.PrayersName.MAGHRIB, adjustments: $("#maghrib-time").val() }, { prayerName: prayerlib.PrayersName.ISHA, adjustments: $("#isha-time").val() });
    let prayersConfig = {
        method: $("#method").val(),
        school: $("#school").val(),
        latitudeAdjustment: $("#latitude").val(),
        midnight: $("#midnight").val(),
        adjustments: prayerAdjustment,
        adjustmentMethod: prayerlib.AdjsutmentMethod.Server,
        startDate: $("#prayer-time-period").data('daterangepicker').startDate.toDate(),
        endDate: $("#prayer-time-period").data('daterangepicker').endDate.toDate()
    };
    return prayersConfig;
}
function refreshLocationConfig() {
    let coordinates = $("#coordinates").val();
    let latlngArray = new Array();
    coordinates = coordinates.replace("(", "");
    coordinates = coordinates.replace(")", "");
    latlngArray = coordinates.split(",");
    let latlng = {
        location: {
            latitude: parseFloat(latlngArray[0]),
            longtitude: parseFloat(latlngArray[1]),
        },
        timezone: {
            timeZoneId: null,
            timeZoneName: null,
            rawOffset: null,
            dstOffset: null
        }
    };
    return latlng;
}
function validatePrayerForm(prayersConfig) {
    let validator = prayerlib.PrayerConfigValidator.createValidator();
    let result = validator.validate(prayersConfig);
    if (result)
        return result;
    else {
        let err = validator.getValidationError();
        let message = err.details.map((detail) => `${detail.value.label} with value ${detail.value.value}: ${detail.message}`);
        let messageShort = message.reduce((prvs, curr, index, array) => prvs.concat('<br>', curr));
        throw new Error(messageShort);
    }
}
function validateLocationForm(locationConfig) {
    let validator = prayerlib.LocationValidator.createValidator();
    let result = validator.validate(locationConfig.location);
    if (result)
        return result;
    else {
        let err = validator.getValidationError();
        let message = err.details.map((detail) => `${detail.value.label} with value ${detail.value.value}: ${detail.message}`);
        let messageShort = message.reduce((prvs, curr, index, array) => prvs.concat('<br>', curr));
        throw new Error(messageShort);
    }
}
async function refreshDataTable() {
    try {
        let prayersConfig = refreshPrayerConfigForm();
        let locationConfig = refreshLocationConfig();
        let prayerValidationResult = validatePrayerForm(prayersConfig);
        let locationValidationResult = validateLocationForm(locationConfig);
        if (prayerValidationResult && locationValidationResult) {
            if ($('#prayers-table-mobile').is(':hidden')) {
                await loadDataTable();
                $('#prayers-table-mobile').show();
            }
            else {
                await $('#prayers-table-mobile').DataTable().ajax.reload();
            }
        }
    }
    catch (err) {
        let noty = loadNotification();
        noty.setText(err.message, true);
        noty.show();
    }
}
async function saveDataTable() {
    try {
        let prayersConfig = refreshPrayerConfigForm();
        let locationConfig = refreshLocationConfig();
        let prayerValidationResult = validatePrayerForm(prayersConfig);
        let locationValidationResult = validateLocationForm(locationConfig);
        if (prayerValidationResult && locationValidationResult) {
            await $.ajax({
                url: `${mainURL}/PrayerManager/PrayersViewMobile`, type: "POST",
                data: JSON.stringify({ "prayerConfig": refreshPrayerConfigForm(),
                    "locationConfig": refreshLocationConfig() }),
                dataType: "json",
                //crossDomain:true,
                contentType: "application/json; charset=utf-8",
                // error: genericErrorHandler,
                success: () => notify("success", "Configuration is saved")
            }).catch((jqXHR, textStatus, errorThrown) => { throw new Error(jqXHR.responseJSON.message); });
        }
    }
    catch (err) {
        let noty = loadNotification();
        noty.setText(err.message, true);
        noty.show();
    }
}
async function loadDataTable() {
    $.fn.dataTable.ext.errMode = 'throw';
    let paramlist = new Array();
    await $('#prayers-table-mobile').DataTable({
        ajax: {
            url: `${mainURL}/PrayerManager/PrayersViewMobile`,
            type: 'GET',
            dataType: "json",
            data: (d) => {
                try {
                    let config = { "prayerConfig": refreshPrayerConfigForm(),
                        "locationConfig": refreshLocationConfig() };
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
        rowGroup: {
            dataSrc: 'prayersDate'
        },
        columns: [
            { data: 'prayerName', responsivePriority: 2, className: "th" },
            { data: 'prayerTime', responsivePriority: 3, className: "th" }
        ]
    });
}
async function dataRefreshErrorHandler(jqXHR, textStatus, errorThrown) {
    if (jqXHR.status >= 400 && !isNullOrUndefined(jqXHR.responseJSON.message))
        notify("error", jqXHR.responseJSON.message);
    else
        notify("error", jqXHR.responseText);
    $('#prayers-table-mobile').DataTable().clear().draw();
}
async function genericErrorHandler(jqXHR, textStatus, errorThrown) {
    if (jqXHR.status >= 400 && !isNullOrUndefined(jqXHR.responseText))
        notify("error", jqXHR.responseJSON.message);
    else
        notify("error", errorThrown);
}
async function loadPrayerPrayerSettings() {
    return await $.ajax({
        url: `${mainURL}/PrayerManager/PrayersSettings`,
        // error: genericErrorHandler,
        dataType: "json",
        success: (prayerSettings) => {
            $("#method").val(prayerSettings.method.id);
            $("#school").val(prayerSettings.school.id);
            $("#latitude").val(prayerSettings.latitudeAdjustment.id);
            $("#midnight").val(prayerSettings.midnight.id);
        },
    }).catch((jqXHR, textStatus, errorThrown) => { throw new Error(jqXHR.responseJSON.message); });
}
async function loadPrayerAdjustments() {
    return await $.ajax({
        url: `${mainURL}/PrayerManager/PrayersAdjustments/`,
        dataType: "json",
        // error: genericErrorHandler,
        success: (prayerAdjustment) => {
            prayerAdjustment.forEach(element => {
                switch (element.prayerName) {
                    case "Fajr":
                        $("#fajr-time").val(element.adjustments);
                        break;
                    case "Dhuhr":
                        $("#dhur-time").val(element.adjustments);
                        break;
                    case "Asr":
                        $("#asr-time").val(element.adjustments);
                        break;
                    case "Maghrib":
                        $("#maghrib-time").val(element.adjustments);
                        break;
                    case "Isha":
                        $("#isha-time").val(element.adjustments);
                        break;
                }
            });
        }
    }).catch((jqXHR, textStatus, errorThrown) => { throw new Error(jqXHR.responseJSON.message); });
}
function isNullOrUndefined(obj) {
    return typeof obj === "undefined" || obj === null;
}
buildObject();
//  async function  getDB(): Promise<lowdb.LowdbAsync<any>> {
//     let _fileName: string = 'config/config.json';  
//     let _db: lowdb.LowdbAsync<any>;
//     return _db = await lowdb(new lowdbfile(_fileName));
// }
//# sourceMappingURL=settings.js.map