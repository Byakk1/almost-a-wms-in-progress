/* Browser verification of /fee/billing/generate and /fee/billing against the
   REAL backend. Drives the actual finance UI end to end: creates a fixture
   customer (via the API — the brief does not ask us to drive the customer
   page), generates a bill for the previous month through the form, asserts the
   drawer that opens shows the storage-waiver warning and the API amount, then
   opens 客户账单管理, opens the row's 查看 drawer, and marks the bill paid.

   Bills and customers have no delete path a browser script may use (the lead
   wipes them), so the created ids are printed under 'CLEANUP ids:' at the end.
   On a rerun the fixture customer and its previous-month bill already exist:
   the customer create is tolerated (any non-201 -> look it up by code), and the
   duplicate-bill response (409 per PRD, 400 on the pre-E4 service) is accepted
   and the existing bill is picked up from GET /bills?customerId=…. Mark-paid
   is therefore only asserted when the bill is still unpaid.
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
const FX = { customerCode: 'CUST-E4UI', name: 'E4 UI Fixture' };
// Previous calendar month, YYYY-MM — same default the form seeds (dayjs().subtract(1, 'month')).
const prevMonth = (() => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
})();
// Same formatting as pages/Billing/api.ts fmtMoney (en-CA, 2 dp, thousands sep).
const fmtMoney = (v) => {
  const n = Number(v ?? 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Poll an in-page predicate until true (or timeout). Replaces fixed sleeps where
    the assertion races a React re-render / an async refetch. */
const waitFor = async (page, fnSrc, arg, timeoutMs = 5000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await page.evaluate(new Function('a', fnSrc), arg)) return true;
    await wait(150);
  }
  return false;
};

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

/** Open an antd Select (identified by its Form.Item id) and click the option whose
    text contains `label`. antd 5 ignores a synthetic `mousedown` dispatched via
    dispatchEvent (the list never renders), so use a real puppeteer click; then type
    to filter (the option list is virtualised) and pick the match. */
