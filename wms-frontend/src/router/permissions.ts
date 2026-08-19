// Client-side RBAC matrix — a UX MIRROR of the backend @Roles decorators.
// The REAL enforcement is the backend global RolesGuard (wms-backend/src/app.module.ts);
// hiding a menu item or button here is convenience/clarity, NOT a security boundary.
//
// Keep in sync with the @Roles(...) on the backing controllers:
//   routePermissions  → each page's list/GET controller roles
//   actionPermissions → the stricter write-endpoint roles
import { useAuthStore } from '../store/auth';
import type { RouteConfig } from './routes';

export type Role =
  | 'SUPER_ADMIN'
  | 'WAREHOUSE_ADMIN'
  | 'OPERATOR'
  | 'CUSTOMER_SERVICE'
  | 'FINANCE'
  | 'CUSTOMER';

export const ALL_ROLES: Role[] = [
  'SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE', 'FINANCE', 'CUSTOMER',
];

// Readability bundles
const ADMIN: Role[] = ['SUPER_ADMIN', 'WAREHOUSE_ADMIN'];
const OPS: Role[] = ['SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR'];
const OPS_CS: Role[] = ['SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE'];

// Leaf path → roles allowed to SEE the page (mirrors the backing controller's list/GET @Roles).
// A path NOT listed is visible to all authenticated roles.
export const routePermissions: Record<string, Role[]> = {
  '/dashboard': ['SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE', 'FINANCE'], // dashboard.controller (no CUSTOMER)
  // 基础档案
  '/customer/list': ['SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'CUSTOMER_SERVICE', 'FINANCE'], // customers.controller
  '/customer/account-flow': ['SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'CUSTOMER_SERVICE', 'FINANCE'],
  '/customer/credit-apply': ['SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'CUSTOMER_SERVICE', 'FINANCE'],
  '/product/manage': OPS_CS, // products.controller
  // 入库
  '/inbound/receiving': OPS_CS, // receiving-orders.controller
  '/inbound/receiving/add': OPS,
  '/inbound/putaway': OPS, // putaway-tasks
  '/inbound/putaway/diff': OPS,
  '/inbound/claim': OPS_CS,
  // 出库
  '/outbound/picking': OPS_CS, // outbound-orders.controller (list)
  '/outbound/wave': OPS_CS, // waves.controller (list)
  '/outbound/packing': OPS,
  '/outbound/shipment/main': OPS_CS,
  '/outbound/signout': OPS,
  '/outbound/exception': OPS_CS, // outbound-exceptions
  // 库内
  '/warehouse/inventory': OPS_CS, // inventory.controller (list)
  '/warehouse/inventory/check': OPS,
  '/warehouse/inventory/transactions': OPS_CS, // audit inventory-transactions
  '/warehouse/location': OPS, // locations.controller (list)
  '/warehouse/barcode': OPS,
  '/warehouse/material': OPS,
  // 中转
  '/transit/list': OPS_CS, // transit-orders.controller (list)
  '/transit/signout': OPS,
  '/transit/box-measure': OPS,
  // 单据
  '/document/order/query': OPS_CS,
  '/document/intercept': ['SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'CUSTOMER_SERVICE'],
  '/document/return': ['SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'CUSTOMER_SERVICE'],
  // FBA 中转
  '/fba/orders': OPS_CS,
  '/fba/transfer/receiving': OPS,
  '/fba/transfer/signout': OPS,
  // 异常
  '/exception/center': OPS_CS, // exception-case.controller (list)
  // 财务（CUSTOMER 可见账单 / 试算）
  '/fee/calculator': ALL_ROLES, // fee.controller (all roles)
  '/fee/billing': ['SUPER_ADMIN', 'FINANCE', 'CUSTOMER_SERVICE', 'CUSTOMER'], // bills.controller (list)
  '/fee/billing/generate': ['SUPER_ADMIN', 'FINANCE', 'CUSTOMER_SERVICE'], // bills generate
  // 系统设置（管理员）
  '/settings/basic': ADMIN,
  '/settings/audit-log': ADMIN, // audit operations
  '/settings/dictionary': ADMIN, // dictionary.controller
};

// Capability key → roles (mirrors the stricter backend WRITE endpoints).
export const actionPermissions: Record<string, Role[]> = {
  'outbound.create': ['SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'CUSTOMER_SERVICE'], // outbound-orders POST
  'outbound.bulkImport': ['SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'CUSTOMER_SERVICE'], // bulk-import POST
  'dictionary.write': ADMIN, // dictionary create/update/delete
  'bill.generate': ['SUPER_ADMIN', 'FINANCE', 'CUSTOMER_SERVICE'], // bills/generate
  'location.write': ADMIN, // locations create/update/delete
  'product.write': OPS, // products create/update
  'product.delete': ADMIN,
  'wave.manage': OPS, // wave create/release/complete/cancel
  'box.measure': OPS, // boxes/:boxNo/measure PUT
  'box.signOut': OPS, // boxes/sign-out POST
  'transit.receive': OPS, // transit-orders/:id/receive PUT
  'transit.ship': OPS, // transit-orders/:id/ship PUT
  'inventory.adjust': OPS, // inventory/adjust
  'customer.write': ['SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'CUSTOMER_SERVICE'],
};

export function hasRole(allowed: Role[] | undefined, role: string | null | undefined): boolean {
  if (!allowed) return true; // unlisted ⇒ open to all authenticated users
  if (!role) return false;
  return allowed.includes(role as Role);
}

export function canAccessPath(path: string, role: string | null | undefined): boolean {
  return hasRole(routePermissions[path], role);
}

export function canDoAction(actionKey: string, role: string | null | undefined): boolean {
  return hasRole(actionPermissions[actionKey], role);
}

// Recursively drop menu entries the role can't see; prune parent groups left empty.
export function filterMenuByRole(routes: RouteConfig[], role: string | null | undefined): RouteConfig[] {
  const out: RouteConfig[] = [];
  for (const r of routes) {
    if (r.routes && r.routes.length) {
      const kids = filterMenuByRole(r.routes, role);
      if (kids.length) out.push({ ...r, routes: kids });
    } else if (canAccessPath(r.path, role)) {
      out.push(r);
    }
  }
  return out;
}

// First navigable leaf path in a (already role-filtered) menu tree — used as a landing fallback.
export function firstLeafPath(routes: RouteConfig[]): string | undefined {
  for (const r of routes) {
    if (r.routes && r.routes.length) {
      const found = firstLeafPath(r.routes);
      if (found) return found;
    } else if (r.path && !r.hideInMenu) {
      return r.path;
    }
  }
  return undefined;
}

// ── hooks ──
export function useRole(): string | undefined {
  return useAuthStore((s) => s.userInfo?.role);
}

export function useCan(check?: Role[] | string): boolean {
  const role = useRole();
  if (check === undefined) return true;
  if (Array.isArray(check)) return hasRole(check, role);
  return canDoAction(check, role);
}
