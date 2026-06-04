import React, { useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Space, Button, Tag, Drawer, Descriptions, Timeline } from 'antd';
import { ExportOutlined, EyeOutlined } from '@ant-design/icons';

interface FbaOrder {
  id: string;
  orderNo: string;
  customerName: string;
  fbaCode: string; // Destination FBA Warehouse
  skuCount: number;
  totalPieces: number;
  weight: number;
  status: 'PENDING' | 'PICKING' | 'BOXING' | 'SIGNED_OUT';
  createdAt: string;
}

const FbaOrderList: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [detail, setDetail] = useState<FbaOrder | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const fetchOrders = async (_params: any, _sort: any, _filter: any) => {
    await new Promise((r) => setTimeout(r, 600));
    const data: FbaOrder[] = [
      { id: '1', orderNo: 'FBAO-260305-001', customerName: '深圳大卖贸易', fbaCode: 'ONT8', skuCount: 3, totalPieces: 1500, weight: 320.5, status: 'SIGNED_OUT', createdAt: '2026-03-05 09:00' },
      { id: '2', orderNo: 'FBAO-260304-002', customerName: '跨境优品', fbaCode: 'LGB8', skuCount: 1, totalPieces: 500, weight: 110.0, status: 'BOXING', createdAt: '2026-03-04 14:30' },
      { id: '3', orderNo: 'FBAO-260304-003', customerName: 'Global E-commerce', fbaCode: 'FTW1', skuCount: 12, totalPieces: 2400, weight: 550.0, status: 'PICKING', createdAt: '2026-03-04 16:00' },
      { id: '4', orderNo: 'FBAO-260305-004', customerName: '欧洲专线', fbaCode: 'XUK5', skuCount: 5, totalPieces: 850, weight: 180.2, status: 'PENDING', createdAt: '2026-03-05 10:15' },
    ];
    return { data, success: true, total: data.length };
  };

  const columns: ProColumns<FbaOrder>[] = [
    { title: 'FBA订单号', dataIndex: 'orderNo', copyable: true, width: 160 },
    { title: '客户名称', dataIndex: 'customerName', ellipsis: true },
    {
      title: '目的仓', dataIndex: 'fbaCode', width: 100,
      render: (v) => <Tag color="warning" className="font-mono">{v as string}</Tag>,
    },
    { title: 'SKU种数', dataIndex: 'skuCount', width: 90, search: false },
    { title: '总件数', dataIndex: 'totalPieces', width: 90, search: false },
    { title: '预估重量(kg)', dataIndex: 'weight', width: 110, search: false },
    {
      title: '状态', dataIndex: 'status', width: 110,
      valueEnum: {
        PENDING: { text: '待处理', status: 'Default' },
        PICKING: { text: '拣货中', status: 'Processing' },
        BOXING: { text: '装箱中', status: 'Warning' },
        SIGNED_OUT: { text: '已发头程', status: 'Success' },
      },
    },
    { title: '创建时间', dataIndex: 'createdAt', width: 150, search: false },
    {
      title: '操作', valueType: 'option', width: 90,
      render: (_, record) => [
        <a key="view" className="text-primary" onClick={() => setDetail(record)}><EyeOutlined className="mr-1" />详情</a>,
      ],
    },
  ];

  return (
    <PageContainer header={{ title: 'FBA订单列表', subTitle: '客户下达给海外仓的 FBA 补货订单' }}>
      <ProTable<FbaOrder>
        columns={columns} actionRef={actionRef} cardBordered request={fetchOrders}
        rowKey="id" search={{ labelWidth: 'auto', collapsed: false }} pagination={{ pageSize: 15 }}
        headerTitle={<Space><span>FBA补单明细</span></Space>}
        toolBarRender={() => [<Button key="export" icon={<ExportOutlined />}>导出订单</Button>]}
      />

      <Drawer
        title={`订单详情 — ${detail?.orderNo}`}
        open={!!detail}
        onClose={() => setDetail(null)}
        width={480}
      >
        {detail && (
          <>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="订单号" span={2}><span className="font-mono">{detail.orderNo}</span></Descriptions.Item>
              <Descriptions.Item label="客户">{detail.customerName}</Descriptions.Item>
              <Descriptions.Item label="目的仓"><Tag color="warning">{detail.fbaCode}</Tag></Descriptions.Item>
              <Descriptions.Item label="SKU种数">{detail.skuCount}</Descriptions.Item>
              <Descriptions.Item label="总件数">{detail.totalPieces}</Descriptions.Item>
              <Descriptions.Item label="重量">{detail.weight} kg</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color="blue">{detail.status}</Tag></Descriptions.Item>
            </Descriptions>
            
            <div className="mt-5">
              <strong className="text-sm text-slate-600 block mb-3">操作进度</strong>
              <Timeline items={[
                { children: `${detail.createdAt} 订单创建`, color: 'gray' },
                ['PICKING', 'BOXING', 'SIGNED_OUT'].includes(detail.status) ? { children: '分配拣货任务，开始拣货', color: 'blue' } : null,
                ['BOXING', 'SIGNED_OUT'].includes(detail.status) ? { children: '打包完毕，装入FBA外箱，贴标', color: 'orange' } : null,
                detail.status === 'SIGNED_OUT' ? { children: '交付头程物流，订单签出', color: 'green' } : null,
              ].filter(Boolean) as any[]} />
            </div>
          </>
        )}
      </Drawer>
    </PageContainer>
  );
};

export default FbaOrderList;
