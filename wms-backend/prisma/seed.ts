/**
 * Prisma v7 note:
 * this project currently uses SQL seed script via `prisma/seed.sql`.
 * Keep this file TypeScript-compile safe so Nest build/start is not blocked.
 */
async function main() {
  console.log(
    'Use SQL seed instead: npx prisma db execute --file prisma/seed.sql',
  );
}

main().catch((e) => {
  console.error('Seed helper failed:', e);
  process.exit(1);
});