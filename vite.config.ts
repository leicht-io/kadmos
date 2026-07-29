import { defineConfig } from "vite";

export default defineConfig({
  root: "./examples",
  build: {
    outDir: "dist",
  },
  server: {
    port: 1234,
  },
});
