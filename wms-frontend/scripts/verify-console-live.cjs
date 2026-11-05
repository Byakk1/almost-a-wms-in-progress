// Read-only live smoke: authenticate, then GET existing screens. No business writes.
const puppeteer = require('puppeteer-core');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.WMS_UI_URL || 'http://127.0.0.1:5173';
const artifacts = path.resolve(__dirname, '../../.superpowers/console-qa');
(async () => {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.WMS_LOGIN_EMAIL, password: process.env.WMS_LOGIN_PASSWORD }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json();
  if (!response.ok || !body.data?.accessToken) throw new Error(`Live login failed: HTTP ${response.status}; ${body.message || 'no token'}`);
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  const api = [];
  const errors = [];
  const blockedWrites = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (r) => { if (r.url().includes('/api/v1/')) api.push({ path: new URL(r.url()).pathname, status: r.status() }); });
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/') && request.method() !== 'GET') { blockedWrites.push(url.pathname); return request.abort(); }
    if (url.origin !== new URL(base).origin && !['data:', 'blob:'].includes(url.protocol)) return request.abort();
    return request.continue();
  });
  try {
    await page.evaluateOnNewDocument((data) => localStorage.setItem('wms-auth-storage', JSON.stringify({ state: { token: data.accessToken, userInfo: data.user, warehouseId: data.user.warehouseId }, version: 0 })), body.data);
    await page.setViewport({ width: 1440, height: 900 });
    for (const route of ['/dashboard', '/outbound/picking', '/outbound/packing']) {
      await page.goto(`${base}${route}`, { waitUntil: 'networkidle0', timeout: 30000 });
      await new Promise((resolve) => setTimeout(resolve, 1200));
      if (route === '/dashboard') {
        await page.waitForFunction(() => [...document.querySelectorAll('[data-widget]')].every((node) => node.getAttribute('aria-busy') === 'false'), { timeout: 15000 });
      }
      // No screenshots of actual customer/order data are exported by this script.
    }
    const failed = api.filter((r) => r.status >= 400);
    const report = { mode: 'live GET-only browser smoke after authentication; no business writes or customer data exported', api, pageErrors: errors, blockedWrites, passed: failed.length === 0 && errors.length === 0 && blockedWrites.length === 0 };
    fs.mkdirSync(artifacts, { recursive: true });
    fs.writeFileSync(path.join(artifacts, 'live-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
  } finally { await browser.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
