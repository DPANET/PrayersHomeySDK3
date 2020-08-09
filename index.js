"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const nconf_1 = __importDefault(require("nconf"));
nconf_1.default.file('env.json');
// process.env.DEBUG = nconf.get("DEBUG");
const prayers_controller_1 = __importDefault(require("./controllers/prayers.controller"));
const prayerlib = __importStar(require("@dpanet/prayers-lib"));
const util_1 = __importDefault(require("util"));
async function init() {
    let configProvider = prayerlib.ConfigProviderFactory.createConfigProviderFactory(prayerlib.ClientConfigurator);
    let prayerConfig = await configProvider.getPrayerConfig();
    let locationConfig = await configProvider.getLocationConfig();
    let prayerManager = await prayerlib.PrayerTimeBuilder
        .createPrayerTimeBuilder(locationConfig, prayerConfig)
        .createPrayerTimeManager();
    let prayersContoller = new prayers_controller_1.default(configProvider);
    await prayersContoller.initializePrayerManger();
    console.log(util_1.default.inspect(prayersContoller.router.getPrayers(), { showHidden: false, depth: null }));
}
//     // let prayerDBConnection: mongoose.Mongoose;
//     try {
//         // let prayerDBURI: string = nconf.get('MONGO_DB');
//         // prayerDBConnection = await mongoose.connect(prayerDBURI, { useNewUrlParser: true, useUnifiedTopology: true });
//         // mongoose.set('useCreateIndex', true);
//         //mongoose.connections.forEach((value)=>value.close());
//         //let prayersContoller:PrayersController = new PrayersController(prayer);
//        // await prayersContoller.initializePrayerManger()
//        // console.log(util.inspect(  prayersContoller.router.getPrayersLocation(), {showHidden: false, depth: null}));
//         console.log("I DID't CRAsH >.....................................>")
//      //   console.log(prayersContoller.router.getPrayersAdjustments())
//         //let app = new App([ new prayersController()]);
//         // let eventProvider:events.ConfigEventProvider = new events.ConfigEventProvider("config/config.json");
//         // let eventListener:events.ConfigEventListener = new events.ConfigEventListener();
//         // eventProvider.registerListener(eventListener);
//         // setTimeout(() => {
//         //     app.listen();
//         // }, 5000);
//         // const server:Server = app.listen();
//         process.on('SIGINT', async () => {
//               process.exit(0);
//           })
//     }
//     catch (err) {
//         console.log(err)
//     }
//     finally {
//        // await prayerDBConnection.disconnect();
//     }
// }
init();
// // setTimeout(()=>{doSomething()}, 5000);
// // async function  doSomething()
// // {        let err:Error, result: any, url: any;
// // let queryString: any =
// // {
// //     uri: 'http://localhost:3005/PrayerManager/PrayersAdjustments/',
// //     method: 'GET',
// //     json: true,
// //     resolveWithFullResponse: false
// // };
// // [err, result] = await to(request.get(queryString));
// // console.log(result);
// // console.log("Error: "+err);
// // }
