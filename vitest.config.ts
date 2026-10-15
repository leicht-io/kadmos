import { defineConfig } from "vitest/config";

// Separate from vite.config.ts, whose root is the examples/ demo app.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
