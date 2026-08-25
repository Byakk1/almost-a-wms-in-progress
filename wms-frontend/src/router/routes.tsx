import React from 'react';
import { 
  UserOutlined,
  UploadOutlined,
  RocketOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  CalculatorOutlined,
  AmazonOutlined,
  SwapOutlined,
  SettingOutlined,
  ShoppingOutlined,
  FileTextOutlined,
  WarningOutlined,
} from '@ant-design/icons';

// Pages
import Dashboard from '../pages/Dashboard';
import CustomerList from '../pages/Customer';
import ReceivingList from '../pages/Inbound';
import ReceivingWorkbench from '../pages/Inbound/Receiving';
import PickingList from '../pages/Outbound';
import PackingWorkbench from '../pages/Outbound/Packing';
import PutawayWorkbench from '../pages/Inbound/Putaway';
import InventoryQuery from '../pages/Warehouse';
import LocationMap from '../pages/Warehouse/Location';
import FeeCalculator from '../pages/Fee';
import FBAList from '../pages/FBA';
import BillingDashboard from '../pages/Billing';
import TransitList from '../pages/Transit';
import OutboundException from '../pages/Outbound/Exception';
import SystemSettings from '../pages/Settings';
import OrderSignout from '../pages/Outbound/Signout';
import ShipmentMain from '../pages/Outbound/Shipment';
import WaveManagement from '../pages/Outbound/Wave';
import OrderQuery from '../pages/Document';
import ProductManage from '../pages/Product';
import AccountFlow from '../pages/Customer/AccountFlow';
import CreditApply from '../pages/Customer/CreditApply';
import ClaimManage from '../pages/Inbound/Claim';
import TransitSignout from '../pages/Transit/Signout';
import BoxMeasure from '../pages/Transit/BoxMeasure';

import MaterialPackaging from '../pages/Warehouse/Material';
import InterceptManage from '../pages/Document/Intercept';
import ReturnManage from '../pages/Document/Return';
import FirstMileReceiving from '../pages/FBA/Transfer/FirstMileReceiving';
import FirstMileSignout from '../pages/FBA/Transfer/FirstMileSignout';
import BarcodeGenerator from '../pages/Warehouse/Barcode';
import PutawayDiff from '../pages/Inbound/PutawayDiff';
import InventoryCheck from '../pages/Warehouse/InventoryCheck';
import BillingGeneration from '../pages/Fee/BillingGen';
import ExceptionCenter from '../pages/Exception';
import AuditLog from '../pages/Settings/AuditLog';
import InventoryFlow from '../pages/Warehouse/InventoryFlow';
import DictionaryManage from '../pages/Settings/Dictionary';
import RateCardManage from '../pages/Settings/RateCard';

export interface RouteConfig {
  path: string;
  name: string;
  element?: React.ReactNode;
  icon?: React.ReactNode;
  hideInMenu?: boolean;
  routes?: RouteConfig[]; // Used to construct ProLayout menu
}

// Map literal routes to components for rendering in Tabs
export const routeElements: Record<string, React.ReactNode> = {
  '/dashboard': <Dashboard />,
  '/customer/list': <CustomerList />,
  '/customer/account-flow': <AccountFlow />,
  '/customer/credit-apply': <CreditApply />,
  '/inbound/receiving': <ReceivingList />,
  '/inbound/receiving/add': <ReceivingWorkbench />,
  '/inbound/putaway': <PutawayWorkbench />,
  '/inbound/putaway/diff': <PutawayDiff />,
  '/inbound/claim': <ClaimManage />,
  '/outbound/picking': <PickingList />,
  '/outbound/wave': <WaveManagement />,
  '/outbound/packing': <PackingWorkbench />,
  '/outbound/shipment/main': <ShipmentMain />,
  '/outbound/signout': <OrderSignout />,
  '/outbound/exception': <OutboundException />,
  '/warehouse/inventory': <InventoryQuery />,
  '/warehouse/inventory/check': <InventoryCheck />,
  '/warehouse/location': <LocationMap />,
  '/warehouse/barcode': <BarcodeGenerator />,
  '/warehouse/material': <MaterialPackaging />,
  '/transit/list': <TransitList />,
  '/transit/signout': <TransitSignout />,
  '/transit/box-measure': <BoxMeasure />,
  '/document/order/query': <OrderQuery />,
  '/document/intercept': <InterceptManage />,
  '/document/return': <ReturnManage />,
  '/fba/orders': <FBAList />,
  '/fba/transfer/receiving': <FirstMileReceiving />,
  '/fba/transfer/signout': <FirstMileSignout />,
  '/product/manage': <ProductManage />,
  '/fee/calculator': <FeeCalculator />,
  '/fee/billing': <BillingDashboard />,
  '/fee/billing/generate': <BillingGeneration />,
  '/settings/basic': <SystemSettings />,
  '/settings/audit-log': <AuditLog />,
  '/settings/dictionary': <DictionaryManage />,
  '/settings/rate-cards': <RateCardManage />,
  '/exception/center': <ExceptionCenter />,
  '/warehouse/inventory/transactions': <InventoryFlow />,
};

