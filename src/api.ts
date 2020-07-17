import Homey = require('homey');
import request= require("request-promise-native");
import config= require('nconf');
config.file('env.json');
var mainUrl = `http://localhost:3005/api/app/com.prayerssapp`
module.exports=[
{
    method:'GET',
    path:'/PrayerManager/PrayersSettings',
    public:true,
    fn: async (args:any,callback:any)=>
    {
        let url:string= `${mainUrl}/PrayerManager/PrayersSettings`;
        let queryString: any =
        {
            method: 'GET',
            json: true,
            resolveWithFullResponse: false

        };
        return await request.get(url,queryString);
    }
},
{
    method:'GET',
    path:'/PrayerManager/PrayersAdjustments',
    public:true,
    fn: async (args:any,callback:any)=>
    {
        let url:string=`${mainUrl}/PrayerManager/PrayersAdjustments`;
        let queryString: any =
        {
            method: 'GET',
            json: true,
            resolveWithFullResponse: false

        };
        return await request.get(url,queryString);
    }
},
{
    method:'GET',
    path:'/PrayerManager/Prayers',
    public:true,
    fn: async (args:any,callback:any)=>
    {
        let url:string=`${mainUrl}/PrayerManager/Prayers`;
        let queryString: any =
        {
            method: 'GET',
            json: true,
            resolveWithFullResponse: false

        };
        return await request.get(url,queryString);
    }
},
{
    method:'GET',
    path:'/PrayerManager/LoadSettings',
    public:true,
    fn: async (args:any,callback:any)=>
    {
        let url:string=`${mainUrl}/PrayerManager/LoadSettings`;
        let queryString: any =
        {
            method: 'GET',
            json: true,
            resolveWithFullResponse: false

        };
        return await request.get(url,queryString);
    }
},
{
    method:'GET',
    path:'/PrayerManager/SearchLocation',
    public:true,
    fn: async (args:any,callback:any)=>
    {
        let url:string=`${mainUrl}/PrayerManager/SearchLocation`;
        let queryString: any =
        {
            qs: args.query,
            method: 'GET',
            json: true,
            resolveWithFullResponse: false

        };
        return await request.get(url,queryString);
    }
},
{
    method:'GET',
    path:'/PrayerManager/PrayersLocation',
    public:true,
    fn: async (args:any,callback:any)=>
    {
        let url:string=`${mainUrl}/PrayerManager/PrayersLocation`;
        let queryString: any =
        {
            method: 'GET',
            json: true,
            resolveWithFullResponse: false

        };
        return await request.get(url,queryString);
    }
},
{
    method:'GET',
    path:'/PrayerManager/PrayersViewMobile',
    public:true,
    fn: async (args:any,callback:any)=>
    {
        let url:string=`${mainUrl}/PrayerManager/PrayersViewMobile`;
        let queryString: any =
        {
            method: 'GET',
            qs:args.query,
            json: true,
            resolveWithFullResponse: false

        };
        return await request.get(url,queryString);
    }
},
{
    method:'POST',
    path:'/PrayerManager/PrayersViewMobile',
    public:true,
    fn: async (args:any,callback:any)=>
    {
        let url:string=`${mainUrl}/PrayerManager/PrayersViewMobile`;
        let queryString: any =
        {
            method: 'POST',
            json: true,
            resolveWithFullResponse: false,
            body:args.body
        };
        return await request.post(url,queryString);
    }
},

{
    method:'GET',
    path:'/Places',
    public:true,
    fn: async (args:any,callback:any)=>
    {
        let url:string=`${mainUrl}/Places`;
        let queryString: any =
        {
            method: 'GET',
            json: false,
            resolveWithFullResponse: false

        };
        return await request.get(url,queryString);
    }
},
{
    method:'GET',
    path:'/settings',
    public:true,
    fn: async (args:any,callback:any)=>
    {
        
        let url:string=`http://localhost:3005/app/com.prayerssapp/settings`;
        let queryString: any =
        {
            method: 'GET',
            json:false,
            resolveWithFullResponse:false
        };
        
        return await request.get(url,queryString);
         //return  await axios.default(queryString)//pipe(await request.get(queryString))
    
    //    return await request.get(queryString).pipe(request.get(queryString));
    }
},
]