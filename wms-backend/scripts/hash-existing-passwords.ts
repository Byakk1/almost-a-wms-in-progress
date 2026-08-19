/**
 * One-time migration: hash any User.passwordHash rows still stored in cleartext.
 *
 * Background: despite the column name, AuthService compared passwords with `!==`
 * and wrote them verbatim, so every existing row holds a plaintext password. The
 * service now uses bcrypt with no plaintext fallback, so those rows must be
 * converted or nobody can log in.
 *
 * Idempotent: rows already holding a bcrypt digest are skipped, so this is safe to
 * re-run (and safe to run against a database someone else has already migrated).
 *
 *   npx ts-node scripts/hash-existing-passwords.ts          # report only
 *   npx ts-node scripts/hash-existing-passwords.ts --commit # apply
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 10;

// bcrypt digests are always "$2<variant>$<cost>$<22-char salt><31-char hash>".
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const commit = process.argv.includes('--commit');
  const users = await prisma.user.findMany({
    select: { id: true, email: true, passwordHash: true },
  });

  const plaintext = users.filter((u) => !BCRYPT_RE.test(u.passwordHash));
  const already = users.length - plaintext.length;

  console.log(`users: ${users.length} | already hashed: ${already} | cleartext: ${plaintext.length}`);
  for (const u of plaintext) {
    console.log(`  ${commit ? 'HASHING' : 'would hash'} ${u.email} (len ${u.passwordHash.length})`);
  }

  if (!plaintext.length) {
    console.log('nothing to do.');
    return;
  }
  if (!commit) {
    console.log('\ndry run — re-run with --commit to apply.');
    return;
  }

  for (const u of plaintext) {
    await prisma.user.update({
      where: { id: u.id },
      data: { passwordHash: await bcrypt.hash(u.passwordHash, BCRYPT_ROUNDS) },
    });
  }

  // Verify every row now round-trips, so a partial run cannot pass silently.
  const after = await prisma.user.findMany({ select: { email: true, passwordHash: true } });
  const bad = after.filter((u) => !BCRYPT_RE.test(u.passwordHash));
  console.log(`\ndone. hashed ${plaintext.length}; rows still cleartext: ${bad.length}`);
  if (bad.length) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('ERROR', e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
