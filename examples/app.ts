import { Kadmos } from "../src";

export class App {
  constructor() {
    this.startKadmos();
  }

  startKadmos(): void {
    // http://localhost:1234/?fileUrl=https://example.com/model.stl&color=0x333333
    Kadmos.initFromUrl();
  }
}

new App();
