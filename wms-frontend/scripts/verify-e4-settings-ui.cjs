/* Browser verification of /settings/tax-rates and /settings/surcharges against the
   REAL backend. Drives the actual UI: creates a throwaway tax rate + surcharge,
   edits the tax rate to 停用, and asserts the PASS_THROUGH value field is disabled.
   Creates real DB rows; the API has no delete (end-date by design), so it prints
   the created ids under 'CLEANUP ids:' for the lead's wipe step. It does NOT
   remove them itself — a browser script has no write path to do so.
   Not part of the committed contract suite — a one-off E4 acceptance probe. */
const puppeteer = require('puppeteer-core');
const fs = require('node:fs');
const path = require('node:path');

const base = process.env.WMS_UI_URL || 'http://127.0.0.1:5173';
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// Credentials come from the environment only — this repository is public.
const adminEmail = process.env.WMS_ADMIN_EMAIL || 'admin@convex-wms.local';
const adminPassword = process.env.WMS_ADMIN_PASSWORD;
if (!adminPassword) throw new Error('set WMS_ADMIN_PASSWORD (the admin login) before running');
const shots = path.resolve(__dirname, 'shots');
const RUN = Date.now().toString(36);
const FX = {
  tax: { countryCode: 'AA', jurisdiction: 'UI', taxType: 'GST', ratePercent: 1 },
  surcharge: { code: `E2E_UI_FLAT_${RUN}`.toUpperCase(), name: 'UI Flat Surcharge', calcType: 'FLAT', value: 1 },
};
const today = new Date().toISOString().slice(0, 10);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const checks = [];
const check = (n, ok) => { checks.push([n, ok]); console.log(`  · ${n} -> ${ok ? 'PASS' : 'FAIL'}`); };

/** antd renders duplicate rows when a column is `fixed: 'right'`; the hidden copy
    is not clickable. Click the first VISIBLE element matching a predicate. */
const clickVisible = (page, predSrc, arg) => page.evaluate((src, a) => {
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const pred = new Function('el', 'a', src);
  const el = [...document.querySelectorAll('a, button')].filter(visible).find((n) => pred(n, a));
  if (!el) throw new Error('no visible element matched');
  el.click();
  return true;
}, predSrc, arg);

/** Type into a React-controlled input identified by its Form.Item id. */
const typeById = async (page, id, text) => {
  const sel = `#${id}`;
  const el = await page.$(sel);
  if (!el) throw new Error(`input ${sel} not found`);
  await el.click({ clickCount: 3 });
  await el.type(text);
};

/** Open an antd Select (identified by its Form.Item id) and click the option whose
    text contains `label`.
    antd 5's Select ignores a synthetic `dispatchEvent(new MouseEvent('mousedown'))`
    — the option list never renders (probed: 0 options). A real puppeteer click on
    the input opens it (probed: all options listed), so drive it like a user would. */
const pickSelect = async (page, id, label) => {
  await page.click(`#${id}`);
  await wait(400);
  const picked = await page.evaluate((lbl) => {
    const opt = [...document.querySelectorAll('.ant-select-item-option')]
      .find((o) => o.innerText.trim().includes(lbl));
    if (!opt) return false;
    opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  }, label);
  if (!picked) throw new Error(`option "${label}" not found`);
  await wait(300);
};

/** Type a date into an antd DatePicker (identified by its Form.Item id). */
const typeDate = async (page, id, iso) => {
  await page.click(`#${id}`);
  await wait(200);
  await page.keyboard.type(iso);
  await wait(200);
  await page.keyboard.press('Enter');
  await wait(200);
};

