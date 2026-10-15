import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

mkdirSync("dist/assets", { recursive: true });
copyFileSync("src/assets/styles.css", "dist/assets/styles.css");

// Import the stylesheet from the JS entry only; see src/index.ts. Inserted
// after the first line so the existing source map stays aligned.
const entry = "dist/index.js";
const [first, ...rest] = readFileSync(entry, "utf8").split("\n");
writeFileSync(
  entry,
  [first, 'import "./assets/styles.css";', ...rest].join("\n"),
);
