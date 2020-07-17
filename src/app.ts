import Homey = require('homey');
import config = require('nconf');
config.file('env.json');
process.env.DEBUG= config.get("DEBUG");
import fs from "fs-extra";
cloneConfig();
import * as manager from './prayers/manager';
import prayersController from "@dpanet/prayerswebapp/lib/controllers/prayers.controller";
import mainController from "@dpanet/prayerswebapp/lib/controllers/main.controller";
import keyController from "@dpanet/prayerswebapp/lib/controllers/keys.controller"
import {App} from "@dpanet/prayerswebapp/lib/routes/main.router";
import * as sentry from "@sentry/node";
sentry.init({ dsn: config.get("DSN") });
class PrayersApp extends Homey.App {

    onInit() {
        try{
        this.log(` Prayers Alert App is running! `);
        let app:App = new App([new prayersController(),new mainController(),new keyController()]);
        setTimeout(() => {            
            app.listen();
        }, 5000);   
        manager.PrayersAppManager.initApp();
    }catch(err)
    {
        sentry.captureException(err);
        this.log(err);
    }

    }
}
function cloneConfig()
{
    fs.copySync(Homey.env.NODE_CONFIG_DIR,Homey.env.CONFIG_FOLDER_PATH,{overwrite:false});
}
module.exports = PrayersApp;