const pickSelect = async (page, id, label) => {
  const el = await page.$(`#${id}`);
  if (!el) throw new Error(`select #${id} not found`);
  await el.click();
  await wait(400);
  await page.type(`#${id}`, label);
  await wait(500);
  await page.evaluate((lbl) => {
    const opt = [...document.querySelectorAll('.ant-select-item-option')]
      .find((o) => o.innerText.trim().includes(lbl));
    if (!opt) throw new Error(`option "${lbl}" not found`);
    opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, label);
  await wait(300);
};

/** Type a month into an antd DatePicker picker="month" (identified by its Form.Item id).
    antd does not clear on triple-click, so select-all via keyboard before typing —
    otherwise the field becomes "2026-102026-10". */
const typeMonth = async (page, id, ym) => {
  const el = await page.$(`#${id}`);
  if (!el) throw new Error(`date input #${id} not found`);
  await el.click();
  await wait(200);
  // Select-all then overwrite: antd does not clear on triple-click.
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await wait(150);
  await page.keyboard.type(ym);
  await wait(200);
  await page.keyboard.press('Enter');
  await wait(300);
};

/** Click the confirm button of an open antd Modal.confirm. antd inserts spaces
    between CJK glyphs in two-character buttons ("确 认"), so match stripped text. */
const clickModalConfirm = (page, label) => page.evaluate((lbl) => {
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const btn = [...document.querySelectorAll('.ant-modal-confirm-btns button, .ant-modal-footer button')]
    .filter(visible).find((b) => b.innerText.replace(/\s/g, '').includes(lbl));
  if (!btn) throw new Error(`modal button "${lbl}" not found`);
  btn.click();
  return true;
}, label);

/** innerText of the open drawer body (the drawer is destroyOnHidden, so an
    absent node means closed). */
const drawerText = (page) => page.evaluate(() => {
  const d = document.querySelector('.ant-drawer-open .ant-drawer-content');
  return d ? d.innerText : '';
});

(async () => {
  console.log('E4 finance UI verification against real backend…');
  console.log(`  period under test: ${prevMonth}`);

  // Real login to get a token (same creds as verify-users-ui.cjs).
  const login = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  const body = await login.json();
  if (!body.data?.accessToken) throw new Error('login failed');
  const token = body.data.accessToken;
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const api = (p, init) => fetch(`${base}/api/v1${p}`, { headers: H, ...init }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));

  // ── 0. fixture customer via API (POST; on conflict find it by code) ──
  // CustomersController.create takes { customerCode, name, … } and the list
  // rows expose it back as `customerCode` (customers.service.ts toApiRow).
  let customer = null;
  const created = await api('/customers', { method: 'POST', body: JSON.stringify({ customerCode: FX.customerCode, name: FX.name }) });
  if (created.status === 201 && created.json?.data?.id) {
    customer = created.json.data;
    console.log(`  (created fixture customer ${customer.id})`);
  } else {
    const found = await api(`/customers?keyword=${encodeURIComponent(FX.customerCode)}&pageSize=50`);
    customer = (found.json?.data ?? []).find((c) => c.customerCode === FX.customerCode || c.code === FX.customerCode) ?? null;
    if (customer) console.log(`  (fixture customer already existed: ${customer.id}; POST returned ${created.status})`);
  }
  check(`fixture customer ${FX.customerCode} available via API`, !!customer?.id);
  if (!customer?.id) throw new Error(`cannot create or find fixture customer (POST /customers -> ${created.status})`);

  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  const pageErrors = [];
  const apiCalls = [];
  // Full bill off the POST /bills/generate response: the amount and warnings
  // the drawer must echo come from here, not from a second GET.
  let generated = null;
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('response', async (r) => {
    if (!r.url().includes('/api/v1/')) return;
    const p = new URL(r.url()).pathname;
    apiCalls.push(`${r.request().method()} ${p} ${r.status()}`);
    if (r.request().method() === 'POST' && p.endsWith('/bills/generate') && r.status() === 201) {
      try { generated = (await r.json())?.data ?? null; } catch { /* non-JSON body — ignore */ }
    }
  });

  await page.evaluateOnNewDocument((t) => localStorage.setItem('wms-auth-storage', JSON.stringify({
    state: { token: t, userInfo: { id: 'seed_user_admin', name: 'System Admin', role: 'SUPER_ADMIN' }, warehouseId: null }, version: 0,
  })), token);

  await page.setViewport({ width: 1440, height: 900 });
  fs.mkdirSync(shots, { recursive: true });

  // ── 1. generate page loads against the real API ─────────────────────
  await page.goto(`${base}/fee/billing/generate`, { waitUntil: 'networkidle0', timeout: 30000 });
  await wait(1500);
  const genTitle = await page.$eval('.ant-page-header-heading-title', (el) => el.textContent.trim()).catch(() => '');
  check('generate page renders 月度账单生成 heading', genTitle.includes('月度账单生成'));
  check('GET /customers returned 200 (picker options)', apiCalls.some((c) => c.startsWith('GET /api/v1/customers 200')));
  check('GET /bills returned 200 (list under the form)', apiCalls.some((c) => c.startsWith('GET /api/v1/bills 200')));
  check('has a 生成账单 button', await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.innerText.replace(/\s/g, '').includes('生成账单'))));
  await page.screenshot({ path: path.join(shots, 'e4-finance-generate-page.png') });

  // ── 2. choose customer + previous month, submit ─────────────────────
  // Form name="gen" -> Form.Item ids gen_customerId / gen_period.
  await pickSelect(page, 'gen_customerId', FX.customerCode);
  check('fixture customer selected in picker', await page.evaluate((code) => {
    const sel = document.querySelector('#gen_customerId')?.closest('.ant-select');
    return !!sel && sel.innerText.includes(code);
  }, FX.customerCode));
  await typeMonth(page, 'gen_period', prevMonth);
  // The picker commits its value on blur/Enter asynchronously; poll rather than read once.
  check(`period input shows ${prevMonth}`, await waitFor(page, `return (document.querySelector('#gen_period') || {}).value === a`, prevMonth));
  await page.screenshot({ path: path.join(shots, 'e4-finance-generate-filled.png') });

  const beforeGen = apiCalls.length;
  await clickVisible(page, `return el.tagName === 'BUTTON' && el.innerText.replace(/\\s/g, '').includes('生成账单')`);
  await wait(3000);
  const genCalls = apiCalls.slice(beforeGen).filter((c) => c.startsWith('POST /api/v1/bills/generate'));
  const genStatus = genCalls.length ? Number(genCalls[genCalls.length - 1].split(' ').pop()) : 0;
  const genCreated = genStatus === 201;
  // Rerun: the previous-month bill already exists. PRD says 409; the service in
  // tree today raises BadRequestException (400) — accept both, as the brief's
  // intent is "duplicate -> continue with the existing bill".
  const genDuplicate = genStatus === 409 || genStatus === 400;
  check(`POST /bills/generate returned 201 (got ${genStatus || 'no call'})${genDuplicate ? ' — duplicate on rerun, continuing with the existing bill' : ''}`, genCreated || genDuplicate);

  // Resolve the bill under test: the generated one, or the existing one for this customer+period.
  let bill = genCreated ? generated : null;
  if (!bill) {
    const list = await api(`/bills?customerId=${customer.id}&period=${prevMonth}&pageSize=50`);
    bill = (list.json?.data ?? []).find((b) => b.period === prevMonth && b.customerId === customer.id) ?? null;
    if (bill) {
      const detail = await api(`/bills/${bill.id}`);
      if (detail.json?.data) bill = detail.json.data;
    }
  }
  check('bill under test resolved (id + billNo)', !!bill?.id && !!bill?.billNo);
  if (!bill?.id) throw new Error('no bill to continue with');
  const apiAmount = fmtMoney(bill.amount);
  console.log(`  bill under test: ${bill.billNo} (${bill.id}) amount=${apiAmount} isProvisional=${bill.isProvisional}`);

  if (genDuplicate) {
    check('duplicate shows the inline 账单已存在 alert (data-testid=gen-conflict)', await page.evaluate(() => !!document.querySelector('[data-testid="gen-conflict"]')));
    // No drawer opens on a duplicate; open it from the list row instead so the
    // drawer assertions below still exercise the same component.
    await wait(1200);
    await clickVisible(page, `return el.innerText.replace(/\\s/g, '') === '查看' && el.closest('tr') && el.closest('tr').innerText.includes(a)`, bill.billNo);
    await wait(1500);
  }

  // ── 3. drawer: storage waiver + amount ──────────────────────────────
  // Zero-order month: BillsService still pushes the 仓储费未计入 warning, and the
  // drawer prints warnings verbatim in <ul data-testid="bill-warnings">.
  const drawerOpen = await page.evaluate(() => !!document.querySelector('.ant-drawer-open'));
  check('bill drawer opened after generate', drawerOpen);
  const dText = await drawerText(page);
  check('drawer title shows the billNo', dText.includes(bill.billNo));
  check('drawer shows 仓储费未计入 (storage waiver printed on a zero-order month)', dText.includes('仓储费未计入'));
  check('drawer warnings list rendered (data-testid=bill-warnings)', await page.evaluate(() => !!document.querySelector('.ant-drawer-open [data-testid="bill-warnings"]')));
  const shownTotal = await page.$eval('.ant-drawer-open [data-testid="bill-total"]', (el) => el.innerText.trim()).catch(() => '');
  check(`drawer 账单合计 equals API amount (${shownTotal} vs ${apiAmount})`, shownTotal === apiAmount);
  check('drawer shows no 明细合计与账单金额不一致 mismatch alert', !dText.includes('明细合计与账单金额不一致'));
  if (Array.isArray(bill.warnings) && bill.warnings.length) {
    check(`drawer warnings header shows the API count 提示（${bill.warnings.length}）`, dText.includes(`提示（${bill.warnings.length}）`));
  }
  await page.screenshot({ path: path.join(shots, 'e4-finance-generate-drawer.png') });
  // Close via the drawer's own close button so the list page can be navigated cleanly.
  await page.evaluate(() => document.querySelector('.ant-drawer-open .ant-drawer-close')?.click());
  await wait(500);

  // ── 4. 客户账单管理: row rendered, 查看 opens the detail drawer ──────
  await page.goto(`${base}/fee/billing`, { waitUntil: 'networkidle0', timeout: 30000 });
  await wait(1500);
  const listTitle = await page.$eval('.ant-page-header-heading-title', (el) => el.textContent.trim()).catch(() => '');
  check('billing page renders 客户账单管理 heading', listTitle.includes('客户账单管理'));
  check('GET /bills returned 200 on 客户账单管理', apiCalls.some((c) => c.startsWith('GET /api/v1/bills 200')));
  // Filter by the fixture customer so the row is on the first page regardless of
  // how many real bills exist. ProTable search form: Form.Item id = customerId.
  await pickSelect(page, 'customerId', FX.customerCode);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.ant-pro-table-search button, .ant-pro-query-filter button')]
      .find((b) => b.innerText.replace(/\s/g, '').includes('查询'));
    if (btn) btn.click();
  });
  await wait(2000);
  const rowRendered = await page.evaluate((no) => [...document.querySelectorAll('tr')].some((tr) => tr.innerText.includes(no)), bill.billNo);
  check(`row for ${bill.billNo} rendered in 账单列表`, rowRendered);
  check('row shows the fixture customer code', await page.evaluate((no, code) => {
    const row = [...document.querySelectorAll('tr')].find((tr) => tr.innerText.includes(no));
    return !!row && row.innerText.includes(code);
  }, bill.billNo, FX.customerCode));
  await page.screenshot({ path: path.join(shots, 'e4-finance-list.png') });

  const beforeView = apiCalls.length;
  await clickVisible(page, `return el.innerText.replace(/\\s/g, '') === '查看' && el.closest('tr') && el.closest('tr').innerText.includes(a)`, bill.billNo);
  await wait(2000);
  // On a rerun the SPA may already hold this bill from the generate-page drawer,
  // so a fresh GET is not guaranteed; the drawer content assertion below is the
  // real check. Accept either a new 200 or a drawer already showing the bill.
  const viewFetched = apiCalls.slice(beforeView).some((c) => new RegExp(`^GET /api/v1/bills/${bill.id} (200|304)$`).test(c));
  check('查看 opened the bill (fresh GET /bills/:id or drawer already hydrated)', viewFetched || (await drawerText(page)).includes(bill.billNo));
  const vText = await drawerText(page);
  check('detail drawer opened from the list', vText.includes(bill.billNo));
  // Grouped sections: KIND_ORDER = BASE / SURCHARGE / TAX / UNPRICED, each in
  // <div data-testid="bill-group-<kind>"> with a 小计 · <label> summary row.
  // A zero-order month may legitimately have no lines (本期没有计费明细).
  const groupInfo = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.ant-drawer-open [data-testid^="bill-group-"]')].map((g) => g.getAttribute('data-testid'));
    const text = document.querySelector('.ant-drawer-open .ant-drawer-content')?.innerText ?? '';
    return { groups, empty: text.includes('本期没有计费明细'), subtotals: (text.match(/小计 · /g) ?? []).length };
  });
  const itemCount = Array.isArray(bill.items) ? bill.items.length : 0;
  check(`grouped sections render (${groupInfo.groups.length} group(s) for ${itemCount} item(s)${groupInfo.empty ? ', empty state shown' : ''})`,
    itemCount === 0 ? (groupInfo.empty && groupInfo.groups.length === 0) : (groupInfo.groups.length > 0 && groupInfo.subtotals === groupInfo.groups.length));
  check('detail drawer shows 仓储费未计入 warning', vText.includes('仓储费未计入'));
  check('detail drawer shows 事件数 (sourceEvents)', vText.includes('事件数') && vText.includes('出库') && vText.includes('入库'));
  const vTotal = await page.$eval('.ant-drawer-open [data-testid="bill-total"]', (el) => el.innerText.trim()).catch(() => '');
  check(`detail drawer 账单合计 equals API amount (${vTotal} vs ${apiAmount})`, vTotal === apiAmount);
  await page.screenshot({ path: path.join(shots, 'e4-finance-detail-drawer.png') });

  // ── 5. 标记已付 -> 确认收款 -> status tag 已结清 ───────────────────
  const alreadyPaid = bill.status === 'paid';
  if (alreadyPaid) {
    console.log('  (bill already paid from an earlier run — mark-paid step asserts the paid state only)');
    check('already-paid bill shows 已结清 in the drawer', vText.includes('已结清'));
    check('already-paid bill has no 标记已付 button', await page.evaluate(() => ![...document.querySelectorAll('.ant-drawer-open button')].some((b) => b.innerText.replace(/\s/g, '').includes('标记已付'))));
  } else {
    check('drawer has a 标记已付 button', await page.evaluate(() => [...document.querySelectorAll('.ant-drawer-open button')].some((b) => b.innerText.replace(/\s/g, '').includes('标记已付'))));
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.ant-drawer-open button')].find((x) => x.innerText.replace(/\s/g, '').includes('标记已付'));
      if (!b) throw new Error('标记已付 button not found');
      b.click();
    });
    await wait(700);
    // The page uses a declarative <Modal> (NOT the static Modal.confirm, which
    // renders nothing under antd 5 + React 19 — that was the defect this run
    // caught), so the dialog is a plain .ant-modal, not .ant-modal-confirm.
    check('confirm modal asks 标记账单 … 为已付？', await waitFor(page, `
      const m = [...document.querySelectorAll('.ant-modal')].find((x) => x.offsetWidth || x.offsetHeight);
      return !!m && m.innerText.includes('为已付') && m.innerText.includes(a);`, bill.billNo));
    await page.screenshot({ path: path.join(shots, 'e4-finance-markpaid-confirm.png') });
    const beforePay = apiCalls.length;
    await clickModalConfirm(page, '确认收款');
    await wait(2500);
    check('POST /bills/:id/mark-paid returned 201', apiCalls.slice(beforePay).some((c) => new RegExp(`^POST /api/v1/bills/${bill.id}/mark-paid 201$`).test(c)));
    check('drawer re-fetched GET /bills/:id after mark-paid', apiCalls.slice(beforePay).some((c) => new RegExp(`^GET /api/v1/bills/${bill.id} 200$`).test(c)));
    const paidText = await drawerText(page);
    check('drawer status tag now reads 已结清', paidText.includes('已结清') && !paidText.includes('待付款'));
    // antd renders bordered Descriptions as a <table>: the label is
    // .ant-descriptions-item-label (a <th>) and the value the NEXT
    // .ant-descriptions-item-content. There is no .ant-descriptions-item wrapper.
    check('drawer 已付时间 populated', await waitFor(page, `
      const cells = [...document.querySelectorAll('.ant-drawer-open .ant-descriptions-item-label')];
      const label = cells.find((x) => x.innerText.includes('已付时间'));
      if (!label) return false;
      const content = label.nextElementSibling;
      const v = (content?.innerText ?? '').trim();
      return v.length > 0 && v !== '—';`, null));
    await page.evaluate(() => document.querySelector('.ant-drawer-open .ant-drawer-close')?.click());
    await wait(1500);
    check('list row status tag reads 已结清 after reload', await page.evaluate((no) => {
      const row = [...document.querySelectorAll('tr')].find((tr) => tr.innerText.includes(no));
      return !!row && row.innerText.includes('已结清');
    }, bill.billNo));
    check('list row no longer offers 标记已付', await page.evaluate((no) => {
      const row = [...document.querySelectorAll('tr')].find((tr) => tr.innerText.includes(no));
      return !!row && !row.innerText.includes('标记已付');
    }, bill.billNo));
    // Cross-check against the API, same yardstick as the UI.
    const after = await api(`/bills/${bill.id}`);
    check('API confirms status=paid with paidAt', after.json?.data?.status === 'paid' && !!after.json?.data?.paidAt);
  }
  await page.screenshot({ path: path.join(shots, 'e4-finance-after-markpaid.png') });

  check('no page errors', pageErrors.length === 0);

  // ── network: every /api/v1 call succeeded (304 not a failure; the expected
  //    duplicate-bill response on rerun is excluded) ─────────────────────
  const failed = apiCalls.filter((c) => {
    const m = c.match(/^(\w+) (\S+) (\d{3})$/);
    if (!m) return false;
    const [, method, p, s] = m;
    const status = Number(s);
    if (status < 400) return false;
    if (genDuplicate && method === 'POST' && p.endsWith('/bills/generate') && (status === 409 || status === 400)) return false;
    return true;
  });
  check('0 failed /api/v1 requests', failed.length === 0);
  if (failed.length) console.log('  failed calls:', failed.slice(0, 5));

  await browser.close();

  // ── report created ids for the lead's wipe (no delete endpoint in scope) ──
  console.log('');
  console.log(`CLEANUP ids: bill=${bill.id} customer=${customer.id}`);

  let allOk = true;
  console.log('');
  for (const [n, ok] of checks) { console.log(`CROSS-CHECK ${n} -> ${ok ? 'PASS' : 'FAIL'}`); if (!ok) allOk = false; }
  if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 3));
  console.log(`\n${allOk ? 'ALL UI CHECKS PASSED' : 'SOME UI CHECKS FAILED'} (${checks.length} checks)`);
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('UI VERIFY ERROR:', e.message); process.exit(1); });
