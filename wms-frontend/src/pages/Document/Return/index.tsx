import React, { useRef } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Space, Button } from 'antd';
import { ExportOutlined, EyeOutlined } from '@ant-design/icons';

interface ReturnItem {
  id: string;
  returnNo: string;
  originalOrder: string;
  customerName: string;
  carrier: string;
  trackingNo: string;
  reason: string;
  status: 'EXPECTED' | 'RECEIVED' | 'PROCESSED';
  createdAt: string;
}

const ReturnManage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const fetchReturns = async (_p: any) => {
    await new Promise((r) => setTimeout(r, 600));
    const data: ReturnItem[] = [
      { id: '1', returnNo: 'RTN-260305-001', originalOrder: 'ORD-251210-991', customerName: '深圳大卖贸易', carrier: 'USPS', trackingNo: 'US991188331', reason: '地址不详，退单', status: 'RECEIVED', createdAt: '2026-03-05 08:30' },
      { id: '2', returnNo: 'RTN-260304-002', originalOrder: 'ORD-260115-442', customerName: '跨境优品', carrier: 'FedEx', trackingNo: 'FX88442299', reason: '买家拒签', status: 'EXPECTED', createdAt: '2026-03-04 11:00' },
      { id: '3', returnNo: 'RTN-260301-001', originalOrder: 'ORD-260205-010', customerName: 'Global E-commerce', carrier: 'Royal Mail', trackingNo: 'RM001122UK', reason: '物流商拦截退回', status: 'PROCESSED', createdAt: '2026-03-01 15:45' },
    ];
    return { data, success: true, total: data.length };
  };

  const columns: ProColumns<ReturnItem>[] = [
    { title: '退单号', dataIndex: 'returnNo', copyable: true, width: 140 },
    { title: '原订单号', dataIndex: 'originalOrder', copyable: true, width: 150 },
    { title: '客户', dataIndex: 'customerName', ellipsis: true },
    { title: '退货承运商', dataIndex: 'carrier', width: 110, search: false },
    { title: '退回单号', dataIndex: 'trackingNo', width: 140 },
    { title: '退货原因', dataIndex: 'reason', ellipsis: true, search: false },
    {
      title: '状态', dataIndex: 'status', width: 100,
      valueEnum: {
        EXPECTED: { text: '预报中', status: 'Processing' },
        RECEIVED: { text: '已收到', status: 'Warning' },
        PROCESSED: { text: '处理完毕', status: 'Success' },
      },
    },
    { title: '发起时间', dataIndex: 'createdAt', width: 150, search: false },
    {
      title: '操作', valueType: 'option', width: 90,
      render: () => [
        <a key="view" className="text-primary"><EyeOutlined className="mr-1" />详情</a>,
      ],
    },
  ];

  return (
    <PageContainer header={{ title: '退仓管理', subTitle: '管理尾款未能妥投而被物流商退回仓库的订单包裹' }}>
      <ProTable<ReturnItem>
        columns={columns} actionRef={actionRef} cardBordered request={fetchReturns}
        rowKey="id" search={{ labelWidth: 'auto', collapsed: false }} pagination={{ pageSize: 15 }}
        headerTitle={<Space><span>退件包裹管理</span></Space>}
        toolBarRender={() => [<Button key="export" icon={<ExportOutlined />}>导出数据</Button>]}
      />
    </PageContainer>
  );
};

export default ReturnManage;
