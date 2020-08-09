 import nconf from 'nconf';
nconf.file('env.json');
// process.env.DEBUG = nconf.get("DEBUG");
import PrayersController from "./controllers/prayers.controller";
import * as prayerlib from "@dpanet/prayers-lib";
// //import {IPrayersController} from "./controllers/controllers.interface";
import {App} from "./routes/main.router";
import util from "util";


 async function init(): Promise<void> {
    let configProvider:prayerlib.IConfigProvider = prayerlib.ConfigProviderFactory.createConfigProviderFactory(prayerlib.ClientConfigurator);
    let prayerConfig: prayerlib.IPrayersConfig = await configProvider.getPrayerConfig();
    let locationConfig: prayerlib.ILocationConfig = await configProvider.getLocationConfig();
    let prayerManager: prayerlib.IPrayerManager = await prayerlib.PrayerTimeBuilder
            .createPrayerTimeBuilder(locationConfig, prayerConfig)
            .createPrayerTimeManager() ;
    let prayersContoller:PrayersController = new PrayersController(configProvider);
    await prayersContoller.initializePrayerManger();
    console.log(util.inspect(  prayersContoller.router.getPrayers(), {showHidden: false, depth: null}));
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