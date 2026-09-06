// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,
  // एक ही बड़ी test-file में सब tests क्रम से चलते थे (एक worker), इसलिए suite 15 मिनट की CI
  // सीमा पार करने लगी। हर test अपना अलग browser-context लेता है (localStorage/DOM अलग-अलग) और
  // कोई भी असली Firebase को नहीं छूता, इसलिए साथ-साथ चलाना सुरक्षित है
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8080',
    viewport: { width: 420, height: 820 },
    // sandbox/local में pre-installed Chromium; CI में default download
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: {
    command: 'python3 -m http.server 8080',
    url: 'http://127.0.0.1:8080',
    reuseExistingServer: true,
    timeout: 15000,
  },
});
