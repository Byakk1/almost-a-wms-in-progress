import React, { useRef } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Button, Tag, Space, Drawer, Descriptions, Steps, Timeline } from 'antd';
import { useState } from 'react';
import { SearchOutlined, ExportOutlined, EyeOutlined } from '@ant-design/icons';

interface OrderRecord {
  id: string;
  orderNo: string;
  trackingNo: string;
  customerName: string;
  skuSummary: string;
  weight: number;
  courier: string;
  destination: string;
  status: 'PENDING' | 'PICKING' | 'PACKED' | 'SIGNED_OUT' | 'IN_TRANSIT' | 'DELIVERED' | 'EXCEPTION';
  platform: string;
  signedOutAt?: string;
  createdAt: string;
}

const OrderQuery: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [detail, setDetail] = useState<OrderRecord | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const fetchOrders = async (_p: any, _s: any, _f: any) => {
    await new Promise((r) => setTimeout(r, 700));
    const data: OrderRecord[] = [
      { id: '1', orderNo: 'ORD-260304-001', trackingNo: 'SF1234500001', customerName: '深圳大卖贸易', skuSummary: 'SKU-A001 × 2', weight: 0.85, courier: 'SF Express', destination: 'US', status: 'SIGNED_OUT', platform: 'Amazon', signedOutAt: '2026-03-04 10:30', createdAt: '2026-03-03 16:00' },
      { id: '2', orderNo: 'ORD-260304-002', trackingNo: 'JD9876500002', customerName: 'Global E-commerce', skuSummary: 'SKU-B002 × 1', weight: 1.20, courier: 'JD Logistics', destination: 'UK', status: 'PACKED', platform: 'eBay', createdAt: '2026-03-04 09:00' },
      { id: '3', orderNo: 'ORD-260304-003', trackingNo: 'YT3344400003', customerName: '跨境优品', skuSummary: 'SKU-C003 × 3', weight: 0.42, courier: 'YTO Express', destination: 'DE', status: 'IN_TRANSIT', platform: 'Shopify', signedOutAt: '2026-03-03 14:00', createdAt: '2026-03-03 08:00' },
      { id: '4', orderNo: 'ORD-260303-001', trackingNo: 'EMS9988700004', customerName: '欧洲专线', skuSummary: 'SKU-D004 × 1', weight: 2.10, courier: 'EMS', destination: 'FR', status: 'DELIVERED', platform: 'Shopify', signedOutAt: '2026-03-01 11:00', createdAt: '2026-02-28 10:00' },
      { id: '5', orderNo: 'ORD-260302-005', trackingNo: '-', customerName: '深圳大卖贸易', skuSummary: 'SKU-E005 × 1', weight: 0.65, courier: '待分配', destination: 'AU', status: 'PENDING', platform: 'Amazon', createdAt: '2026-03-02 15:30' },
      { id: '6', orderNo: 'ORD-260301-003', trackingNo: 'UPS5566000005', customerName: '跨境优品', skuSummary: 'SKU-A001 × 1', weight: 0.90, courier: 'UPS', destination: 'AU', status: 'EXCEPTION', platform: 'eBay', createdAt: '2026-03-01 09:00' },
    ];
    return { data, success: true, total: data.length };
  };

  const columns: ProColumns<OrderRecord>[] = [
    { title: '订单号', dataIndex: 'orderNo', copyable: true, width: 160, render: (v) => <span className="font-mono text-xs">{v as string}</span> },
    { title: '面单号', dataIndex: 'trackingNo', copyable: true, width: 140, render: (v) => v === '-' ? <span className="text-gray-400">-</span> : <span className="font-mono text-xs">{v as string}</span> },
    { title: '客户名称', dataIndex: 'customerName', ellipsis: true },
    { title: 'SKU概要', dataIndex: 'skuSummary', width: 130, search: false },
    { title: '重量(kg)', dataIndex: 'weight', width: 90, search: false },
    { title: '物流渠道', dataIndex: 'courier', width: 110 },
    {
      title: '目的地', dataIndex: 'destination', width: 80, search: false,
      render: (v) => <Tag color="geekblue">{v as string}</Tag>,
    },
    {
      title: '平台', dataIndex: 'platform', width: 90,
      valueEnum: { Amazon: { text: 'Amazon' }, eBay: { text: 'eBay' }, Shopify: { text: 'Shopify' } },
    },
    {
      title: '状态', dataIndex: 'status', width: 100,
      valueEnum: {
        PENDING: { text: '待处理', status: 'Default' },
        PICKING: { text: '拣货中', status: 'Processing' },
        PACKED: { text: '已打包', status: 'Warning' },
        SIGNED_OUT: { text: '已签出', status: 'Success' },
        IN_TRANSIT: { text: '运输中', status: 'Processing' },
        DELIVERED: { text: '已送达', status: 'Success' },
        EXCEPTION: { text: '异常', status: 'Error' },
      },
    },
    { title: '签出时间', dataIndex: 'signedOutAt', width: 150, search: false, render: (v) => v || '-' },
    { title: '创建时间', dataIndex: 'createdAt', width: 150, search: false },
    {
      title: '操作', valueType: 'option', width: 80,
      render: (_, record) => [
        <a key="view" className="text-primary" onClick={() => setDetail(record)}><EyeOutlined className="mr-1" />详情</a>,
      ],
    },
  ];

  return (
    <PageContainer header={{ title: '订单查询', subTitle: '全局订单搜索，支持多条件筛选与操作日志查看' }}>
      <ProTable<OrderRecord>
        columns={columns} actionRef={actionRef} cardBordered request={fetchOrders}
        rowKey="id" scroll={{ x: 1400 }} search={{ labelWidth: 'auto', collapsed: false }}
        pagination={{ pageSize: 15, showSizeChanger: true }}
        headerTitle={<Space><SearchOutlined style={{ color: '#D23148' }} /><span>订单明细</span></Space>}
        toolBarRender={() => [
          <Button key="export" icon={<ExportOutlined />}>导出订单</Button>,
        ]}
        rowClassName={(r) => r.status === 'EXCEPTION' ? 'bg-red-50' : ''}
      />

      <Drawer
        title={`订单详情 — ${detail?.orderNo}`}
        open={!!detail}
        onClose={() => setDetail(null)}
        width={520}
      >
        {detail && (
          <>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="订单号" span={2}><span className="font-mono text-xs">{detail.orderNo}</span></Descriptions.Item>
              <Descriptions.Item label="面单号">{detail.trackingNo !== '-' ? <span className="font-mono text-xs">{detail.trackingNo}</span> : '-'}</Descriptions.Item>
              <Descriptions.Item label="客户">{detail.customerName}</Descriptions.Item>
              <Descriptions.Item label="SKU">{detail.skuSummary}</Descriptions.Item>
              <Descriptions.Item label="重量">{detail.weight} kg</Descriptions.Item>
              <Descriptions.Item label="物流渠道">{detail.courier}</Descriptions.Item>
              <Descriptions.Item label="目的地"><Tag color="geekblue">{detail.destination}</Tag></Descriptions.Item>
              <Descriptions.Item label="平台">{detail.platform}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color="blue">{detail.status}</Tag></Descriptions.Item>
            </Descriptions>

            <div className="mt-4">
              <strong className="text-sm text-slate-600">物流进度</strong>
              <Steps direction="vertical" size="small" className="mt-3"
                current={['PENDING','PICKING','PACKED','SIGNED_OUT','IN_TRANSIT','DELIVERED'].indexOf(detail.status)}
                items={[
                  { title: '待处理', description: detail.createdAt },
                  { title: '拣货中' },
                  { title: '已打包' },
                  { title: '已签出', description: detail.signedOutAt },
                  { title: '运输中' },
                  { title: '已送达' },
                ]}
              />
            </div>

            <div className="mt-4">
              <strong className="text-sm text-slate-600">操作日志</strong>
              <Timeline className="mt-3" items={[
                { children: `${detail.createdAt} 系统创建订单`, color: 'gray' },
                { children: '分配拣货任务', color: 'blue' },
                { children: '打包完成', color: 'orange' },
                detail.signedOutAt ? { children: `${detail.signedOutAt} 完成签出`, color: 'green' } : null,
              ].filter(Boolean) as any[]} />
            </div>
          </>
        )}
      </Drawer>
    </PageContainer>
  );
};

export default OrderQuery;
