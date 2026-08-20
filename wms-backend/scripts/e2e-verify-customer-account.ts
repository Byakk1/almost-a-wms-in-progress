import 'reflect-metadata';
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { CustomersService } from '../src/customers/customers.service';
import { OperationLogService } from '../src/common/operation-log.service';

// E2E verification of customer account transactions (report v4.31).
//
// CustomerTransaction has been in the schema since the initial import with NO code
// path whatsoever — no endpoint read or wrote it, and the table held zero rows. The
// 账户流水 page was therefore permanently fictional.
//
// Money-sensitive, so this runs entirely on its own fixture customer
// (CUST-ACCT-E2E); no real customer balance is ever touched.

const CUST_CODE = 'CUST-ACCT-E2E';

async function wipe(prisma: PrismaService, custId: string) {
  await prisma.customerTransaction.deleteMany({ where: { customerId: custId } });
  await prisma.operationLog.deleteMany({
    where: { entityType: 'CUSTOMER', entityId: custId },
  });
  await prisma.customer.update({ where: { id: custId }, data: { balance: 0 } });
}

async function expectErr(fn: () => Promise<any>): Promise<string | null> {
  try { await fn(); return null; } catch (e: any) { return e?.message ?? 'error'; }
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  const cust = await prisma.customer.upsert({
    where: { code: CUST_CODE }, update: {},
    create: { code: CUST_CODE, name: 'Account E2E Customer', balance: 0 },
  });
  await wipe(prisma, cust.id);

  const svc = new CustomersService(prisma, new OperationLogService(prisma));
  const checks: Array<[string, boolean]> = [];
  const push = (n: string, ok: boolean) => checks.push([n, ok]);
  const balance = async () =>
    Number((await prisma.customer.findUniqueOrThrow({ where: { id: cust.id } })).balance);

  push('fixture starts at zero balance', (await balance()) === 0);

  // ─── Top up ──────────────────────────────────────────────────────────
  const t1: any = await svc.createTransaction({
    customerId: cust.id, type: 'topup', amount: 1000, description: '银行转账充值',
  });
  push('topup: balanceBefore 0 → balanceAfter 1000', t1.balanceBefore === 0 && t1.balanceAfter === 1000);
  push('topup: customer balance actually moved', (await balance()) === 1000);

  // ─── Deduction (negative delta) ──────────────────────────────────────
  const t2: any = await svc.createTransaction({
    customerId: cust.id, type: 'deduction', amount: -250.5, description: '2 月账单扣费',
  });
  push('deduction: 1000 → 749.5', t2.balanceBefore === 1000 && t2.balanceAfter === 749.5);
  push('deduction: decimal balance persisted exactly', (await balance()) === 749.5);

  // ─── Adjustment may drive the balance negative (credit customers) ────
  const t3: any = await svc.createTransaction({
    customerId: cust.id, type: 'adjustment', amount: -800, description: '账单调整',
  });
  push('adjustment: balance may go negative for credit accounts', t3.balanceAfter === -50.5);
  push('adjustment: negative balance persisted', (await balance()) === -50.5);

  // ─── Ledger reconciles with the balance ──────────────────────────────
  const listed = await svc.listTransactions({ customerId: cust.id, pageSize: 50 });
  push('list: returns all three movements', listed.pagination.total === 3);
  const sum = listed.data.reduce((s, r) => s + r.amount, 0);
  push('list: Σ amounts equals the current balance', Math.abs(sum - (await balance())) < 1e-9);
  push('list: newest first', listed.data[0].description === '账单调整');
  push('list: customer name joined onto rows', listed.data[0].customerName === 'Account E2E Customer');

  const filtered = await svc.listTransactions({ customerId: cust.id, type: 'topup' });
  push('list: type filter works', filtered.pagination.total === 1);

  // ─── Audit ───────────────────────────────────────────────────────────
  const logs = await prisma.operationLog.findMany({
    where: { entityType: 'CUSTOMER', entityId: cust.id, action: 'ACCOUNT_TRANSACTION' },
  });
  push('audit: one row per movement (3)', logs.length === 3);
  // beforeData/afterData are String columns holding JSON (the service parses them on
  // read), so they must be parsed here rather than treated as objects.
  push('audit: preserves the before/after pair the table does not store',
    logs.every((l) => {
      if (!l.beforeData || !l.afterData) return false;
      const b = JSON.parse(l.beforeData), a = JSON.parse(l.afterData);
      return typeof b.balance === 'number' && typeof a.balance === 'number';
    }));

  // ─── Guards ──────────────────────────────────────────────────────────
  const unknown = await expectErr(() =>
    svc.createTransaction({ customerId: 'no-such-customer', type: 'topup', amount: 1 }),
  );
  push('guard: unknown customer rejected', unknown !== null);

  const balanceAfterFailure = await balance();
  push('guard: failed movement left the balance untouched', balanceAfterFailure === -50.5);

  // ─── Report ──────────────────────────────────────────────────────────
  console.log('=== sample ===');
  console.log(JSON.stringify({
    movements: listed.data.map((r) => ({ type: r.type, amount: r.amount, desc: r.description })),
    finalBalance: await balance(),
    sumOfLedger: sum,
    rejections: { unknown },
  }, null, 2));
  console.log('');

  let allOk = true;
  for (const [name, ok] of checks) {
    console.log(`CROSS-CHECK ${name} -> ${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) allOk = false;
  }

  await wipe(prisma, cust.id);
  await prisma.$disconnect();
  console.log(`\n${allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'} (${checks.length} checks)`);
  process.exit(allOk ? 0 : 1);
}

main().catch(async (e) => {
  console.error('VERIFY ERROR:', e?.message ?? e);
  process.exit(1);
});
