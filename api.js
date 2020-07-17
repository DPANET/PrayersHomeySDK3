"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const request = require("request-promise-native");
const config = require("nconf");
config.file('env.json');
var mainUrl = `http://localhost:3005/api/app/com.prayerssapp`;
module.exports = [
    {
        method: 'GET',
        path: '/PrayerManager/PrayersSettings',
        public: true,
        fn: async (args, callback) => {
            let url = `${mainUrl}/PrayerManager/PrayersSettings`;
            let queryString = {
                method: 'GET',
                json: true,
                resolveWithFullResponse: false
            };
            return await request.get(url, queryString);
        }
    },
    {
        method: 'GET',
        path: '/PrayerManager/PrayersAdjustments',
        public: true,
        fn: async (args, callback) => {
            let url = `${mainUrl}/PrayerManager/PrayersAdjustments`;
            let queryString = {
                method: 'GET',
                json: true,
                resolveWithFullResponse: false
            };
            return await request.get(url, queryString);
        }
    },
    {
        method: 'GET',
        path: '/PrayerManager/Prayers',
        public: true,
        fn: async (args, callback) => {
            let url = `${mainUrl}/PrayerManager/Prayers`;
            let queryString = {
                method: 'GET',
                json: true,
                resolveWithFullResponse: false
            };
            return await request.get(url, queryString);
        }
    },
    {
        method: 'GET',
        path: '/PrayerManager/LoadSettings',
        public: true,
        fn: async (args, callback) => {
            let url = `${mainUrl}/PrayerManager/LoadSettings`;
            let queryString = {
                method: 'GET',
                json: true,
                resolveWithFullResponse: false
            };
            return await request.get(url, queryString);
        }
    },
    {
        method: 'GET',
        path: '/PrayerManager/SearchLocation',
        public: true,
        fn: async (args, callback) => {
            let url = `${mainUrl}/PrayerManager/SearchLocation`;
            let queryString = {
                qs: args.query,
                method: 'GET',
                json: true,
                resolveWithFullResponse: false
            };
            return await request.get(url, queryString);
        }
    },
    {
        method: 'GET',
        path: '/PrayerManager/PrayersLocation',
        public: true,
        fn: async (args, callback) => {
            let url = `${mainUrl}/PrayerManager/PrayersLocation`;
            let queryString = {
                method: 'GET',
                json: true,
                resolveWithFullResponse: false
            };
            return await request.get(url, queryString);
        }
    },
    {
        method: 'GET',
        path: '/PrayerManager/PrayersViewMobile',
        public: true,
        fn: async (args, callback) => {
            let url = `${mainUrl}/PrayerManager/PrayersViewMobile`;
            let queryString = {
                method: 'GET',
                qs: args.query,
                json: true,
                resolveWithFullResponse: false
            };
            return await request.get(url, queryString);
        }
    },
    {
        method: 'POST',
        path: '/PrayerManager/PrayersViewMobile',
        public: true,
        fn: async (args, callback) => {
            let url = `${mainUrl}/PrayerManager/PrayersViewMobile`;
            let queryString = {
                method: 'POST',
                json: true,
                resolveWithFullResponse: false,
                body: args.body
            };
            return await request.post(url, queryString);
        }
    },
    {
        method: 'GET',
        path: '/Places',
        public: true,
        fn: async (args, callback) => {
            let url = `${mainUrl}/Places`;
            let queryString = {
                method: 'GET',
                json: false,
                resolveWithFullResponse: false
            };
            return await request.get(url, queryString);
        }
    },
    {
        method: 'GET',
        path: '/settings',
        public: true,
        fn: async (args, callback) => {
            let url = `http://localhost:3005/app/com.prayerssapp/settings`;
            let queryString = {
                method: 'GET',
                json: false,
                resolveWithFullResponse: false
            };
            return await request.get(url, queryString);
            //return  await axios.default(queryString)//pipe(await request.get(queryString))
            //    return await request.get(queryString).pipe(request.get(queryString));
        }
    },
];
