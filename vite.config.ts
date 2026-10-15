import { resolve } from "node:path";
import { defineConfig } from "vite";

const examples = resolve(import.meta.dirname, "examples");

export default defineConfig({
  root: "./examples",
  build: {
    outDir: "dist",
    rolldownOptions: {
      input: {
        main: resolve(examples, "index.html"),
        popup: resolve(examples, "popup.html"),
        inline: resolve(examples, "inline.html"),
      },
    },
  },
  server: {
    port: 1234,
  },
});
