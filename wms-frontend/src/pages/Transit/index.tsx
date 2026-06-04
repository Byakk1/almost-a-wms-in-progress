import React, { useRef } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Button, Space, Steps, Card, Tooltip } from 'antd';
import { PlusOutlined, ExportOutlined, EyeOutlined, SwapOutlined } from '@ant-design/icons';
import request from '../../utils/request';

type TransitStatus = 'PENDING' | 'RECEIVED' | 'SHIPPED';

interface TransitOrderRow {
  id: string;
  orderNo: string;
  customerName: string;
  totalItems: number;
  status: TransitStatus;
  trackingNo: string | null;
  createdAt: string;
}

const STATUS_STEPS: TransitStatus[] = ['PENDING', 'RECEIVED', 'SHIPPED'];
const STATUS_LABELS: Record<TransitStatus, string> = {
  PENDING: '待收货',
  RECEIVED: '已收货',
  SHIPPED: '已发出',
};

const TransitList: React.FC = () => {
  const actionRef = useRef<ActionType>(null);

  const fetchTransit = async (params: any) => {
    const { current, pageSize, ...rest } = params || {};
    // Transit controller wraps {data, pagination} inside ok(), so the envelope is res.data.{data, pagination}.
    // (Inbound/Outbound use ok(rows, pagination) which flattens; transit is the odd one out.)
    const res: any = await request.get('/transit-orders', {
      params: { page: current, pageSize, ...rest },
    });
    return {
      data: res?.data?.data ?? [],
      success: true,
      total: res?.data?.pagination?.total ?? 0,
    };
  };

  const columns: ProColumns<TransitOrderRow>[] = [
    {
      title: '中转单号',
      dataIndex: 'orderNo',
      copyable: true,
      width: 180,
      render: (v) => <span className="font-mono text-sm">{v as string}</span>,
    },
    { title: '客户名称', dataIndex: 'customerName', ellipsis: true },
    {
      title: 'SKU件数',
      dataIndex: 'totalItems',
      width: 100,
      search: false,
    },
    {
      title: '物流单号',
      dataIndex: 'trackingNo',
      width: 160,
      render: (v) => (v ? <span className="font-mono text-sm">{v as string}</span> : <span className="text-text-muted">—</span>),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      valueEnum: {
        PENDING:  { text: '待收货', status: 'Default' },
        RECEIVED: { text: '已收货', status: 'Processing' },
        SHIPPED:  { text: '已发出', status: 'Success' },
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 160,
      search: false,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 140,
      render: () => [
        // Receive (PUT /:id/receive, body: {items:[]}) and Ship (PUT /:id/ship, body: {trackingNo})
        // both need data input — they live on the BoxMeasure / Signout sub-pages, not the list.
        <a key="view" className="text-primary"><EyeOutlined className="mr-1" />详情</a>,
      ],
    },
  ];

  return (
    <PageContainer
      header={{
        title: '中转管理',
        subTitle: '管理中转单据：到货 → 收货 → 出库发运',
      }}
    >
      <Card size="small" className="mb-4 shadow-sm">
        <Steps
          size="small"
          current={STATUS_STEPS.length - 1}
          items={STATUS_STEPS.map((s) => ({ title: STATUS_LABELS[s] }))}
        />
      </Card>

      <ProTable<TransitOrderRow>
        columns={columns}
        actionRef={actionRef}
        cardBordered
        request={fetchTransit}
        rowKey="id"
        scroll={{ x: 1100 }}
        search={{ labelWidth: 'auto', collapsed: false }}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        dateFormatter="string"
        headerTitle={<Space><SwapOutlined style={{ color: '#D23148' }} /><span>中转单列表</span></Space>}
        toolBarRender={() => [
          <Button key="export" icon={<ExportOutlined />} disabled>导出</Button>,
          <Tooltip key="add" title="待后端 POST /transit-orders 端点上线">
            <Button icon={<PlusOutlined />} disabled>新建中转单</Button>
          </Tooltip>,
        ]}
      />
    </PageContainer>
  );
};

export default TransitList;
