"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const nconf_1 = __importDefault(require("nconf"));
nconf_1.default.file('config/default.json');
process.env.DEBUG = nconf_1.default.get("DEBUG");
const prayers_controller_1 = __importDefault(require("./controllers/prayers.controller"));
const util_1 = __importDefault(require("util"));
async function init() {
    // let prayerDBConnection: mongoose.Mongoose;
    try {
        // let prayerDBURI: string = nconf.get('MONGO_DB');
        // prayerDBConnection = await mongoose.connect(prayerDBURI, { useNewUrlParser: true, useUnifiedTopology: true });
        // mongoose.set('useCreateIndex', true);
        //mongoose.connections.forEach((value)=>value.close());
        let prayersContoller = new prayers_controller_1.default();
        await prayersContoller.initializePrayerManger();
        console.log(util_1.default.inspect(prayersContoller.router.getPrayersLocation(), { showHidden: false, depth: null }));
        console.log("I DID't CRAsH >.....................................>");
        //   console.log(prayersContoller.router.getPrayersAdjustments())
        //let app = new App([ new prayersController()]);
        // let eventProvider:events.ConfigEventProvider = new events.ConfigEventProvider("config/config.json");
        // let eventListener:events.ConfigEventListener = new events.ConfigEventListener();
        // eventProvider.registerListener(eventListener);
        // setTimeout(() => {
        //     app.listen();
        // }, 5000);
        // const server:Server = app.listen();
        process.on('SIGINT', async () => {
            process.exit(0);
        });
    }
    catch (err) {
        console.log(err);
    }
    finally {
        // await prayerDBConnection.disconnect();
    }
}
init();
// setTimeout(()=>{doSomething()}, 5000);
// async function  doSomething()
// {        let err:Error, result: any, url: any;
// let queryString: any =
// {
//     uri: 'http://localhost:3005/PrayerManager/PrayersAdjustments/',
//     method: 'GET',
//     json: true,
//     resolveWithFullResponse: false
// };
// [err, result] = await to(request.get(queryString));
// console.log(result);
// console.log("Error: "+err);
// }
