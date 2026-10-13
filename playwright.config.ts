// Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
import { defineConfig, devices } from "@playwright/test";

const port = 5174;

export default defineConfig({
  testDir: "tests/e2e",
  // CI renders WebGL in software, which is slow at phone resolutions
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: `http://localhost:${port}/` },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "node tools/dev.mjs",
    env: { PORT: String(port) },
    port,
    reuseExistingServer: !process.env.CI,
  },
});
