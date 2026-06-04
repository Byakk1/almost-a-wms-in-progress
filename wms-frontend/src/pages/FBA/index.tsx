import React, { useRef } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Button, Tag, Space, Tooltip } from 'antd';
import { PlusOutlined, ExportOutlined, EyeOutlined, AmazonOutlined } from '@ant-design/icons';

interface FBAOrder {
  id: string;
  orderNo: string;
  customerName: string;
  destination: string;
  warehouse: string;  // Amazon FBA warehouse code
  totalBoxes: number;
  totalWeight: number;
  courier: string;
  status: 'DRAFT' | 'BOOKING' | 'IN_TRANSIT' | 'ARRIVED' | 'CANCELLED';
  createdAt: string;
  eta: string;
}

const FBAList: React.FC = () => {
  const actionRef = useRef<ActionType>(null);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const fetchFBAOrders = async (_params: any, _sort: any, _filter: any) => {
    await new Promise((r) => setTimeout(r, 700));

    const data: FBAOrder[] = [
      {
        id: '1', orderNo: 'FBA-260228-001', customerName: 'Global E-commerce Ltd.',
        destination: 'US - ONT8', warehouse: 'KABC1', totalBoxes: 12, totalWeight: 88.5,
        courier: 'FedEx FBA', status: 'IN_TRANSIT', createdAt: '2026-02-25 10:00', eta: '2026-03-08',
      },
      {
        id: '2', orderNo: 'FBA-260228-002', customerName: '深圳大卖贸易',
        destination: 'UK - LTN2', warehouse: 'KBRD2', totalBoxes: 5, totalWeight: 42.0,
        courier: 'DHL FBA', status: 'BOOKING', createdAt: '2026-02-27 14:20', eta: '2026-03-12',
      },
      {
        id: '3', orderNo: 'FBA-260301-001', customerName: '跨境优品',
        destination: 'DE - FRA3', warehouse: 'KFRA1', totalBoxes: 20, totalWeight: 160.0,
        courier: 'Sea + Air', status: 'DRAFT', createdAt: '2026-03-01 09:00', eta: '2026-04-01',
      },
      {
        id: '4', orderNo: 'FBA-260228-003', customerName: 'Global E-commerce Ltd.',
        destination: 'US - LAX9', warehouse: 'KLAX1', totalBoxes: 8, totalWeight: 55.5,
        courier: 'UPS FBA', status: 'ARRIVED', createdAt: '2026-02-20 08:00', eta: '2026-03-02',
      },
      {
        id: '5', orderNo: 'FBA-260215-001', customerName: '欧洲专线',
        destination: 'FR - CDG5', warehouse: 'KPAR1', totalBoxes: 3, totalWeight: 18.0,
        courier: 'EMS', status: 'CANCELLED', createdAt: '2026-02-15 16:00', eta: '-',
      },
    ];
    return { data, success: true, total: data.length };
  };

  const columns: ProColumns<FBAOrder>[] = [
    {
      title: 'FBA转运单号',
      dataIndex: 'orderNo',
      copyable: true,
      width: 160,
      render: (v) => (
        <Space>
          <AmazonOutlined style={{ color: '#FF9900' }} />
          <span className="font-mono text-sm">{v as string}</span>
        </Space>
      ),
    },
    { title: '客户名称', dataIndex: 'customerName', ellipsis: true },
    {
      title: '目的仓库',
      dataIndex: 'destination',
      width: 140,
      render: (v, record) => (
        <Tooltip title={`FBA仓: ${record.warehouse}`}>
          <Tag color="orange">{v as string}</Tag>
        </Tooltip>
      ),
    },
    { title: 'FBA仓代码', dataIndex: 'warehouse', width: 100, search: false },
    { title: '总箱数', dataIndex: 'totalBoxes', width: 80, search: false },
    {
      title: '总重量(kg)',
      dataIndex: 'totalWeight',
      width: 100,
      search: false,
      render: (v) => `${v} kg`,
    },
    { title: '物流渠道', dataIndex: 'courier', width: 120 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      valueEnum: {
        DRAFT: { text: '草稿', status: 'Default' },
        BOOKING: { text: '已订舱', status: 'Processing' },
        IN_TRANSIT: { text: '运输中', status: 'Warning' },
        ARRIVED: { text: '已到仓', status: 'Success' },
        CANCELLED: { text: '已取消', status: 'Error' },
      },
    },
    {
      title: '预计到仓',
      dataIndex: 'eta',
      width: 110,
      search: false,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 150,
      search: false,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 120,
      render: () => [
        <a key="view" className="text-primary"><EyeOutlined className="mr-1" />详情</a>,
        <a key="track" className="text-blue-500">追踪</a>,
      ],
    },
  ];

  return (
    <PageContainer
      header={{
        title: 'FBA 转运管理',
        subTitle: '管理亚马逊 FBA 头程转运订单的全链路状态',
      }}
    >
      <ProTable<FBAOrder>
        columns={columns}
        actionRef={actionRef}
        cardBordered
        request={fetchFBAOrders}
        rowKey="id"
        scroll={{ x: 1400 }}
        search={{ labelWidth: 'auto', collapsed: false }}
        pagination={{ pageSize: 10 }}
        dateFormatter="string"
        headerTitle={<Space><AmazonOutlined style={{ color: '#FF9900', fontSize: 18 }} /><span>FBA 转运单列表</span></Space>}
        toolBarRender={() => [
          <Button key="export" icon={<ExportOutlined />}>导出</Button>,
          <Button key="add" type="primary" icon={<PlusOutlined />} style={{ backgroundColor: '#D23148' }}>
            新建转运单
          </Button>,
        ]}
        rowClassName={(r) => r.status === 'CANCELLED' ? 'opacity-50' : ''}
      />
    </PageContainer>
  );
};

export default FBAList;
