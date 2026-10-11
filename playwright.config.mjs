import { defineConfig } from "@playwright/test";
import { browserSettings } from "./scripts/browser-runtime.mjs";
import { validatePort } from "./scripts/launch.mjs";

const port = validatePort(Number(process.env.DEMO_PORT ?? 4173));
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests",
  testMatch: "browser.spec.mjs",
  timeout: 30000,
  expect: { timeout: 10000 },
  workers: 2,
  reporter: [["list"]],
  use: { baseURL, browserName: "chromium", ...browserSettings().launch, headless: true, viewport: { width: 1600, height: 1100 } },
  webServer: {
    command: "node demo/server.mjs",
    url: `${baseURL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },
});
