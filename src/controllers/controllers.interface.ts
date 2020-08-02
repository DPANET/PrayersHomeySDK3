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
   getPrayersViewDesktop:any;
   getPrayersViewMobile:any;
   loadSettings:any;
   setPrayersViewMobile:any;
   getPrayersLocation:any;
   searchLocation:any;
}