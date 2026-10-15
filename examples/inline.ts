import "../src/assets/styles.scss";
import { Kadmos, ThemeSetting } from "../src";

const viewers = [
  Kadmos.mount(document.getElementById("knot")!, {
    src: "models/knot.stl",
    color: "#3b6ea5",
  }),
  Kadmos.mount(document.getElementById("plate")!, {
    src: "models/plate-and-peg.3mf",
    plate: "prusa-mini",
    accent: "#0d9488",
  }),
];

document.querySelectorAll<HTMLButtonElement>("[data-theme]").forEach((button) =>
  button.addEventListener("click", () => {
    for (const viewer of viewers) {
      viewer.setTheme(button.dataset.theme as ThemeSetting);
    }
  }),
);
