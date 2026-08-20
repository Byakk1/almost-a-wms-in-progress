/**
 * Dated document numbers (`XX-YYMMDD-NNNN`).
 *
 * The sequence is derived from the highest EXISTING number sharing today's prefix,
 * never from a row count: `count()+1` reuses a number as soon as any row is deleted,
 * which then collides with the unique constraint. v4.13 fixed `orderNo` this way;
 * these helpers exist so the remaining call sites share one implementation instead
 * of each re-deriving the slice/pad arithmetic.
 *
 * Callers need the prefix before they can query for the last number, so this is two
 * steps rather than one:
 *
 *   const prefix = dailyPrefix('IN');
 *   const last = await tx.receivingOrder.findFirst({
 *     where: { receivingNo: { startsWith: prefix } },
 *     orderBy: { receivingNo: 'desc' },
 *     select: { receivingNo: true },
 *   });
 *   const receivingNo = nextDocNo(prefix, last?.receivingNo ?? null);
 *
 * Ordering by the number string is safe because the sequence is zero-padded to a
 * fixed width, so lexical and numeric order agree.
 */

/** `CODE-YYMMDD-` for the given day (defaults to now, UTC — matching existing call sites). */
export function dailyPrefix(code: string, date: Date = new Date()): string {
  return `${code}-${date.toISOString().slice(2, 10).replace(/-/g, '')}-`;
}

/**
 * The next document number for `prefix`, following `lastNo` (pass null when no row
 * exists for today yet). `width` must match the prefix's established padding so the
 * lexical ordering that produced `lastNo` keeps holding.
 */
export function nextDocNo(prefix: string, lastNo: string | null, width = 4): string {
  const seq = lastNo ? Number(lastNo.slice(prefix.length)) + 1 : 1;
  if (!Number.isFinite(seq)) {
    throw new Error(`无法从单号解析序号: ${lastNo} (prefix ${prefix})`);
  }
  return `${prefix}${String(seq).padStart(width, '0')}`;
}

/** True when a Prisma error is a unique-constraint violation. */
export function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === 'P2002';
}
