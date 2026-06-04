import React, { useRef } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Button, Tag, Space, Alert } from 'antd';
import { ExportOutlined, EyeOutlined, WarningOutlined, CheckCircleOutlined } from '@ant-design/icons';

interface ExceptionItem {
  id: string;
  orderNo: string;
  trackingNo: string;
  customerName: string;
  exceptionType: 'LOST' | 'DAMAGED' | 'MISMATCH' | 'DELAY' | 'RETURN';
  description: string;
  amount: number;
  status: 'OPEN' | 'PROCESSING' | 'RESOLVED' | 'CLOSED';
  reportedAt: string;
  resolvedAt?: string;
}

const OutboundException: React.FC = () => {
  const actionRef = useRef<ActionType>(null);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const fetchExceptions = async (_params: any, _sort: any, _filter: any) => {
    await new Promise((r) => setTimeout(r, 600));
    const data: ExceptionItem[] = [
      {
        id: '1', orderNo: 'ORD-260220-001', trackingNo: 'SF1234500001', customerName: '深圳大卖贸易',
        exceptionType: 'DAMAGED', description: '包裹外箱严重破损，内部商品受损 2 件',
        amount: 560, status: 'PROCESSING', reportedAt: '2026-02-22 10:30',
      },
      {
        id: '2', orderNo: 'ORD-260215-003', trackingNo: 'JD9876500002', customerName: 'Global E-commerce Ltd.',
        exceptionType: 'LOST', description: '承运商确认包裹丢失，已申请理赔',
        amount: 1200, status: 'OPEN', reportedAt: '2026-02-20 14:00',
      },
      {
        id: '3', orderNo: 'ORD-260210-002', trackingNo: 'YT3344400003', customerName: '跨境优品',
        exceptionType: 'MISMATCH', description: '到仓扫描 SKU 与订单不匹配，多出 SKU-A001 × 3',
        amount: 0, status: 'RESOLVED', reportedAt: '2026-02-12 09:15', resolvedAt: '2026-02-14 16:00',
      },
      {
        id: '4', orderNo: 'ORD-260228-005', trackingNo: 'EMS9988700004', customerName: '欧洲专线',
        exceptionType: 'RETURN', description: '收件方拒签，包裹已退回仓库',
        amount: 320, status: 'OPEN', reportedAt: '2026-03-01 08:00',
      },
      {
        id: '5', orderNo: 'ORD-260201-001', trackingNo: 'UPS5566000005', customerName: '深圳大卖贸易',
        exceptionType: 'DELAY', description: '因港口拥堵延误发货，预计延误 5 工作日',
        amount: 0, status: 'CLOSED', reportedAt: '2026-02-05 11:00', resolvedAt: '2026-02-18 10:00',
      },
    ];
    return { data, success: true, total: data.length };
  };

  const EXCEPTION_COLOR: Record<string, string> = {
    LOST: 'error', DAMAGED: 'error', MISMATCH: 'warning', DELAY: 'warning', RETURN: 'default',
  };
  const EXCEPTION_LABEL: Record<string, string> = {
    LOST: '丢失', DAMAGED: '破损', MISMATCH: '品项不符', DELAY: '延误', RETURN: '退件',
  };

  const openCount = [{ status: 'OPEN' }, { status: 'PROCESSING' }].length;

  const columns: ProColumns<ExceptionItem>[] = [
    {
      title: '关联订单',
      dataIndex: 'orderNo',
      copyable: true,
      width: 160,
      render: (v) => <span className="font-mono text-sm">{v as string}</span>,
    },
    { title: '物流单号', dataIndex: 'trackingNo', width: 150, copyable: true },
    { title: '客户名称', dataIndex: 'customerName', ellipsis: true },
    {
      title: '异常类型',
      dataIndex: 'exceptionType',
      width: 110,
      render: (v) => (
        <Tag color={EXCEPTION_COLOR[v as string]} icon={<WarningOutlined />}>
          {EXCEPTION_LABEL[v as string]}
        </Tag>
      ),
    },
    {
      title: '异常描述',
      dataIndex: 'description',
      ellipsis: true,
      search: false,
    },
    {
      title: '损失金额',
      dataIndex: 'amount',
      width: 100,
      search: false,
      render: (v) => v ? <span className="text-red-500 font-bold">¥{v as number}</span> : '-',
    },
    {
      title: '处理状态',
      dataIndex: 'status',
      width: 100,
      valueEnum: {
        OPEN: { text: '待处理', status: 'Error' },
        PROCESSING: { text: '处理中', status: 'Warning' },
        RESOLVED: { text: '已解决', status: 'Success' },
        CLOSED: { text: '已关闭', status: 'Default' },
      },
    },
    { title: '报告时间', dataIndex: 'reportedAt', width: 150, search: false },
    {
      title: '解决时间',
      dataIndex: 'resolvedAt',
      width: 150,
      search: false,
      render: (v) => v ? <span className="text-green-600">{v as string}</span> : '-',
    },
    {
      title: '操作',
      valueType: 'option',
      width: 130,
      render: (_, record) => [
        <a key="view" className="text-primary"><EyeOutlined className="mr-1" />详情</a>,
        record.status === 'OPEN' && (
          <a key="handle" className="text-orange-500"><CheckCircleOutlined className="mr-1" />处理</a>
        ),
      ],
    },
  ];

  return (
    <PageContainer
      header={{
        title: '出货异常处理',
        subTitle: '管理出库后的物流异常问题件：丢失、破损、错误、退件',
      }}
    >
      {openCount > 0 && (
        <Alert
          className="mb-4"
          type="error"
          icon={<WarningOutlined />}
          showIcon
          message={`当前有 ${openCount} 件待处理 / 处理中的异常问题件，请及时跟进！`}
        />
      )}

      <ProTable<ExceptionItem>
        columns={columns}
        actionRef={actionRef}
        cardBordered
        request={fetchExceptions}
        rowKey="id"
        scroll={{ x: 1400 }}
        search={{ labelWidth: 'auto', collapsed: false }}
        pagination={{ pageSize: 10 }}
        dateFormatter="string"
        headerTitle={<Space><WarningOutlined style={{ color: '#ef4444' }} /><span>问题件列表</span></Space>}
        toolBarRender={() => [
          <Button key="export" icon={<ExportOutlined />}>导出报告</Button>,
        ]}
        rowClassName={(r) =>
          r.status === 'OPEN' ? 'bg-red-50' : r.status === 'PROCESSING' ? 'bg-orange-50' : ''
        }
      />
    </PageContainer>
  );
};

export default OutboundException;
