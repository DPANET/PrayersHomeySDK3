import Homey from "homey";
import request = require("request-promise-native");
import config = require('nconf');
config.file('env.json');
var mainUrl = `http://localhost:3005/api/app/com.prayerssapp`;
import * as prayerlib from "@dpanet/prayers-lib";
import { IPrayersView, IPrayersViewRow } from "./controllers/controllers.interface";

module.exports =
{
  async getPrayersAdjustments({ homey }: any): Promise<prayerlib.IPrayerAdjustments[]> {
    // you can access query parameters like `/?foo=bar` through args.query.foo

    let result = homey.app.getPrayersAdjustments();

    // perform other logic like mapping result data

    return Promise.resolve(result);
  },

  async getPrayersSettings({ homey }: any): Promise<prayerlib.IPrayersSettings> {
    // you can access query parameters like `/?foo=bar` through args.query.foo

    let result = homey.app.getPrayersSettings();

    // perform other logic like mapping result data

    return Promise.resolve(result);
  },

  async getPrayers({ homey }: any): Promise<prayerlib.IPrayers> {
    // you can access query parameters like `/?foo=bar` through args.query.foo

    let result = homey.app.getPrayers();

    // perform other logic like mapping result data

    return Promise.resolve(result);
  },
  async getPrayersView({ homey }: any): Promise<IPrayersView[]> {
    let result = homey.app.getPrayersView();
    return Promise.resolve(result);

  },
  async getPrayersByCalculation({ homey, body }: any): Promise<IPrayersViewRow[]> {
    let result = await homey.app.getPrayersByCalculation(body);
    return result;
  },
  async loadSettings({ homey }: any): Promise<void> {
    let result = homey.app.loadSettings();

  },
  async setPrayersByCalculation({ homey, body }: any): Promise<IPrayersViewRow[]> {
    try {
      let result = await homey.app.setPrayersByCalculation(body);
      return result;
    } 
    catch (err) {
      console.log(err);
      throw err;
    }

  },
  async getPrayersLocationSettings({ homey }: any): Promise<prayerlib.ILocationSettings>
  {
    try{
    let result = homey.app.getPrayersLocationSettings();
    return Promise.resolve(result);
  } 
  catch (err) {
    console.log(err);
    throw err;
  }
  },
  async searchLocation({homey,body}:any):Promise<prayerlib.ILocationSettings>
  {
    try{
    let result = homey.app.searchLocation(body);
    return Promise.resolve(result);
  } 
  catch (err) {
    console.log(err);
    throw err;
  }
  }

}




// [
// {
//     method:'GET',
//     path:'/PrayerManager/PrayersSettings',
//     public:true,
//     fn: async (args:any,callback:any)=>
//     {
//         let url:string= `${mainUrl}/PrayerManager/PrayersSettings`;
//         let queryString: any =
//         {
//             method: 'GET',
//             json: true,
//             resolveWithFullResponse: false

//         };
//         return await request.get(url,queryString);
//     }
// },
// {
//     method:'GET',
//     path:'/PrayerManager/PrayersAdjustments',
//     public:true,
//     fn: async (args:any,callback:any)=>
//     {
//         let url:string=`${mainUrl}/PrayerManager/PrayersAdjustments`;
//         let queryString: any =
//         {
//             method: 'GET',
//             json: true,
//             resolveWithFullResponse: false

//         };
//         return await request.get(url,queryString);
//     }
// },
// {
//     method:'GET',
//     path:'/PrayerManager/Prayers',
//     public:true,
//     fn: async (args:any,callback:any)=>
//     {
//         let url:string=`${mainUrl}/PrayerManager/Prayers`;
//         let queryString: any =
//         {
//             method: 'GET',
//             json: true,
//             resolveWithFullResponse: false

//         };
//         return await request.get(url,queryString);
//     }
// },
// {
//     method:'GET',
//     path:'/PrayerManager/LoadSettings',
//     public:true,
//     fn: async (args:any,callback:any)=>
//     {
//         let url:string=`${mainUrl}/PrayerManager/LoadSettings`;
//         let queryString: any =
//         {
//             method: 'GET',
//             json: true,
//             resolveWithFullResponse: false

//         };
//         return await request.get(url,queryString);
//     }
// },
// {
//     method:'GET',
//     path:'/PrayerManager/SearchLocation',
//     public:true,
//     fn: async (args:any,callback:any)=>
//     {
//         let url:string=`${mainUrl}/PrayerManager/SearchLocation`;
//         let queryString: any =
//         {
//             qs: args.query,
//             method: 'GET',
//             json: true,
//             resolveWithFullResponse: false

//         };
//         return await request.get(url,queryString);
//     }
// },
// {
//     method:'GET',
//     path:'/PrayerManager/PrayersLocation',
//     public:true,
//     fn: async (args:any,callback:any)=>
//     {
//         let url:string=`${mainUrl}/PrayerManager/PrayersLocation`;
//         let queryString: any =
//         {
//             method: 'GET',
//             json: true,
//             resolveWithFullResponse: false

//         };
//         return await request.get(url,queryString);
//     }
// },
// {
//     method:'GET',
//     path:'/PrayerManager/PrayersViewMobile',
//     public:true,
//     fn: async (args:any,callback:any)=>
//     {
//         let url:string=`${mainUrl}/PrayerManager/PrayersViewMobile`;
//         let queryString: any =
//         {
//             method: 'GET',
//             qs:args.query,
//             json: true,
//             resolveWithFullResponse: false

//         };
//         return await request.get(url,queryString);
//     }
// },
// {
//     method:'POST',
//     path:'/PrayerManager/PrayersViewMobile',
//     public:true,
//     fn: async (args:any,callback:any)=>
//     {
//         let url:string=`${mainUrl}/PrayerManager/PrayersViewMobile`;
//         let queryString: any =
//         {
//             method: 'POST',
//             json: true,
//             resolveWithFullResponse: false,
//             body:args.body
//         };
//         return await request.post(url,queryString);
//     }
// },

// {
//     method:'GET',
//     path:'/Places',
//     public:true,
//     fn: async (args:any,callback:any)=>
//     {
//         let url:string=`${mainUrl}/Places`;
//         let queryString: any =
//         {
//             method: 'GET',
//             json: false,
//             resolveWithFullResponse: false

//         };
//         return await request.get(url,queryString);
//     }
// },
// {
//     method:'GET',
//     path:'/settings',
//     public:true,
//     fn: async (args:any,callback:any)=>
//     {

//         let url:string=`http://localhost:3005/app/com.prayerssapp/settings`;
//         let queryString: any =
//         {
//             method: 'GET',
//             json:false,
//             resolveWithFullResponse:false
//         };

//         return await request.get(url,queryString);
//          //return  await axios.default(queryString)//pipe(await request.get(queryString))

//     //    return await request.get(queryString).pipe(request.get(queryString));
//     }
// },
// ]