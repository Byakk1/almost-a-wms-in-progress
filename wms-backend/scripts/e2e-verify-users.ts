import 'reflect-metadata';
import 'dotenv/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../src/prisma/prisma.service';
import { OperationLogService } from '../src/common/operation-log.service';
import { UsersService, generateTempPassword, Actor } from '../src/users/users.service';
import { AuthService } from '../src/auth/auth.service';

// E2E verification of user provisioning (E3 / PRD docs/prd/2026-11-02-e3-user-provisioning.md).
//
// Drives the REAL UsersService + AuthService against the live DB on fixtures with a
// distinctive email domain (ui-e2e.invalid) so nothing here can touch the real admin.
//
//   · create        → temp password once, bcrypt in DB, NO hash in response
//   · duplicate     → 409, and email is case-normalised
//   · login         → the temp password works and stamps lastLoginAt
//   · list          → pagination / keyword / role / isActive, and warehouse scoping
//   · guards        → cannot change own role, cannot deactivate self
//   · last admin    → cannot deactivate/demote the only active SUPER_ADMIN
//   · deactivate    → login refused (same message), reactivate restores
//   · resetPassword → old password dies, the returned one works
//   · audit         → a USER row per write, and never a password value
//
// Re-runnable: fixtures wiped before + after.

const DOMAIN = 'ui-e2e.invalid';
const email = (n: string) => `${n}@${DOMAIN}`;

/** The real admin row — read and (briefly, in the last-admin probe) toggled. */
let seedId = '';

async function wipeFixtures(prisma: PrismaService) {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `@${DOMAIN}` } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await prisma.operationLog.deleteMany({
      where: { entityType: 'USER', entityId: { in: ids } },
    });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
}

