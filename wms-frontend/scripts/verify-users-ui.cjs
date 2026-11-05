/* Browser verification of /settings/users against the REAL backend.
   Creates a throwaway user through the actual UI, asserts the one-time password
   modal, then deactivates it. Cleans up its own fixture at the end.
   Not part of the committed contract suite — a one-off E3 acceptance probe. */
const puppeteer = require('puppeteer-core');
const fs = require('node:fs');
const path = require('node:path');

const base = 'http://127.0.0.1:5173';
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
// Credentials come from the environment only — this repository is public.
const adminEmail = process.env.WMS_ADMIN_EMAIL || 'admin@convex-wms.local';
const adminPassword = process.env.WMS_ADMIN_PASSWORD;
if (!adminPassword) throw new Error('set WMS_ADMIN_PASSWORD (the admin login) before running');
const artifacts = path.resolve(__dirname, '../../.superpowers/console-qa');
// Unique per run so a crashed previous run can never turn create into a 409.
const RUN = Date.now().toString(36);
const FIXTURE = { email: `ui.users.probe.${RUN}@ui-e2e.invalid`, name: 'UI Users Probe', role: 'OPERATOR' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const checks = [];
const check = (n, ok) => { checks.push([n, ok]); console.log(`  · ${n} -> ${ok ? 'PASS' : 'FAIL'}`); };

/** Click the first VISIBLE element matching a predicate. antd renders duplicate
    copies of rows when a column is `fixed: 'right'`, and the hidden copy is not clickable. */
const clickVisible = (page, predSrc, arg) => page.evaluate((src, a) => {
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const pred = new Function('el', 'a', src);
  const el = [...document.querySelectorAll('a, button')].filter(visible).find((n) => pred(n, a));
  if (!el) throw new Error('no visible element matched');
  el.click();
  return true;
}, predSrc, arg);

(async () => {
  console.log('users UI verification against real backend…');
  // real login to get a token
  const login = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  const body = await login.json();
  if (!body.data?.accessToken) throw new Error('login failed');
  const token = body.data.accessToken;
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // Pre-clean: deactivate any probe rows a crashed earlier run left behind. The
  // API has no delete (by design — audit integrity), so stale probes are parked,
  // not removed; the backend E2E suite's wipe handles true deletion.
  const stale = await (await fetch(`${base}/api/v1/users?keyword=ui.users.probe&pageSize=50`, { headers: H })).json();
  for (const u of stale.data ?? []) {
    if (u.isActive) await fetch(`${base}/api/v1/users/${u.id}/deactivate`, { method: 'POST', headers: H });
  }
  if ((stale.data ?? []).length) console.log(`  (parked ${stale.data.length} stale probe row(s))`);

  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage();
  const pageErrors = [];
  const apiCalls = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('response', (r) => { if (r.url().includes('/api/v1/')) apiCalls.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });

  await page.evaluateOnNewDocument((t) => localStorage.setItem('wms-auth-storage', JSON.stringify({
    state: { token: t, userInfo: { id: 'seed_user_admin', name: 'System Admin', role: 'SUPER_ADMIN' }, warehouseId: null }, version: 0,
  })), token);

  await page.setViewport({ width: 1440, height: 900 });
  fs.mkdirSync(artifacts, { recursive: true });

  // ── 1. page loads, real GET /users ──────────────────────────────────
  await page.goto(`${base}/settings/users`, { waitUntil: 'networkidle0', timeout: 30000 });
  await wait(1500);
  const title = await page.$eval('.ant-page-header-heading-title', (el) => el.textContent.trim()).catch(() => '');
  check('page renders 用户管理 heading', title.includes('用户管理'));
  check('GET /users returned 200', apiCalls.some((c) => c.startsWith('GET /api/v1/users 200')));
  const adminRow = await page.evaluate(() => document.body.innerText.includes('admin@convex-wms.local'));
  check('existing admin listed', adminRow);
  check('has a create button', await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.innerText.includes('新建用户'))));

  // ── 2. open create modal ────────────────────────────────────────────
  await clickVisible(page, `return el.innerText.includes('新建用户')`);
  await wait(700);
  check('create modal opens', await page.evaluate(() => document.body.innerText.includes('新建用户')
    && document.body.innerText.includes('密码由系统生成')));
  await page.screenshot({ path: path.join(artifacts, 'users-create-modal.png') });

  // ── 3. validation: empty submit must not silently fail ──────────────
  const before = apiCalls.length;
  await page.evaluate(() => [...document.querySelectorAll('.ant-modal-footer button')].find((b) => /创建|保存/.test(b.innerText)).click());
  await wait(600);
  check('empty submit blocked by validation (no POST sent)', !apiCalls.slice(before).some((c) => c.startsWith('POST /api/v1/users')));
  check('validation message shown', await page.evaluate(() => document.body.innerText.includes('请输入邮箱')));

  // ── 4. fill + submit ────────────────────────────────────────────────
  const inputs = await page.$$('.ant-modal input');
  // order: email, name, role(select input), warehouse(select input)
  await inputs[0].type(FIXTURE.email);
  await inputs[1].type(FIXTURE.name);
  // role select
  await page.evaluate(() => {
    const sel = document.querySelectorAll('.ant-modal .ant-select-selector')[0];
    sel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await wait(500);
  await page.evaluate(() => {
    const opt = [...document.querySelectorAll('.ant-select-item-option')].find((o) => o.innerText.includes('仓库操作员'));
    if (opt) opt.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await wait(400);
  check('role option selected', await page.evaluate(() => !!document.querySelector('.ant-modal .ant-select-selection-item')));

  await page.evaluate(() => [...document.querySelectorAll('.ant-modal-footer button')].find((b) => /创建|保存/.test(b.innerText)).click());
  await wait(2000);
  check('POST /users returned 201', apiCalls.some((c) => c.startsWith('POST /api/v1/users 201')));

  // ── 5. one-time password modal ──────────────────────────────────────
  const modalText = await page.evaluate(() => document.body.innerText);
  check('temp-password modal shown', modalText.includes('此临时密码仅显示一次'));
  check('fixture email shown in modal', modalText.includes(FIXTURE.email));
  const tempPw = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.ant-typography')].find((e) => /^[A-Za-z2-9]{12}$/.test(e.innerText.trim()));
    return el ? el.innerText.trim() : '';
  });
  check('a 12-char temp password is displayed', tempPw.length === 12);
  check('displayed password has no look-alike chars', tempPw.length === 12 && !/[0O1lI]/.test(tempPw));
  await page.screenshot({ path: path.join(artifacts, 'users-temp-password.png') });

  await page.evaluate(() => [...document.querySelectorAll('.ant-modal-footer button')].find((b) => b.innerText.includes('我已保存')).click());
  await wait(1200);
  check('modal dismissed, password no longer readable', !(await page.evaluate(() => document.body.innerText)).includes(tempPw));

  // ── 6. the new user really exists and can log in ────────────────────
  const newLogin = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: FIXTURE.email, password: tempPw }),
  });
  check('created user can log in with the displayed password', newLogin.status === 201);

  // ── 7. list refreshes and shows the new row ─────────────────────────
  await page.reload({ waitUntil: 'networkidle0' });
  await wait(1500);
  check('new user appears in the list', await page.evaluate((e) => document.body.innerText.includes(e), FIXTURE.email));

  // ── 8. deactivate through the UI ────────────────────────────────────
  await clickVisible(page, `return el.innerText.trim() === '停用' && el.closest('tr') && el.closest('tr').innerText.includes(a)`, FIXTURE.email);
  await wait(700);
  await page.evaluate(() => {
    const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    // antd inserts full-width spaces between CJK glyphs in buttons ("停 用"),
    // so match on the stripped text.
    const btn = [...document.querySelectorAll('.ant-popconfirm button, .ant-popover button')]
      .filter(visible).find((b) => b.innerText.replace(/\s/g, '').includes('停用'));
    if (!btn) throw new Error('popconfirm confirm button not found');
    btn.click();
  });
  await wait(1800);
  check('POST deactivate returned 201', apiCalls.some((c) => c.includes('/deactivate 201')));
  const blocked = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: FIXTURE.email, password: tempPw }),
  });
  check('deactivated user can no longer log in', blocked.status === 401);

  await page.screenshot({ path: path.join(artifacts, 'users-after-deactivate.png') });
  check('no page errors', pageErrors.length === 0);

  // ── cleanup: remove the fixture row via the API ─────────────────────
  await browser.close();

  let allOk = true;
  console.log('');
  for (const [n, ok] of checks) { console.log(`CROSS-CHECK ${n} -> ${ok ? 'PASS' : 'FAIL'}`); if (!ok) allOk = false; }
  if (pageErrors.length) console.log('pageErrors:', pageErrors.slice(0, 3));
  console.log(`\n${allOk ? 'ALL UI CHECKS PASSED' : 'SOME UI CHECKS FAILED'} (${checks.length} checks)`);
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('UI VERIFY ERROR:', e.message); process.exit(1); });
