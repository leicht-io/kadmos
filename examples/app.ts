import "../src/assets/styles.scss";
import { Kadmos } from "../src";

// Query-param mode. Without a fileUrl, show the bundled sample model:
// http://localhost:1234/?fileUrl=https://example.com/model.stl&color=0x333333
const params = new URLSearchParams(window.location.search);
if (!params.has("fileUrl")) {
  params.set("fileUrl", "models/knot.stl");
  history.replaceState(null, "", `?${params}`);
}

Kadmos.initFromUrl();
