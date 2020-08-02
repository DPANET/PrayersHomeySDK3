import config from "nconf";
import {IController} from "../controllers/controllers.interface"

//import helmet from "helmet";
//import proxy from "http-proxy-middleware";

export class App {
  public app: IController[];

  constructor(controllers: IController[]) {
    
    this.app = new Array<IController>();

    this.initializeControllers(controllers);
  }


 
  private initializeControllers(controllers: IController[]):void {
    controllers.forEach((controller) => {
      this.app.push( controller);
    });
  }
 
}
 
