import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 45000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  workers: 3,
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  webServer: { command: "npm run dev", port: 4173, reuseExistingServer: Boolean(process.env.PLAYWRIGHT_REUSE) },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 360, height: 800 } },
    },
    {
      name: "webkit",
      use: {
        ...devices["iPhone 13"],
        launchOptions: {
          env: Object.fromEntries(
            Object.entries(process.env).filter(
              ([key, value]) =>
                !(
                  ["GTK_PATH", "GIO_MODULE_DIR", "GIO_EXTRA_MODULES"].includes(
                    key,
                  ) && value.includes("/snap/")
                ),
            ),
          ),
        },
      },
    },
  ],
});