// Menu structure definition (3 levels)
export const menuRoutes: RouteConfig[] = [
  {
    path: '/dashboard',
    name: '仪表盘',
    icon: <DashboardOutlined />,
  },
  {
    path: '/base',
    name: '基础档案',
    icon: <DatabaseOutlined />,
    routes: [
      {
        path: '/base/customer',
        name: '客户管理',
        icon: <UserOutlined />,
        routes: [
          { path: '/customer/list', name: '客户列表' },
          { path: '/customer/account-flow', name: '账户流水' },
          { path: '/customer/credit-apply', name: '额度申请' },
        ],
      },
      {
        path: '/base/product',
        name: '产品管理',
        icon: <ShoppingOutlined />,
        routes: [
          { path: '/product/manage', name: '产品管理' },
        ],
      },
    ],
  },
  {
    path: '/biz',
    name: '仓储业务',
    icon: <RocketOutlined />,
    routes: [
      {
        path: '/biz/inbound',
        name: '入库管理',
        icon: <UploadOutlined />,
        routes: [
          { path: '/inbound/receiving', name: '收货管理' },
          { path: '/inbound/receiving/add', name: '收货操作台', hideInMenu: true },
          { path: '/inbound/putaway', name: '上架管理' },
          { path: '/inbound/putaway/diff', name: '上架差异' },
          { path: '/inbound/claim', name: '认领管理' },
        ],
      },
      {
        path: '/biz/outbound',
        name: '出库管理',
        icon: <RocketOutlined />,
        routes: [
          { path: '/outbound/picking', name: '拣货管理' },
          { path: '/outbound/wave', name: '波次管理' },
          { path: '/outbound/packing', name: '按单打包台', hideInMenu: true },
          { path: '/outbound/shipment/main', name: '出货总单' },
          { path: '/outbound/signout', name: '订单签出' },
          { path: '/outbound/exception', name: '出货问题件' },
        ],
      },
      {
        path: '/biz/warehouse',
        name: '库内管理',
        icon: <DatabaseOutlined />,
        routes: [
          { path: '/warehouse/inventory', name: '库存查询' },
          { path: '/warehouse/inventory/check', name: '盘点作业' },
          { path: '/warehouse/inventory/transactions', name: '库存流水' },
          { path: '/warehouse/location', name: '库位大屏' },
          { path: '/warehouse/barcode', name: '条码生成' },
          { path: '/warehouse/material', name: '包材管理' },
        ],
      },
      {
        path: '/biz/transit',
        name: '中转管理',
        icon: <SwapOutlined />,
        routes: [
          { path: '/transit/list', name: '中转单列表' },
          { path: '/transit/signout', name: '按单签出' },
          { path: '/transit/box-measure', name: '箱子测量' },
        ],
      },
      {
        path: '/biz/document',
        name: '单据管理',
        icon: <FileTextOutlined />,
        routes: [
          { path: '/document/order/query', name: '订单查询' },
          { path: '/document/intercept', name: '拦截管理' },
          { path: '/document/return', name: '退仓管理' },
        ],
      },
      {
        path: '/biz/fba',
        name: 'FBA中转',
        icon: <AmazonOutlined />,
        routes: [
          { path: '/fba/orders', name: 'FBA补单明细' },
          { path: '/fba/transfer/receiving', name: '头程收货台' },
          { path: '/fba/transfer/signout', name: '头程签出台' },
        ],
      },
      {
        path: '/biz/exception',
        name: '异常管理',
        icon: <WarningOutlined />,
        routes: [
          { path: '/exception/center', name: '异常中心' },
        ],
      },
    ],
  },
  {
    path: '/finance',
    name: '财务结算',
    icon: <CalculatorOutlined />,
    routes: [
      {
        path: '/finance/fee',
        name: '费用管理',
        icon: <CalculatorOutlined />,
        routes: [
          { path: '/fee/calculator', name: '运费试算' },
          { path: '/fee/billing', name: '客户账单管理' },
          { path: '/fee/billing/generate', name: '月度账单生成' },
        ],
      },
    ],
  },
  {
    path: '/sys',
    name: '系统设置',
    icon: <SettingOutlined />,
    routes: [
      {
        path: '/sys/settings',
        name: '系统管理',
        icon: <SettingOutlined />,
        routes: [
          { path: '/settings/basic', name: '基础配置' },
          { path: '/settings/audit-log', name: '操作日志' },
          { path: '/settings/dictionary', name: '数据字典' },
          { path: '/settings/rate-cards', name: '价卡管理' },
        ],
      },
    ],
  },
];

// Helper to find a flat route name by path (used for Tab title)
export const findRouteNameByPath = (path: string, routes: RouteConfig[] = menuRoutes): string => {
  for (const route of routes) {
    if (route.path === path) return route.name;
    if (route.routes) {
      const found = findRouteNameByPath(path, route.routes);
      if (found) return found;
    }
  }
  return '';
};
