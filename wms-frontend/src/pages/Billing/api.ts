// Typed request helpers for /bills, shared by 客户账单管理 (pages/Billing) and
// 月度账单生成 (pages/Fee/BillingGen). Mirrors the E4 contract (PRD §5.2):
// every list call returns the standard ok(data, pagination) envelope, which
// utils/request.ts already unwraps to { code, data, pagination }.
//
// Keep the shapes here in sync with bills.service.ts — they are the only place
// the finance screens learn what a bill looks like, so a field renamed on the
// server shows up as a tsc error rather than an empty column.
import request from '../../utils/request';

export type BillStatus = 'unpaid' | 'paid';

// kind=null is a pre-E4 row; the UI treats it as BASE (PRD §5.1).
export type BillItemKind = 'BASE' | 'SURCHARGE' | 'TAX' | 'UNPRICED' | null;

export interface BillItem {
  id: string;
  feeType: string;
  description: string;
  qty: number | string;
  unitPrice: number | string;
  totalAmount: number | string;
  kind: BillItemKind;
  isProvisional: boolean;
}

export interface Bill {
  id: string;
  billNo: string;
  customerId: string;
  customer?: { code: string; name: string } | null;
  period: string; // 'YYYY-MM'
  amount: number | string; // Prisma Decimal serialises as a string
  status: BillStatus;
  dueDate: string | null;
  paidAt: string | null;
  isProvisional: boolean;
  warnings: string[] | null;
  taxRegistrationNo: string | null;
  finalizedAt: string | null;
  createdAt: string;
  items?: BillItem[];
}

export interface SourceEvents { outboundOrders: number; receivingOrders: number }

export interface BillDetail extends Bill {
  items: BillItem[];
  sourceEvents?: SourceEvents;
}

export interface GeneratedBill extends BillDetail {
  balanceBefore: number;
  balanceAfter: number;
  warnings: string[];
}

export interface Pagination { page: number; pageSize: number; total: number }

export interface ListEnvelope<T> { code: number; data: T[]; pagination?: Pagination }
export interface OneEnvelope<T> { code: number; data: T }

export interface ListBillsParams {
  customerId?: string;
  period?: string;
  status?: BillStatus;
  isProvisional?: boolean;
  page?: number;
  pageSize?: number;
}

export interface Actual { code: string; amount: number }

export type ConfirmationCode = 'EXPORT_ZERO_RATED' | 'TAX_REVIEW_ACCEPTED';

export interface CustomerOption { id: string; code: string; name: string }

// Finalize confirmation checkboxes appear ONLY when the matching warning text is
// present — the API refuses a confirmation nothing asked for, and showing a box
// the user cannot act on would invite blind ticking.
export const CONFIRMATION_TRIGGERS: { code: ConfirmationCode; needle: string; label: string }[] = [
  { code: 'EXPORT_ZERO_RATED', needle: '出口零税率', label: '已复核出口零税率（EXPORT_ZERO_RATED）' },
  { code: 'TAX_REVIEW_ACCEPTED', needle: '无法识别', label: '已确认目的地省份无法识别、该单按未计税处理（TAX_REVIEW_ACCEPTED）' },
];

export const toNum = (v: number | string | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// Two-decimal money text with thousands separators; no currency sign — the bill
// does not carry one (it inherits the rate card's).
export const fmtMoney = (v: number | string | null | undefined): string =>
  toNum(v).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtDay = (v: string | null | undefined): string => (v ? String(v).slice(0, 10) : '—');
export const fmtTime = (v: string | null | undefined): string =>
  (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—');

export const STATUS_LABEL: Record<BillStatus, string> = { unpaid: '待付款', paid: '已结清' };
export const STATUS_COLOR: Record<BillStatus, string> = { unpaid: 'warning', paid: 'success' };

export const KIND_LABEL: Record<Exclude<BillItemKind, null>, string> = {
  BASE: '基础费用',
  SURCHARGE: '附加费',
  TAX: '税费',
  UNPRICED: '待人工核价',
};
export const KIND_ORDER: Exclude<BillItemKind, null>[] = ['BASE', 'SURCHARGE', 'TAX', 'UNPRICED'];

export const normalizeKind = (k: BillItemKind): Exclude<BillItemKind, null> => k ?? 'BASE';

// ── calls ──────────────────────────────────────────────────────────────

export async function listBills(params: ListBillsParams): Promise<ListEnvelope<Bill>> {
  return request.get('/bills', { params }) as unknown as Promise<ListEnvelope<Bill>>;
}

export async function getBill(id: string): Promise<OneEnvelope<BillDetail>> {
  return request.get(`/bills/${id}`) as unknown as Promise<OneEnvelope<BillDetail>>;
}

export async function generateBill(body: {
  customerId: string;
  period: string;
  actuals?: Actual[];
}): Promise<OneEnvelope<GeneratedBill>> {
  return request.post('/bills/generate', body) as unknown as Promise<OneEnvelope<GeneratedBill>>;
}

export async function finalizeBill(id: string, body: {
  actuals?: Actual[];
  confirmations?: ConfirmationCode[];
}): Promise<OneEnvelope<BillDetail>> {
  return request.post(`/bills/${id}/finalize`, body) as unknown as Promise<OneEnvelope<BillDetail>>;
}

export async function markBillPaid(id: string): Promise<OneEnvelope<Bill>> {
  return request.post(`/bills/${id}/mark-paid`, {}) as unknown as Promise<OneEnvelope<Bill>>;
}

// GET /customers → ok(data[], pagination); the same pageSize=200 the other
// pickers (RateCard/Detail, Fee, AccountFlow) use.
export async function listCustomerOptions(): Promise<CustomerOption[]> {
  const res = await (request.get('/customers', { params: { pageSize: 200 } }) as unknown as Promise<ListEnvelope<any>>);
  // The customers API serialises the DB `code` column as `customerCode`
  // (CustomersService.toApiRow). Reading `c.code` here rendered every picker
  // option as name-only — caught by the E4 browser verification, not by tsc.
  return (res?.data ?? []).map((c: any) => ({ id: c.id, code: c.customerCode ?? c.code ?? '', name: c.name ?? '' }));
}

// The axios interceptor already toasts HTTP errors; this extracts the server's
// own message (e.g. 409 账单已存在) for the places that want to show it inline.
export const errMsg = (e: any, fallback = '操作失败'): string =>
  e?.response?.data?.message || e?.message || fallback;

export const httpStatus = (e: any): number | undefined => e?.response?.status;
