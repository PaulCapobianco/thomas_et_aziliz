import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.js';
const safari = base.projects.find(project => project.name === 'webkit').use.launchOptions;
export default defineConfig({
  ...base,
  testMatch: 'media-layout.spec.js',
  outputDir: 'test-results/media',
  use: { ...base.use, baseURL: 'http://127.0.0.1:4175' },
  webServer: { command: 'python3 scripts/serve.py --port 4175', port: 4175, reuseExistingServer: Boolean(process.env.PLAYWRIGHT_REUSE) },
  projects: [
    { name: 'iphone-se', use: { ...devices['iPhone SE'], viewport: { width: 375, height: 667 }, launchOptions: safari } },
    { name: 'iphone-13', use: { ...devices['iPhone 13'], launchOptions: safari } },
    { name: 'pixel-7', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
});
