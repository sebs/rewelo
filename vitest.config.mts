import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 10000,
    globalSetup: ["test/global-setup.ts"],
  },
});
