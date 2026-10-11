import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".\\tests",
  testMatch: "browser.spec.mjs",
  timeout: 30000,
  expect: { timeout: 10000 },
  workers: 2,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4173", channel: "msedge", headless: true, viewport: { width: 1600, height: 1100 } },
  webServer: {
    command: "node demo\\server.mjs",
    url: "http://127.0.0.1:4173/health",
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },
});
