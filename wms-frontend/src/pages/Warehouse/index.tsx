import React, { useRef } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Button, Tag, Space, Progress, Tooltip } from 'antd';
import {
  SearchOutlined, ExportOutlined, EnvironmentOutlined,
  WarningOutlined
} from '@ant-design/icons';

interface InventoryItem {
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

const InventoryQuery: React.FC = () => {
  const actionRef = useRef<ActionType>(null);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const fetchInventory = async (params: any, _sort: any, _filter: any) => {
    console.log('Fetching inventory:', params);
    await new Promise((r) => setTimeout(r, 700));

    const data: InventoryItem[] = [
      {
        id: '1', sku: 'SKU-A001', productName: 'iPhone 15 Pro 手机壳',
        warehouseCode: 'WH-SZ-01', locationCode: 'A-01-03',
        batchNo: 'BATCH-20260228-001',
        availableQty: 142, frozenQty: 8, totalQty: 150,
        safetyStock: 50, unit: '个', lastUpdated: '2026-03-02 09:15:22',
      },
      {
        id: '2', sku: 'SKU-B002', productName: '无线蓝牙耳机 AirPods 兼容款',
        warehouseCode: 'WH-SZ-01', locationCode: 'B-02-01',
        batchNo: 'BATCH-20260228-002',
        availableQty: 23, frozenQty: 2, totalQty: 25,
        safetyStock: 30, unit: '副', lastUpdated: '2026-03-02 10:30:00',
      },
      {
        id: '3', sku: 'SKU-C003', productName: 'USB-C 快充线 1m',
        warehouseCode: 'WH-SZ-01', locationCode: 'A-03-06',
        batchNo: 'BATCH-20260301-001',
        availableQty: 388, frozenQty: 12, totalQty: 400,
        safetyStock: 100, unit: '条', lastUpdated: '2026-03-02 11:00:15',
      },
      {
        id: '4', sku: 'SKU-D004', productName: '手机支架 金属折叠款',
        warehouseCode: 'WH-SZ-01', locationCode: 'C-01-02',
        batchNo: 'BATCH-20260225-003',
        availableQty: 5, frozenQty: 0, totalQty: 5,
        safetyStock: 20, unit: '个', lastUpdated: '2026-03-01 16:45:00',
      },
      {
        id: '5', sku: 'SKU-E005', productName: '硅胶保护套 iPad Pro',
        warehouseCode: 'WH-SZ-01', locationCode: 'B-04-05',
        batchNo: 'BATCH-20260301-002',
        availableQty: 78, frozenQty: 22, totalQty: 100,
        safetyStock: 30, unit: '个', lastUpdated: '2026-03-02 08:00:00',
      },
      {
        id: '6', sku: 'SKU-F006', productName: '屏幕钢化玻璃膜 iPhone 15',
        warehouseCode: 'WH-SZ-02', locationCode: 'A-02-01',
        batchNo: 'BATCH-20260302-001',
        availableQty: 0, frozenQty: 30, totalQty: 30,
        safetyStock: 50, unit: '片', lastUpdated: '2026-03-02 13:00:00',
      },
    ];

    const filtered = params.sku
      ? data.filter((d) => d.sku.toLowerCase().includes(params.sku.toLowerCase()))
      : data;

    return { data: filtered, success: true, total: filtered.length };
  };

  const columns: ProColumns<InventoryItem>[] = [
    {
      title: 'SKU',
      dataIndex: 'sku',
      copyable: true,
      width: 120,
      fixed: 'left',
    },
    {
      title: '商品名称',
      dataIndex: 'productName',
      ellipsis: true,
      width: 200,
    },
    {
      title: '仓库',
      dataIndex: 'warehouseCode',
      width: 110,
      valueEnum: {
        'WH-SZ-01': { text: '深圳主仓' },
        'WH-SZ-02': { text: '深圳备仓' },
      },
    },
    {
      title: '库位',
      dataIndex: 'locationCode',
      width: 110,
      search: false,
      render: (v) => (
        <Tag icon={<EnvironmentOutlined />} color="geekblue">{v as string}</Tag>
      ),
    },
    {
      title: '批次号',
      dataIndex: 'batchNo',
      width: 170,
      search: false,
      ellipsis: true,
    },
    {
      title: '可用库存',
      dataIndex: 'availableQty',
      width: 100,
      search: false,
      sorter: true,
      render: (v, record) => {
        const low = (v as number) < record.safetyStock;
        return (
          <Space>
            <span className={`font-bold text-base ${low ? 'text-red-500' : 'text-green-600'}`}>
              {v as number}
            </span>
            {low && (
              <Tooltip title={`低于安全库存 ${record.safetyStock} ${record.unit}`}>
                <WarningOutlined className="text-red-400" />
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: '冻结库存',
      dataIndex: 'frozenQty',
      width: 90,
      search: false,
      render: (v) => <span className="text-orange-500">{v as number}</span>,
    },
    {
      title: '总库存',
      dataIndex: 'totalQty',
      width: 90,
      search: false,
    },
    {
      title: '库存水位',
      dataIndex: 'availableQty',
      key: 'stockLevel',
      width: 130,
      search: false,
      render: (_, record) => {
        const percent = record.safetyStock > 0
          ? Math.min(100, Math.round((record.availableQty / (record.safetyStock * 2)) * 100))
          : 100;
        const color = record.availableQty === 0 ? '#ef4444'
          : record.availableQty < record.safetyStock ? '#f97316'
          : '#10b981';
        return (
          <Tooltip title={`安全库存: ${record.safetyStock} ${record.unit}`}>
            <Progress
              percent={percent}
              size="small"
              strokeColor={color}
              showInfo={false}
            />
          </Tooltip>
        );
      },
    },
    {
      title: '单位',
      dataIndex: 'unit',
      width: 60,
      search: false,
    },
    {
      title: '最后更新',
      dataIndex: 'lastUpdated',
      width: 160,
      search: false,
      valueType: 'dateTime',
    },
  ];

  return (
    <PageContainer
      header={{
        title: '实时库存查询',
        subTitle: '查询各仓库 SKU 的当前可用库存、冻结量与库位信息',
      }}
    >
      <ProTable<InventoryItem>
        columns={columns}
        actionRef={actionRef}
        cardBordered
        request={fetchInventory}
        rowKey="id"
        scroll={{ x: 1300 }}
        search={{
          labelWidth: 'auto',
          collapsed: false,
        }}
        pagination={{
          pageSize: 15,
          showSizeChanger: true,
        }}
        dateFormatter="string"
        headerTitle={
          <Space>
            <SearchOutlined style={{ color: '#D23148' }} />
            <span>库存明细</span>
          </Space>
        }
        toolBarRender={() => [
          <Button key="export" icon={<ExportOutlined />}>
            导出 Excel
          </Button>,
        ]}
        rowClassName={(record) =>
          record.availableQty === 0
            ? 'bg-red-50'
            : record.availableQty < record.safetyStock
            ? 'bg-orange-50'
            : ''
        }
        summary={(pageData) => {
          const totalAvail = pageData.reduce((sum, r) => sum + r.availableQty, 0);
          const totalFrozen = pageData.reduce((sum, r) => sum + r.frozenQty, 0);
          const totalAll = pageData.reduce((sum, r) => sum + r.totalQty, 0);
          return (
            <tr className="bg-slate-50 font-bold">
              <td colSpan={5} className="px-4 py-2 text-right text-slate-600">合计：</td>
              <td className="px-4 py-2 text-green-600">{totalAvail}</td>
              <td className="px-4 py-2 text-orange-500">{totalFrozen}</td>
              <td className="px-4 py-2">{totalAll}</td>
              <td colSpan={4} />
            </tr>
          );
        }}
      />
    </PageContainer>
  );
};

export default InventoryQuery;
