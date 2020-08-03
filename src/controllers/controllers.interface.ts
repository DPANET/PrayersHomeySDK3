import { IPrayerAdjustments,PrayersName } from "@dpanet/prayers-lib";

//import { Router } from 'express';
export interface IController {
  router: any;
  // getPrayersSettings: any;
  // getPrayers:any;
  // getPrayersViewDesktop:any;
  // getPrayersViewMobile:any;
  // setSettings:any;
  // setPrayerViewMobile:any;
  // getPrayersLocation:any;
  // searchLocation:any;
}

export interface IPrayersController {
  getPrayersAdjustments: any;
   getPrayersSettings: any;
   getPrayers:any;
   getPrayersView:any;
   getPrayersByCalculation:any;
   loadSettings:any;
   setPrayersByCalculation:any;
   getPrayersLocationSettings:any;
   searchLocation:any;
}

export interface IPrayersView {
    prayersDate: string,
    Fajr: string,
    Sunrise: string,
    Dhuhr: string,
    Asr: string,
    Sunset: string,
    Maghrib: string,
    Isha: string,
    Midnight: string,
    Imsak?:string
  }
  export interface IPrayersViewRow {
    prayersDate: string,
    prayerTime: string,
    prayerName: PrayersName
  }