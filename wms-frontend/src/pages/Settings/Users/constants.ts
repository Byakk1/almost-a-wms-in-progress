// Labels for Prisma `enum Role`. Mirrors wms-backend/src/users/dto/user.dto.ts USER_ROLES — keep in sync.

export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: '超级管理员',
  WAREHOUSE_ADMIN: '仓库管理员',
  OPERATOR: '仓库操作员',
  CUSTOMER_SERVICE: '客服',
  FINANCE: '财务',
  CUSTOMER: '客户',
};

export const ROLE_COLOR: Record<string, string> = {
  SUPER_ADMIN: 'red',
  WAREHOUSE_ADMIN: 'volcano',
  OPERATOR: 'blue',
  CUSTOMER_SERVICE: 'cyan',
  FINANCE: 'gold',
  CUSTOMER: 'default',
};

export const ROLE_OPTIONS = Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }));
