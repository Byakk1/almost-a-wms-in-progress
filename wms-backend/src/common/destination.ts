/**
 * Destination normalisation for tax resolution (E4, PRD §5.2 / §10 decisions 1–3).
 *
 * Deliberately PURE — no Prisma, no Nest, no I/O — so every distinct value the
 * live DB holds can be pinned by a table-driven check that needs no database
 * (`scripts/e2e-verify-charges.ts`).
 *
 * ── Why a normaliser at all ──────────────────────────────────────────
 *
 * `OutboundOrder.recipientProvince` is free text: the same province arrives as
 * `ON` and `Ontario`, `QC` and `Quebec`, `BC` and `British Columbia`. The
 * `TaxRate` table is keyed on the canonical code, so a lookup on the raw string
 * would miss roughly half the Canadian orders — and silently tax them at 0%,
 * which is the exact failure this layer exists to prevent.
 *
 * ── Output contract ──────────────────────────────────────────────────
 *
 *   CA      → { countryCode: 'CA', jurisdiction: <province code> }
 *   non-CA  → { countryCode: <CC>, jurisdiction: <CC> }   (the EXPORT row key)
 *   unknown → { countryCode: null, jurisdiction: null }   (caller: warn + provisional)
 *
 * Non-CA destinations are 0% export services under decision 2, so the state /
 * region of an AU / NZ / US order is irrelevant to tax — the jurisdiction is the
 * country itself. Only Canada needs the province, because only Canada has
 * place-of-supply rates that differ by province.
 */

export interface Destination {
  countryCode: string | null;
  jurisdiction: string | null;
}

const UNRESOLVED: Destination = { countryCode: null, jurisdiction: null };

/** Case / whitespace / diacritic-insensitive key for table lookups. */
const key = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();

// ─── Canada: every province and territory, by code and by full name ──
// Keys are already in `key()` form. 'PEI' is a common informal code.
const CA_PROVINCES: Record<string, string> = {
  AB: 'AB', ALBERTA: 'AB',
  BC: 'BC', 'BRITISH COLUMBIA': 'BC',
  MB: 'MB', MANITOBA: 'MB',
  NB: 'NB', 'NEW BRUNSWICK': 'NB',
  NL: 'NL', 'NEWFOUNDLAND AND LABRADOR': 'NL', NEWFOUNDLAND: 'NL',
  NS: 'NS', 'NOVA SCOTIA': 'NS',
  NT: 'NT', 'NORTHWEST TERRITORIES': 'NT',
  NU: 'NU', NUNAVUT: 'NU',
  ON: 'ON', ONTARIO: 'ON',
  PE: 'PE', PEI: 'PE', 'PRINCE EDWARD ISLAND': 'PE',
  QC: 'QC', QUEBEC: 'QC', // 'Québec' folds to QUEBEC via key()
  SK: 'SK', SASKATCHEWAN: 'SK',
  YT: 'YT', YUKON: 'YT',
};

// ─── Countries: ISO 3166-1 alpha-2 codes plus the names seen in data ──
// A destination whose country is not in this table is UNRESOLVED, never
// guessed: an unknown country must surface as a warning, not as a 0% line.
const COUNTRIES: Record<string, string> = {
  CA: 'CA', CANADA: 'CA',
  AU: 'AU', AUSTRALIA: 'AU',
  NZ: 'NZ', 'NEW ZEALAND': 'NZ',
  US: 'US', USA: 'US', 'UNITED STATES': 'US', 'UNITED STATES OF AMERICA': 'US',
  GB: 'GB', UK: 'GB', 'UNITED KINGDOM': 'GB',
  CN: 'CN', CHINA: 'CN',
  HK: 'HK', 'HONG KONG': 'HK',
  JP: 'JP', JAPAN: 'JP',
  SG: 'SG', SINGAPORE: 'SG',
  DE: 'DE', GERMANY: 'DE',
  FR: 'FR', FRANCE: 'FR',
  MX: 'MX', MEXICO: 'MX',
};

/** ISO country code for a raw country string, or null when unknown. */
export function normalizeCountry(country: string | null | undefined): string | null {
  if (!country) return null;
  return COUNTRIES[key(country)] ?? null;
}

/** Canonical CA province code for a raw province string, or null when unknown. */
export function normalizeCaProvince(region: string | null | undefined): string | null {
  if (!region) return null;
  return CA_PROVINCES[key(region)] ?? null;
}

/**
 * Resolve an order's ship-to (country, province/state) into the `TaxRate` key.
 *
 * A Canadian order whose province cannot be resolved returns BOTH fields null,
 * not `{ CA, null }`: a half-resolved destination has no usable tax row, and
 * returning the country alone would tempt a caller into a national fallback
 * rate that does not exist in Canadian law.
 */
export function normalizeDestination(
  country: string | null | undefined,
  region: string | null | undefined,
): Destination {
  const countryCode = normalizeCountry(country);
  if (!countryCode) return UNRESOLVED;

  if (countryCode === 'CA') {
    const province = normalizeCaProvince(region);
    return province ? { countryCode, jurisdiction: province } : UNRESOLVED;
  }

  // Non-CA: the EXPORT row is keyed on the country itself (decision 2).
  return { countryCode, jurisdiction: countryCode };
}

/**
 * Resolve a warehouse's location from its structured address.
 *
 * `Warehouse.address` for the real sites is slash-delimited:
 * `CC/REGION/City//Street///Postcode`, e.g. `CA/BC/Richmond//Dock3 ...///V7A 4X1`
 * or `AU/NSW/Villawood//...`. The first two segments are the country and region;
 * everything after is irrelevant to tax. Free-text addresses (E2E fixtures,
 * 'localhost', Chinese placeholders) do not match the shape and resolve to nulls,
 * which the caller treats as a warning + provisional, same as an order.
 */
export function parseWarehouseAddress(address: string | null | undefined): Destination {
  if (!address) return UNRESOLVED;
  const parts = address.split('/');
  if (parts.length < 2) return UNRESOLVED;
  const [country, region] = parts;
  // Only the strict two-letter prefix is accepted here: a free-text address
  // beginning with a word that happens to be a country NAME is not structured.
  if (!/^[A-Za-z]{2}$/.test(country.trim())) return UNRESOLVED;
  return normalizeDestination(country, region);
}
