/* UI contract checks with synthetic fixtures only. Every API call is intercepted;
   fake credentials and write requests never reach a real backend. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '..');
const artifacts = path.resolve(root, '../.superpowers/console-qa');
const baseline = process.argv.includes('--baseline');
const base = process.env.WMS_UI_URL || 'http://127.0.0.1:5173';
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
fs.mkdirSync(artifacts, { recursive: true });
const hashes = () => Object.fromEntries(['routes.tsx', 'permissions.ts'].map((name) => [name,
  crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'src/router', name))).digest('hex'),
]));
const fixture = {
  stats: { todayInbound: 248, todayOutbound: 186, pendingOrders: 32, pendingSignout: 12, totalSkus: 94, exceptionCount: 4 },
  trend: { labels: ['09-24', '09-25', '09-26', '09-27', '09-28', '09-29', '09-30'], inbound: [120, 154, 142, 190, 170, 220, 248], outbound: [90, 110, 125, 160, 150, 180, 186] },
  capacity: { total: 20, occupied: 12, reserved: 2, empty: 6, utilizationRate: 70 },
  todos: [{ id: 't1', type: 'receiving', title: '待完成收货单', count: 32 }, { id: 't2', type: 'putaway', title: '待上架任务', count: 8 }, { id: 't3', type: 'inventory', title: '低库存预警', count: 0 }],
};
const order = {
  id: 'ui-fixture-order', orderNo: 'DEMO-OB-001', customerName: 'Synthetic customer', totalItems: 2,
  status: 'PACKING', createdAt: '2026-09-30T08:00:00Z', carrier: 'DEMO-CARRIER', fee: '12.50',
  totalProductCount: 2, warehouseCode: 'DEMO-WH', recipientName: 'Synthetic recipient',
  items: [{ sku: 'DEMO-SKU-A', productName: 'Synthetic item A', requiredQty: 2, pickedQty: 2, packedQty: 0 }, { sku: 'DEMO-SKU-B', productName: 'Synthetic item B', requiredQty: 1, pickedQty: 1, packedQty: 0 }], exceptions: [],
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-proxy-server'] });
  const results = [];
  const errors = [];
  const unexpected = [];
  const writes = [];
  let failTrend = false;
  let emptyCapacity = false;
  let emptyTodos = false;
  let trendRequests = 0;
  async function open(role = 'SUPER_ADMIN') {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', async (req) => {
      const url = new URL(req.url());
      if (url.pathname.startsWith('/api/')) {
        const endpoint = url.pathname.replace('/api/v1', '');
        let data;
        if (req.method() !== 'GET') {
          writes.push({ endpoint, body: req.postData() });
          if (endpoint.endsWith('/pack')) {
            const { sku } = JSON.parse(req.postData());
            const item = order.items.find((row) => row.sku === sku);
            if (item.packedQty >= item.requiredQty) return req.respond({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Over quantity' }) });
            item.packedQty += 1;
            data = { packedQty: item.packedQty };
          } else data = {};
        } else if (endpoint === '/dashboard/stats') data = fixture.stats;
        else if (endpoint === '/dashboard/trend') {
          trendRequests++;
          if (failTrend) return req.respond({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic unavailable trend' }) });
          data = fixture.trend;
        } else if (endpoint === '/dashboard/todos') data = emptyTodos ? [] : fixture.todos;
        else if (endpoint === '/dashboard/warehouse-utilization') data = emptyCapacity ? { total: 0, occupied: 0, reserved: 0, empty: 0, utilizationRate: 0 } : fixture.capacity;
        else if (endpoint === '/outbound-orders') data = url.searchParams.get('status') === 'PICKED' ? [] : [order];
        else if (endpoint === '/outbound-orders/ui-fixture-order') data = order;
        else if (['/customers', '/warehouses', '/products', '/receiving-orders', '/putaway-tasks'].includes(endpoint)) data = [];
        else { unexpected.push(endpoint); data = []; }
        return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, data, pagination: { total: Array.isArray(data) ? data.length : 1 } }) });
      }
      // Keep the test local and deterministic; don't publish fixture data externally.
      if (url.origin !== new URL(base).origin && !['data:', 'blob:'].includes(url.protocol)) return req.abort();
      return req.continue();
    });
    await page.evaluateOnNewDocument((role) => {
      localStorage.setItem('wms-auth-storage', JSON.stringify({ state: { token: 'synthetic-ui-token', userInfo: { id: 'ui-fixture', name: 'UI fixture', role }, warehouseId: null }, version: 0 }));
    }, role);
    return page;
  }
  const shot = async (page, name) => { await wait(300); await page.screenshot({ path: path.join(artifacts, `${baseline ? 'before' : 'after'}-${name}.png`), fullPage: false }); };
  const check = (name, value) => { assert.ok(value, name); results.push(name); };
  try {
    const page = await open();
    await page.goto(`${base}/dashboard`, { waitUntil: 'networkidle0' });
    await shot(page, 'dashboard-1440');
    if (baseline) {
      fs.writeFileSync(path.join(artifacts, 'navigation-baseline.json'), JSON.stringify(hashes(), null, 2));
      for (const [route, name] of [['/outbound/picking', 'outbound'], ['/outbound/packing', 'packing']]) {
        await page.goto(`${base}${route}`, { waitUntil: 'networkidle0' });
        await shot(page, `${name}-1440`);
      }
      console.log('Baseline captured with synthetic fixtures. Navigation hashes saved.');
      return;
    }
    const text = await page.$eval('body', (el) => el.innerText);
    check('No invented warehouse or shift context', !text.includes('深圳主仓') && !text.includes('早班'));
    check('No hardcoded comparative percentages', !text.includes('较昨日'));
    check('All six metrics retained', (await page.$$('.console-metric')).length === 6);
    check('Actual metric values rendered', ['248', '186', '32', '12', '94', '4'].every((value) => text.includes(value)));
    check('Task categories link to real routes', await page.$('a[href="/inbound/receiving"]'));
    check('Shortcut links include packing', await page.$('a[href="/outbound/packing"]'));
    const colors = await page.evaluate(() => {
      let header = document.querySelector('.ant-pro-global-header');
      const backgrounds = [];
      while (header) { backgrounds.push(getComputedStyle(header).backgroundColor); header = header.parentElement; }
      return { primary: getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim(), backgrounds };
    });
    check('Primary token remains exact brand red', colors.primary.toLowerCase() === '#e61b2b');
    check('Header remains brand red', colors.backgrounds.includes('rgb(230, 27, 43)'));
    for (const [width, height] of [[1920,1080], [1280,800], [768,1024], [390,844]]) {
      await page.setViewport({ width, height });
      await wait(250);
      check(`No horizontal page overflow at ${width}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      check(`No clipped Dashboard content at ${width}`, await page.$eval('.console-dashboard', (el) => el.scrollWidth <= el.clientWidth + 1));
      await shot(page, `dashboard-${width}`);
    }
    await page.setViewport({ width: 1440, height: 900 });
    failTrend = true;
    await page.reload({ waitUntil: 'networkidle0' });
    check('A failed trend leaves successful metrics visible', (await page.$eval('.console-metrics', (el) => el.innerText)).includes('248'));
    check('Trend failure has local retry', await page.$('[data-widget="trend"] button'));
    const attempts = trendRequests;
    failTrend = false;
    await page.click('[data-widget="trend"] button');
    await page.waitForFunction(() => !document.querySelector('[data-widget="trend"] [role="alert"]'));
    check('Retry actually requests trend', trendRequests > attempts);
    emptyCapacity = true;
    emptyTodos = true;
    await page.reload({ waitUntil: 'networkidle0' });
    check('Zero capacity is not replaced with fake availability', (await page.$eval('[data-widget="capacity"]', (el) => el.innerText)).includes('No active locations'));
    check('Empty tasks do not become placeholder notices', !(await page.$eval('body', (el) => el.innerText)).includes('系统升级维护通知'));
    await shot(page, 'empty-dashboard');
    emptyCapacity = false;
    emptyTodos = false;
    const finance = await open('FINANCE');
    await finance.goto(`${base}/dashboard`, { waitUntil: 'networkidle0' });
    check('Finance cannot see packing shortcut', !(await finance.$('a[href="/outbound/packing"]')));
    check('Finance retains allowed quote shortcut', await finance.$('a[href="/fee/calculator"]'));
    await finance.close();
    await page.goto(`${base}/outbound/picking`, { waitUntil: 'networkidle0' });
    check('Outbound table scroll is contained', await page.$('.console-data-page .ant-table-content'));
    await shot(page, 'outbound-1440');
    const detail = await page.evaluateHandle(() => [...document.querySelectorAll('a,button')].find((el) => el.textContent.trim() === '详情'));
    const detailBox = await detail.asElement().boundingBox();
    check('Desktop detail action is visible without horizontal scrolling', detailBox && detailBox.x + detailBox.width <= 1440);
    await detail.asElement().click();
    await page.waitForSelector('.ant-drawer-open .ant-descriptions');
    check('Full fulfillment groups retained', (await page.$eval('.ant-drawer-open', (el) => el.innerText)).includes('生命周期'));
    await shot(page, 'outbound-detail-1440');
    await page.setViewport({ width: 390, height: 844 });
    await shot(page, 'outbound-detail-390');
    check('Drawer fits narrow viewport', await page.$eval('.ant-drawer-content-wrapper', (el) => el.getBoundingClientRect().width <= innerWidth));
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${base}/outbound/packing`, { waitUntil: 'networkidle0' });
    check('Packing selector is accessibly named', await page.$('input[aria-label="Select packing order"]'));
    await page.click('.ant-select-selector');
    await page.waitForSelector('.ant-select-item-option');
    await page.click('.ant-select-item-option');
    await page.waitForSelector('input[aria-label="Scan SKU"]');
    await page.type('input[aria-label="Scan SKU"]', 'DEMO-SKU-A');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].some((el) => el.textContent.includes('1/2')));
    check('Scan issues the existing pack contract', writes.some((row) => row.endpoint.endsWith('/pack') && JSON.parse(row.body).sku === 'DEMO-SKU-A'));
    const count = writes.length;
    await page.type('input[aria-label="Scan SKU"]', 'UNKNOWN-SKU');
    await page.keyboard.press('Enter');
    await wait(200);
    check('Unknown SKU does not submit', writes.length === count);
    await shot(page, 'packing-1440');
    await page.setViewport({ width: 390, height: 844 });
    await shot(page, 'packing-390');
    check('Packing page does not overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    check('No page errors', errors.length === 0);
    check('No unexpected API contracts', unexpected.length === 0);
    assert.deepEqual(hashes(), JSON.parse(fs.readFileSync(path.join(artifacts, 'navigation-baseline.json'), 'utf8')), 'Existing menu/routes and RBAC must remain byte-for-byte unchanged');
    results.push('Navigation and permission source hashes unchanged');
    fs.writeFileSync(path.join(artifacts, 'results.json'), JSON.stringify({ mode: 'synthetic intercepted UI contract tests; no real backend writes', checks: results, pageErrors: errors, unexpectedEndpoints: unexpected }, null, 2));
    console.log(`${results.length} UI checks passed. Artifacts: ${artifacts}`);
  } catch (error) {
    fs.writeFileSync(path.join(artifacts, baseline ? 'baseline-failure.json' : 'failure.json'), JSON.stringify({ passed: results, failure: error.message, pageErrors: errors, unexpectedEndpoints: unexpected }, null, 2));
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
