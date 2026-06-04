import React, { useRef } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Tag, Space, Button, Statistic, Row, Col, Card } from 'antd';
import { ExportOutlined, DollarOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';

interface FlowItem {
  id: string;
  flowNo: string;
  customerName: string;
  txType: 'RECHARGE' | 'CONSUME' | 'REFUND' | 'ADJUST';
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  remark: string;
  operator: string;
  createdAt: string;
}

const AccountFlow: React.FC = () => {
  const actionRef = useRef<ActionType>(null);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const fetchFlows = async (_p: any, _s: any, _f: any) => {
    await new Promise((r) => setTimeout(r, 600));
    const data: FlowItem[] = [
      { id: '1', flowNo: 'FL-260304-001', customerName: '深圳大卖贸易', txType: 'RECHARGE', amount: 10000, balanceBefore: 2500, balanceAfter: 12500, remark: '客户充值', operator: '财务王', createdAt: '2026-03-04 09:00' },
      { id: '2', flowNo: 'FL-260304-002', customerName: '深圳大卖贸易', txType: 'CONSUME', amount: -1280, balanceBefore: 12500, balanceAfter: 11220, remark: '2月账单扣费', operator: '系统', createdAt: '2026-03-04 10:30' },
      { id: '3', flowNo: 'FL-260303-001', customerName: 'Global E-commerce', txType: 'RECHARGE', amount: 5000, balanceBefore: 800, balanceAfter: 5800, remark: '银行转账', operator: '财务王', createdAt: '2026-03-03 14:00' },
      { id: '4', flowNo: 'FL-260303-002', customerName: '跨境优品', txType: 'REFUND', amount: 320, balanceBefore: 150, balanceAfter: 470, remark: '运费退款', operator: '客服李', createdAt: '2026-03-03 16:00' },
      { id: '5', flowNo: 'FL-260302-001', customerName: '欧洲专线', txType: 'ADJUST', amount: -500, balanceBefore: 1200, balanceAfter: 700, remark: '账单调整', operator: '财务王', createdAt: '2026-03-02 11:00' },
    ];
    return { data, success: true, total: data.length };
  };

  const TX_COLOR: Record<string, string> = { RECHARGE: 'success', CONSUME: 'error', REFUND: 'warning', ADJUST: 'default' };
  const TX_LABEL: Record<string, string> = { RECHARGE: '充值', CONSUME: '消费', REFUND: '退款', ADJUST: '调整' };

  const columns: ProColumns<FlowItem>[] = [
    { title: '流水号', dataIndex: 'flowNo', copyable: true, width: 160 },
    { title: '客户名称', dataIndex: 'customerName', ellipsis: true },
    {
      title: '交易类型', dataIndex: 'txType', width: 100,
      render: (v) => <Tag color={TX_COLOR[v as string]}>{TX_LABEL[v as string]}</Tag>,
    },
    {
      title: '金额', dataIndex: 'amount', width: 120, search: false,
      render: (v) => {
        const n = v as number;
        return <span className={`font-bold text-base ${n > 0 ? 'text-green-600' : 'text-red-500'}`}>
          {n > 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} ¥{Math.abs(n).toLocaleString()}
        </span>;
      },
    },
    { title: '交易前余额', dataIndex: 'balanceBefore', width: 120, search: false, render: (v) => `¥${(v as number).toLocaleString()}` },
    { title: '交易后余额', dataIndex: 'balanceAfter', width: 120, search: false, render: (v) => <span className="font-bold">¥{(v as number).toLocaleString()}</span> },
    { title: '备注', dataIndex: 'remark', ellipsis: true, search: false },
    { title: '操作人', dataIndex: 'operator', width: 90, search: false },
    { title: '时间', dataIndex: 'createdAt', width: 150, search: false },
  ];

  return (
    <PageContainer header={{ title: '账户流水', subTitle: '查看客户账户的充值、消费、退款等交易明细' }}>
      <Row gutter={16} className="mb-4">
        {[
          { label: '今日充值', value: '¥15,000', icon: <ArrowUpOutlined />, color: '#10b981' },
          { label: '今日消费', value: '¥1,280', icon: <ArrowDownOutlined />, color: '#ef4444' },
          { label: '今日退款', value: '¥320', icon: <DollarOutlined />, color: '#f97316' },
        ].map((s) => (
          <Col key={s.label} span={8}>
            <Card size="small" className="shadow-sm text-center">
              <Statistic title={s.label} value={s.value} valueStyle={{ color: s.color, fontSize: 20 }} prefix={s.icon} />
            </Card>
          </Col>
        ))}
      </Row>
      <ProTable<FlowItem>
        columns={columns} actionRef={actionRef} cardBordered request={fetchFlows}
        rowKey="id" search={{ labelWidth: 'auto', collapsed: false }} pagination={{ pageSize: 15 }}
        headerTitle={<Space><DollarOutlined style={{ color: '#D23148' }} /><span>流水明细</span></Space>}
        toolBarRender={() => [<Button key="export" icon={<ExportOutlined />}>导出流水</Button>]}
        rowClassName={(r) => r.txType === 'CONSUME' ? 'bg-red-50' : r.txType === 'RECHARGE' ? 'bg-green-50' : ''}
      />
    </PageContainer>
  );
};

export default AccountFlow;