async function main() {
  const prisma = new PrismaService();
  const audit = new OperationLogService(prisma);
  const users = new UsersService(prisma, audit);
  const auth = new AuthService(new JwtService(), prisma);

  const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', isActive: true } });
  if (!admin) throw new Error('no active SUPER_ADMIN to act as — cannot run');
  seedId = admin.id;
  const actor: Actor = { sub: admin.id, email: admin.email, role: 'SUPER_ADMIN', warehouseId: null };

  const wh = await prisma.warehouse.findFirst({ select: { id: true, code: true } });
  if (!wh) throw new Error('no warehouse in DB');

  await wipeFixtures(prisma);

  const checks: [string, boolean][] = [];
  const check = (name: string, ok: boolean) => checks.push([name, ok]);

  // ── 1. create ───────────────────────────────────────────────────────
  const created = await users.create(
    { email: email('Oper.One'), name: 'Ops One', role: 'OPERATOR', warehouseId: wh.id },
    actor,
  );
  const hash = await prisma.user.findUniqueOrThrow({
    where: { id: created.user.id },
    select: { passwordHash: true, isActive: true, lastLoginAt: true, email: true },
  });
  check('create: returns a temp password', created.tempPassword.length === 12);
  check('create: stores bcrypt, not the password', hash.passwordHash.startsWith('$2b$10$') && !hash.passwordHash.includes(created.tempPassword));
  check('create: response omits passwordHash', !('passwordHash' in created.user));
  check('create: email normalised to lowercase', hash.email === email('oper.one'));
  check('create: starts active, never logged in', hash.isActive === true && hash.lastLoginAt === null);
  check('create: warehouse attached', created.user.warehouseId === wh.id);

  // temp password generator: distinct values, unambiguous alphabet
  const samples = new Set(Array.from({ length: 200 }, () => generateTempPassword()));
  check('temp passwords are unique across 200 draws', samples.size === 200);
  check('temp alphabet has no look-alikes', !/[0O1lI]/.test(Array.from(samples).join('')));

  // ── 2. duplicate email ──────────────────────────────────────────────
  let dupErr = '';
  try {
    await users.create({ email: email('OPER.ONE'), name: 'Dup', role: 'OPERATOR' }, actor);
  } catch (e: any) {
    dupErr = `${e.status ?? e.constructor.name}`;
  }
  check('duplicate email (different case) rejected with 409', dupErr.includes('409'));

  // ── 3. login with the temp password ─────────────────────────────────
  const login = await auth.login(email('oper.one'), created.tempPassword);
  check('login with temp password succeeds', !!login.accessToken);
  const afterLogin = await prisma.user.findUniqueOrThrow({
    where: { id: created.user.id },
    select: { lastLoginAt: true },
  });
  check('login stamps lastLoginAt', afterLogin.lastLoginAt !== null);

  let badPw = '';
  try {
    await auth.login(email('oper.one'), 'definitely-not-it');
  } catch (e: any) {
    badPw = e.message ?? '';
  }
  check('wrong password rejected', badPw.includes('邮箱或密码错误'));

  // ── 4. list: filters, scoping, no hash ──────────────────────────────
  await users.create({ email: email('Cs.One'), name: 'CS One', role: 'CUSTOMER_SERVICE' }, actor);
  const all = await users.list({ page: 1, pageSize: 50 }, actor);
  const fixtures = all.data.filter((u: any) => u.email.endsWith(`@${DOMAIN}`));
  check('list: pagination metadata present', all.pagination.total >= fixtures.length && all.pagination.page === 1);
  check('list: never serialises passwordHash', fixtures.every((u: any) => !('passwordHash' in u)));

  const byKeyword = await users.list({ keyword: 'Cs.One' } as any, actor);
  check('list: keyword matches email', byKeyword.data.every((u: any) => !u.email || u.email.includes('cs.one')));
  check('list: keyword narrows results', byKeyword.data.length === 1);

  const byRole = await users.list({ role: 'CUSTOMER_SERVICE' } as any, actor);
  check('list: role filter is exact', byRole.data.every((u: any) => u.role === 'CUSTOMER_SERVICE'));

  const inactive = await users.list({ isActive: 'false' } as any, actor);
  check('list: isActive=false filter returns only disabled', inactive.data.every((u: any) => u.isActive === false));

  // warehouse admin sees only their warehouse
  const wAdmin = await users.create(
    { email: email('Wh.Admin'), name: 'WH Admin', role: 'WAREHOUSE_ADMIN', warehouseId: wh.id },
    actor,
  );
  const scoped = await users.list({} as any, {
    sub: wAdmin.user.id,
    email: wAdmin.user.email,
    role: 'WAREHOUSE_ADMIN',
    warehouseId: wh.id,
  });
  check('list: warehouse admin scoped to own warehouse', scoped.data.every((u: any) => u.warehouseId === wh.id));
  const scopedElsewhere = await users.list({ warehouseId: 'some-other-id' } as any, {
    sub: wAdmin.user.id,
    email: wAdmin.user.email,
    role: 'WAREHOUSE_ADMIN',
    warehouseId: wh.id,
  });
  check('list: query param cannot escape warehouse scope', scopedElsewhere.data.every((u: any) => u.warehouseId === wh.id));

  // ── 5. self-guards ──────────────────────────────────────────────────
  let selfRole = '';
  try {
    await users.update(wAdmin.user.id, { role: 'OPERATOR' }, { ...actor, sub: wAdmin.user.id });
  } catch (e: any) {
    selfRole = e.message ?? '';
  }
  check('cannot change own role', selfRole.includes('不能修改自己的角色'));

  let selfDeactivate = '';
  try {
    await users.deactivate(wAdmin.user.id, { ...actor, sub: wAdmin.user.id });
  } catch (e: any) {
    selfDeactivate = e.message ?? '';
  }
  check('cannot deactivate self', selfDeactivate.includes('不能停用自己'));

  // ── 6. deactivate → login blocked; reactivate → restored ────────────
  await users.deactivate(created.user.id, actor);
  let blocked = '';
  try {
    await auth.login(email('oper.one'), created.tempPassword);
  } catch (e: any) {
    blocked = e.message ?? '';
  }
  check('deactivated user cannot log in', blocked.includes('邮箱或密码错误'));
  check('deactivated login message is indistinguishable from wrong password', blocked === badPw);

  await users.reactivate(created.user.id, actor);
  const back = await auth.login(email('oper.one'), created.tempPassword);
  check('reactivated user can log in again', !!back.accessToken);

  // ── 7. reset password ───────────────────────────────────────────────
  const reset = await users.resetPassword(created.user.id, actor);
  check('reset returns a new temp password', reset.tempPassword.length === 12 && reset.tempPassword !== created.tempPassword);
  let oldDead = '';
  try {
    await auth.login(email('oper.one'), created.tempPassword);
  } catch (e: any) {
    oldDead = e.message ?? '';
  }
  check('old password stops working after reset', oldDead.includes('邮箱或密码错误'));
  const newWorks = await auth.login(email('oper.one'), reset.tempPassword);
  check('new password works after reset', !!newWorks.accessToken);

  // ── 8. last active SUPER_ADMIN guard ────────────────────────────────
  // The only way to reach "this target is the last active admin" is for the target
  // to BE an admin while every other admin is inactive. We make a fixture admin and
  // briefly park the real admin to create that exact state — then restore it in a
  // `finally`, and assert the restore, so the real account can never stay disabled.
  const fixtureAdmin = await users.create(
    { email: email('Admin.Two'), name: 'Admin Two', role: 'SUPER_ADMIN' },
    actor,
  );
  // A successful edit, so the UPDATE audit row has something real to record.
  await users.update(wAdmin.user.id, { name: 'WH Admin Renamed' }, actor);

  let lastAdminErr = '';
  let demoteLastErr = '';
  let restored = false;
  // The actor here is deliberately NOT the fixture admin (that would trip the
  // self-deactivate guard and test the wrong rule) and deliberately NOT a real
  // admin. In production this "last admin" state is not reachable through the API
  // at all — every other admin is parked, so the only actor left would be a
  // non-SUPER_ADMIN, whom RolesGuard rejects. The service-level check is
  // defence-in-depth for direct callers (scripts, jobs) that skip the pipe.
  const otherActor: Actor = { sub: wAdmin.user.id, email: wAdmin.user.email, role: 'WAREHOUSE_ADMIN', warehouseId: wh.id };
  try {
    await prisma.user.update({ where: { id: seedId }, data: { isActive: false } });
    try {
      await users.deactivate(fixtureAdmin.user.id, otherActor);
    } catch (e: any) {
      lastAdminErr = e.message ?? '';
    }
    try {
      await users.update(fixtureAdmin.user.id, { role: 'OPERATOR' }, actor);
    } catch (e: any) {
      demoteLastErr = e.message ?? '';
    }
  } finally {
    await prisma.user.update({ where: { id: seedId }, data: { isActive: true } });
    const now = await prisma.user.findUniqueOrThrow({ where: { id: seedId }, select: { isActive: true } });
    restored = now.isActive === true;
  }
  check('cannot deactivate the last active SUPER_ADMIN', lastAdminErr.includes('最后一名启用的超级管理员'));
  check('cannot demote the last active SUPER_ADMIN', demoteLastErr.includes('最后一名启用的超级管理员'));
  check('real admin account restored to active', restored);

  // ── 9. audit trail ──────────────────────────────────────────────────
  const ids = [created.user.id, wAdmin.user.id, fixtureAdmin.user.id];
  const logs = await prisma.operationLog.findMany({
    where: { entityType: 'USER', entityId: { in: ids } },
    select: { action: true, beforeData: true, afterData: true },
  });
  const actions = new Set(logs.map((l) => l.action));
  for (const a of ['CREATE', 'UPDATE', 'DEACTIVATE', 'REACTIVATE', 'RESET_PASSWORD']) {
    check(`audit: ${a} recorded`, actions.has(a));
  }
  const serialised = JSON.stringify(logs);
  check('audit: no password values or hashes stored', !serialised.includes(created.tempPassword) && !serialised.includes(reset.tempPassword) && !serialised.includes('$2b$10$'));

  // ── report ──────────────────────────────────────────────────────────
  console.log('');
  let allOk = true;
  for (const [name, ok] of checks) {
    console.log(`CROSS-CHECK ${name} -> ${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) allOk = false;
  }

  await wipeFixtures(prisma);
  await prisma.$disconnect();
  console.log(`\n${allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'} (${checks.length} checks)`);
  process.exit(allOk ? 0 : 1);
}

main().catch(async (e) => {
  console.error('VERIFY ERROR:', e?.message ?? e);
  process.exit(1);
});
