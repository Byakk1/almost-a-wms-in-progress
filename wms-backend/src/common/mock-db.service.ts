import { Injectable } from '@nestjs/common';

export type ApiSuccess<T> = {
  code: 0;
  message: 'success';
  data: T;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
  };
};

export type ApiError = {
  code: number;
  message: string;
  data: null;
};

export type UserRole =
  | 'SUPER_ADMIN'
  | 'WAREHOUSE_ADMIN'
  | 'OPERATOR'
  | 'CUSTOMER_SERVICE'
  | 'FINANCE'
  | 'CUSTOMER';

export type CustomerStatus = 'ACTIVE' | 'INACTIVE';

export type ReceivingStatus = 'PENDING' | 'RECEIVING' | 'COMPLETED' | 'EXCEPTION';

export interface UserRecord {
  id: string;
  email: string;
  password: string;
  name: string;
  role: UserRole;
  warehouseId: string;
}

export interface CustomerRecord {
  id: string;
  customerCode: string;
  name: string;
  contactName: string;
  phone: string;
  level: 'NORMAL' | 'VIP' | 'VVIP';
  status: CustomerStatus;
  creditLimit: number;
  balance: number;
  createdAt: string;
}

export interface ProductRecord {
  id: string;
  sku: string;
  name: string;
  customerId: string;
  customerName: string;
  unit: string;
  createdAt: string;
}

export interface InventoryRecord {
  id: string;
  sku: string;
  productName: string;
  warehouseCode: string;
  locationCode: string;
  batchNo: string;
  availableQty: number;
  frozenQty: number;
  totalQty: number;
  safetyStock: number;
  unit: string;
  lastUpdated: string;
}

export interface LocationRecord {
  id: string;
  code: string;
  row: string;
  col: number;
  floor: number;
  status: 'EMPTY' | 'OCCUPIED' | 'RESERVED' | 'DISABLED';
  sku?: string;
  qty?: number;
}

export interface ReceivingOrderRecord {
  id: string;
  receivingNo: string;
  customerName: string;
  trackingNo: string;
  expectedQuantity: number;
  actualQuantity: number;
  status: ReceivingStatus;
  createdAt: string;
}

export interface PutawayTaskRecord {
  id: string;
  taskNo: string;
  receivingNo: string;
  sku: string;
  qty: number;
  locationId?: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  createdAt: string;
}

@Injectable()
export class MockDbService {
  users: UserRecord[] = [
    {
      id: 'u-1',
      email: 'admin@wms.com',
      password: 'password',
      name: 'Admin',
      role: 'SUPER_ADMIN',
      warehouseId: 'WH-SZ-01',
    },
  ];

  refreshTokens = new Map<string, string>();

  customers: CustomerRecord[] = [
    {
      id: 'CUST-001',
      customerCode: 'CX-8001',
      name: '深圳市大卖贸易有限公司',
      contactName: '张三',
      phone: '13800138000',
      level: 'VIP',
      status: 'ACTIVE',
      creditLimit: 50000,
      balance: 15200.5,
      createdAt: '2025-10-12 10:30:00',
    },
    {
      id: 'CUST-002',
      customerCode: 'CX-8002',
      name: 'Global E-commerce Ltd.',
      contactName: 'John Doe',
      phone: '+1 555-0123',
      level: 'VVIP',
      status: 'ACTIVE',
      creditLimit: 100000,
      balance: 89000,
      createdAt: '2025-11-05 14:20:00',
    },
  ];

  products: ProductRecord[] = [
    {
      id: 'PROD-001',
      sku: 'SKU-A001',
      name: 'iPhone 15 Pro 手机壳',
      customerId: 'CUST-001',
      customerName: '深圳市大卖贸易有限公司',
      unit: '个',
      createdAt: '2026-02-01 10:00:00',
    },
    {
      id: 'PROD-002',
      sku: 'SKU-B002',
      name: '无线蓝牙耳机 AirPods 兼容款',
      customerId: 'CUST-002',
      customerName: 'Global E-commerce Ltd.',
      unit: '副',
      createdAt: '2026-02-03 16:00:00',
    },
  ];

  inventory: InventoryRecord[] = [
    {
      id: 'INV-1',
      sku: 'SKU-A001',
      productName: 'iPhone 15 Pro 手机壳',
      warehouseCode: 'WH-SZ-01',
      locationCode: 'A-01-03',
      batchNo: 'BATCH-20260228-001',
      availableQty: 142,
      frozenQty: 8,
      totalQty: 150,
      safetyStock: 50,
      unit: '个',
      lastUpdated: '2026-03-02 09:15:22',
    },
    {
      id: 'INV-2',
      sku: 'SKU-B002',
      productName: '无线蓝牙耳机 AirPods 兼容款',
      warehouseCode: 'WH-SZ-01',
      locationCode: 'B-02-01',
      batchNo: 'BATCH-20260228-002',
      availableQty: 23,
      frozenQty: 2,
      totalQty: 25,
      safetyStock: 30,
      unit: '副',
      lastUpdated: '2026-03-02 10:30:00',
    },
  ];

  locations: LocationRecord[] = [
    { id: 'LOC-1', code: 'A-01-03', row: 'A', col: 1, floor: 3, status: 'OCCUPIED', sku: 'SKU-A001', qty: 150 },
    { id: 'LOC-2', code: 'B-02-01', row: 'B', col: 2, floor: 1, status: 'OCCUPIED', sku: 'SKU-B002', qty: 25 },
    { id: 'LOC-3', code: 'C-01-01', row: 'C', col: 1, floor: 1, status: 'EMPTY' },
    { id: 'LOC-4', code: 'D-01-01', row: 'D', col: 1, floor: 1, status: 'RESERVED' },
  ];

  receivingOrders: ReceivingOrderRecord[] = [
    {
      id: 'REC-001',
      receivingNo: 'IN-260228-0001',
      customerName: '深圳市大卖贸易有限公司',
      trackingNo: 'SF1234567890123',
      expectedQuantity: 50,
      actualQuantity: 50,
      status: 'COMPLETED',
      createdAt: '2026-02-28 09:30:00',
    },
    {
      id: 'REC-002',
      receivingNo: 'IN-260228-0002',
      customerName: 'Global E-commerce Ltd.',
      trackingNo: 'JD9876543210987',
      expectedQuantity: 120,
      actualQuantity: 45,
      status: 'RECEIVING',
      createdAt: '2026-02-28 11:15:00',
    },
  ];

  putawayTasks: PutawayTaskRecord[] = [
    {
      id: 'PT-1',
      taskNo: 'PT-260228-001',
      receivingNo: 'IN-260228-0002',
      sku: 'SKU-B002',
      qty: 30,
      status: 'PENDING',
      createdAt: '2026-02-28 12:00:00',
    },
  ];
}