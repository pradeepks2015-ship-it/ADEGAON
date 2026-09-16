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
    // असली जड़ (diagnostics से पक्की हुई, देखें tests/smoke.spec.js: blockExternal): sw.js का
    // Service Worker CI पर कभी-कभी किसी पहले चले test से बचे हुए worker-profile cache से Firebase
    // CDN scripts सीधे serve कर देता है — page.route()/addInitScript() दोनों को यह पूरी तरह चकमा
    // दे देता है, क्योंकि SW का cached response कभी network तक जाता ही नहीं (route नहीं पकड़ता) और
    // वह असली <script> tag दोबारा execute होकर addInitScript का window.firebase=undefined मिटा
    // देता है। sw.js की अपनी जांच यहां सिर्फ़ static source-parsing/mocked-scope से होती है (कोई
    // test असली browser-registered SW पर निर्भर नहीं) — इसलिए सीधे Playwright स्तर पर हर context
    // में SW registration ही रोक देना सबसे पक्का, permanent fix है
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'python3 -m http.server 8080',
    url: 'http://127.0.0.1:8080',
    reuseExistingServer: true,
    timeout: 15000,
  },
});