(async () => {
  console.log('E4 settings UI verification against real backend…');

  // Real login to get a token (same creds as verify-users-ui.cjs).
  const login = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  const body = await login.json();
  if (!body.data?.accessToken) throw new Error('login failed');
  const token = body.data.accessToken;
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const api = (p) => fetch(`${base}/api/v1${p}`, { headers: H }).then((r) => r.json());

  // Pre-clean: park (deactivate) any tax rate / surcharge a crashed earlier run
  // left behind. No delete endpoint by design, so stale probes are deactivated;
  // the lead's DB wipe removes them.
  const staleTax = await api('/tax-rates?jurisdiction=UI&pageSize=50');
  for (const r of staleTax.data ?? []) {
    if (r.isActive) await fetch(`${base}/api/v1/tax-rates/${r.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ isActive: false }) });
  }
  const staleSur = await api('/surcharges?code=E2E_UI_FLAT&pageSize=50');
  for (const s of staleSur.data ?? []) {
    if (s.isActive) await fetch(`${base}/api/v1/surcharges/${s.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ isActive: false }) });
  }
  if ((staleTax.data ?? []).length || (staleSur.data ?? []).length) {
    console.log(`  (parked ${(staleTax.data ?? []).length} tax + ${(staleSur.data ?? []).length} surcharge stale row(s))`);
  }

  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  const pageErrors = [];
  const apiCalls = [];
  // Capture ids straight off the POST responses so CLEANUP does not depend on
  // whether the list filter is exact-match or contains.
  const createdIds = { taxRates: [], surcharges: [] };
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('response', async (r) => {
    if (!r.url().includes('/api/v1/')) return;
    const p = new URL(r.url()).pathname;
    apiCalls.push(`${r.request().method()} ${p} ${r.status()}`);
    if (r.request().method() === 'POST' && r.status() === 201) {
      try {
        const j = await r.json();
        const id = j?.data?.id;
        if (id && p.endsWith('/tax-rates')) createdIds.taxRates.push(id);
        if (id && p.endsWith('/surcharges')) createdIds.surcharges.push(id);
      } catch { /* non-JSON body — ignore */ }
    }
  });

  await page.evaluateOnNewDocument((t) => localStorage.setItem('wms-auth-storage', JSON.stringify({
    state: { token: t, userInfo: { id: 'seed_user_admin', name: 'System Admin', role: 'SUPER_ADMIN' }, warehouseId: null }, version: 0,
  })), token);

  await page.setViewport({ width: 1440, height: 900 });
  fs.mkdirSync(shots, { recursive: true });

  // ── 1. tax-rates page loads against the real API ────────────────────
  await page.goto(`${base}/settings/tax-rates`, { waitUntil: 'networkidle0', timeout: 30000 });
  await wait(1500);
  const taxTitle = await page.$eval('.ant-page-header-heading-title', (el) => el.textContent.trim()).catch(() => '');
  check('tax-rates page renders 税率管理 heading', taxTitle.includes('税率管理'));
  check('GET /tax-rates returned 200', apiCalls.some((c) => c.startsWith('GET /api/v1/tax-rates 200')));
  check('shows the public-law alert', await page.evaluate(() => document.body.innerText.includes('税率为公法数据；账单在账期末解析适用税率')));
  check('has a 新增税率 button', await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.innerText.includes('新增税率'))));
  await page.screenshot({ path: path.join(shots, 'e4-settings-tax-rates.png') });

  // seeded total: 18 CA rows + 3 export rows = 21 (>= 21 across pagination)
  const taxTotal = (await api('/tax-rates?pageSize=1')).pagination?.total ?? 0;
  check(`/tax-rates pagination total >= 21 (got ${taxTotal})`, taxTotal >= 21);

  // ── 2. create a tax rate through the UI ─────────────────────────────
  await clickVisible(page, `return el.innerText.includes('新增税率')`);
  await wait(700);
  check('tax-rate create modal opens', await page.evaluate(() => !!document.querySelector('.ant-modal #tax_rate_form_countryCode')));
  await typeById(page, 'tax_rate_form_countryCode', FX.tax.countryCode);
  await typeById(page, 'tax_rate_form_jurisdiction', FX.tax.jurisdiction);
  await pickSelect(page, 'tax_rate_form_taxType', 'GST');
  await typeDate(page, 'tax_rate_form_effectiveFrom', today);
  await typeById(page, 'tax_rate_form_ratePercent', String(FX.tax.ratePercent));
  await page.screenshot({ path: path.join(shots, 'e4-settings-tax-create-modal.png') });
  const beforeTaxPost = apiCalls.length;
  await page.evaluate(() => [...document.querySelectorAll('.ant-modal-footer button')].find((b) => b.innerText.replace(/\s/g, '') === '创建').click());
  await wait(2000);
  check('POST /tax-rates returned 201', apiCalls.slice(beforeTaxPost).some((c) => c.startsWith('POST /api/v1/tax-rates 201')));
  check('new tax rate appears in the list', await page.evaluate(() => document.body.innerText.includes('AA')));
  // Date-shift regression (E4): the picked day must be stored at UTC MIDNIGHT.
  // The page used to send .toISOString() of a local DatePicker day — in UTC+8
  // that is the PREVIOUS day 16:00Z, making a rate start 8 hours early (same
  // boundary class as the NS 15→14 % seed bug). Serialization is now YYYY-MM-DD.
  const createdTax = ((await api('/tax-rates?jurisdiction=UI&pageSize=50')).data ?? [])
    .find((r) => r.countryCode === 'AA');
  check('create stored the picked day at UTC midnight (no local shift)', !!createdTax
    && String(createdTax.effectiveFrom).slice(0, 10) === today
    && new Date(createdTax.effectiveFrom).getUTCHours() === 0);

  // ── 3. edit -> isActive false -> tag shows 停用 ──────────────────────
  await clickVisible(page, `return el.innerText.replace(/\\s/g, '') === '编辑' && el.closest('tr') && el.closest('tr').innerText.includes('AA')`);
  await wait(700);
  check('edit modal opens with the 保留历史 hint', await page.evaluate(() => document.body.innerText.includes('调整税率请结束当前行并新增一行，以保留历史')));
  check('edit modal hides immutable fields (no countryCode input)', await page.evaluate(() => !document.querySelector('.ant-modal #tax_rate_form_countryCode')));
  // The 启用 Switch is rendered only on edit; toggle it off.
  await page.evaluate(() => {
    const sw = document.querySelector('.ant-modal #tax_rate_form_isActive');
    if (sw) sw.click();
  });
  await wait(300);
  const beforeEdit = apiCalls.length;
  await page.evaluate(() => [...document.querySelectorAll('.ant-modal-footer button')].find((b) => b.innerText.replace(/\s/g, '') === '保存').click());
  await wait(2000);
  check('PUT /tax-rates returned 200', apiCalls.slice(beforeEdit).some((c) => /^PUT \/api\/v1\/tax-rates\/.+ 200$/.test(c)));
  check('row now shows 停用', await page.evaluate(() => {
    const row = [...document.querySelectorAll('tr')].find((tr) => tr.innerText.includes('AA') && tr.innerText.includes('UI'));
    return !!row && row.innerText.includes('停用');
  }));
  await page.screenshot({ path: path.join(shots, 'e4-settings-tax-edited.png') });

  // ── 4. surcharges page: FUEL shows 实报实销 ─────────────────────────
  await page.goto(`${base}/settings/surcharges`, { waitUntil: 'networkidle0', timeout: 30000 });
  await wait(1500);
  const surTitle = await page.$eval('.ant-page-header-heading-title', (el) => el.textContent.trim()).catch(() => '');
  check('surcharges page renders 附加费管理 heading', surTitle.includes('附加费管理'));
  check('GET /surcharges returned 200', apiCalls.some((c) => c.startsWith('GET /api/v1/surcharges 200')));
  check('FUEL row shows 实报实销', await page.evaluate(() => {
    const row = [...document.querySelectorAll('tr')].find((tr) => tr.innerText.includes('FUEL'));
    return !!row && row.innerText.includes('实报实销');
  }));
  await page.screenshot({ path: path.join(shots, 'e4-settings-surcharges.png') });

  // ── 5. create a FLAT surcharge through the UI ───────────────────────
  await clickVisible(page, `return el.innerText.includes('新增附加费')`);
  await wait(700);
  check('surcharge create modal opens', await page.evaluate(() => !!document.querySelector('.ant-modal #surcharge_form_code')));
  await typeById(page, 'surcharge_form_code', FX.surcharge.code);
  await pickSelect(page, 'surcharge_form_calcType', '固定');
  await typeById(page, 'surcharge_form_name', FX.surcharge.name);
  await typeById(page, 'surcharge_form_value', String(FX.surcharge.value));
  await typeDate(page, 'surcharge_form_effectiveFrom', today);
  const beforeSurPost = apiCalls.length;
  await page.evaluate(() => [...document.querySelectorAll('.ant-modal-footer button')].find((b) => b.innerText.replace(/\s/g, '') === '创建').click());
  await wait(2000);
  check('POST /surcharges returned 201', apiCalls.slice(beforeSurPost).some((c) => c.startsWith('POST /api/v1/surcharges 201')));
  check('new FLAT surcharge appears in the list', await page.evaluate((c) => document.body.innerText.includes(c), FX.surcharge.code));
  const createdSur = ((await api('/surcharges?pageSize=100')).data ?? [])
    .find((s) => s.code === FX.surcharge.code);
  check('surcharge create stored the picked day at UTC midnight (no local shift)', !!createdSur
    && String(createdSur.effectiveFrom).slice(0, 10) === today
    && new Date(createdSur.effectiveFrom).getUTCHours() === 0);
  await page.screenshot({ path: path.join(shots, 'e4-settings-surcharge-created.png') });

  // ── 6. PASS_THROUGH disables + clears the value field ───────────────
  await clickVisible(page, `return el.innerText.includes('新增附加费')`);
  await wait(700);
  await typeById(page, 'surcharge_form_code', `E2E_UI_PT_${RUN}`.toUpperCase());
  await pickSelect(page, 'surcharge_form_calcType', '实报实销');
  await typeById(page, 'surcharge_form_name', 'UI Pass-Through Probe');
  const ptValueDisabled = await page.evaluate(() => {
    const el = document.querySelector('.ant-modal #surcharge_form_value');
    return !!el && el.disabled;
  });
  check('PASS_THROUGH disables the value field', ptValueDisabled);
  check('PASS_THROUGH shows the carrier-bill helper', await page.evaluate(() => document.body.innerText.includes('金额以承运商账单为准，在账单 finalize 时录入')));
  await page.screenshot({ path: path.join(shots, 'e4-settings-surcharge-passthrough.png') });
  // no POST should carry a value for this shape (we simply close without saving —
  // the disabled field is the guarantee the brief asks us to verify).
  await page.evaluate(() => [...document.querySelectorAll('.ant-modal-footer button')].find((b) => b.innerText.replace(/\s/g, '') === '取消').click());
  await wait(400);

  await page.screenshot({ path: path.join(shots, 'e4-settings-final.png') });
  check('no page errors', pageErrors.length === 0);

  // ── network: every /api/v1 call succeeded (304 not counted as failure) ──
  const failed = apiCalls.filter((c) => { const m = c.match(/ (\d{3})$/); return m && Number(m[1]) >= 400; });
  check('0 failed /api/v1 requests', failed.length === 0);
  if (failed.length) console.log('  failed calls:', failed.slice(0, 5));

  await browser.close();

  // ── report created ids for the lead's wipe (no delete endpoint) ─────
  // Primary source: ids captured off the POST 201 responses. Fallback: a list
  // query in case a response body was unreadable.
  if (!createdIds.taxRates.length) {
    createdIds.taxRates = ((await api('/tax-rates?jurisdiction=UI&pageSize=50')).data ?? []).map((r) => r.id);
  }
  if (!createdIds.surcharges.length) {
    createdIds.surcharges = ((await api(`/surcharges?code=${FX.surcharge.code}&pageSize=50`)).data ?? []).map((s) => s.id);
  }
  console.log('');
  console.log('CLEANUP ids: ' + JSON.stringify(createdIds));

  let allOk = true;
  console.log('');
  for (const [n, ok] of checks) { console.log(`CROSS-CHECK ${n} -> ${ok ? 'PASS' : 'FAIL'}`); if (!ok) allOk = false; }
  if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 3));
  console.log(`\n${allOk ? 'ALL UI CHECKS PASSED' : 'SOME UI CHECKS FAILED'} (${checks.length} checks)`);
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('UI VERIFY ERROR:', e.message); process.exit(1); });
