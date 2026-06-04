import React, { useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Space, Button, Modal, DatePicker, message, Statistic, Row, Col, Card } from 'antd';
import { FileTextOutlined, AccountBookOutlined, ThunderboltOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

interface BillingRecord {
  id: string;
  billNo: string;
  customerName: string;
  period: string;
  totalOrders: number;
  totalAmount: number;
  status: 'UNPAID' | 'PARTIAL' | 'PAID';
  generatedAt: string;
}

const BillingGeneration: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  
  const [data, setData] = useState<BillingRecord[]>([
    { id: '1', billNo: 'BIL-2603-0001', customerName: '深圳大卖贸易', period: '2026-02-01 ~ 2026-02-28', totalOrders: 1540, totalAmount: 45200.50, status: 'UNPAID', generatedAt: '2026-03-01 02:00' },
    { id: '2', billNo: 'BIL-2603-0002', customerName: '跨境优品', period: '2026-02-01 ~ 2026-02-28', totalOrders: 820, totalAmount: 18500.00, status: 'PAID', generatedAt: '2026-03-01 02:00' },
    { id: '3', billNo: 'BIL-2603-0003', customerName: 'Global E-commerce', period: '2026-02-01 ~ 2026-02-28', totalOrders: 310, totalAmount: 7240.25, status: 'PARTIAL', generatedAt: '2026-03-01 02:00' },
  ]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const fetchBills = async (_p: any) => {
    await new Promise((r) => setTimeout(r, 400));
    return { data, success: true, total: data.length };
  };

  const handleManualGenerate = async () => {
    setGenerating(true);
    await new Promise((r) => setTimeout(r, 1500));
    setGenerating(false);
    setData([{
      id: Date.now().toString(),
      billNo: `BIL-2603-M${Math.floor(Math.random() * 1000)}`,
      customerName: '欧洲专线',
      period: '指定时间段',
      totalOrders: 42,
      totalAmount: 1250.00,
      status: 'UNPAID',
      generatedAt: new Date().toLocaleTimeString('zh-CN'),
    }, ...data]);
    message.success('账单手动生成完毕');
    setModalOpen(false);
  };

  const columns: ProColumns<BillingRecord>[] = [
    { title: '账单编号', dataIndex: 'billNo', copyable: true, width: 150 },
    { title: '客户名称', dataIndex: 'customerName', ellipsis: true },
    { title: '账单周期', dataIndex: 'period', width: 220, search: false },
    { title: '包含订单数', dataIndex: 'totalOrders', width: 110, search: false },
    {
      title: '总金额', dataIndex: 'totalAmount', width: 120, search: false,
      render: (v) => <span className="font-bold text-lg text-primary">¥{(v as number).toLocaleString()}</span>,
    },
    {
      title: '结算状态', dataIndex: 'status', width: 100,
      valueEnum: {
        UNPAID: { text: '未付款', status: 'Error' },
        PARTIAL: { text: '部分结清', status: 'Warning' },
        PAID: { text: '已结清', status: 'Success' },
      },
    },
    { title: '生成时间', dataIndex: 'generatedAt', width: 150, search: false },
    {
      title: '操作', valueType: 'option', width: 120,
      render: (_, record) => [
        <a key="view" className="text-primary"><FileTextOutlined className="mr-1" />明细</a>,
        record.status === 'UNPAID' && <a key="push" className="text-orange-500">推送账单</a>,
      ],
    },
  ];

  return (
    <PageContainer header={{ title: '费用账单管理', subTitle: '管理每月给客户自动生成的物流和仓储账单表' }}>
      <Row gutter={16} className="mb-4">
        <Col span={8}>
          <Card size="small"><Statistic title="2月份总出账金额" value="¥ 70,940.75" prefix={<AccountBookOutlined />} valueStyle={{ color: '#D23148' }} /></Card>
        </Col>
        <Col span={8}>
          <Card size="small"><Statistic title="未结清客户数" value="2" valueStyle={{ color: '#ef4444' }} /></Card>
        </Col>
        <Col span={8}>
          <Card size="small"><Statistic title="系统自动月结日" value="每月 1 日凌晨" prefix={<ThunderboltOutlined />} valueStyle={{ fontSize: 18 }} /></Card>
        </Col>
      </Row>

      <ProTable<BillingRecord>
        columns={columns} actionRef={actionRef} cardBordered request={fetchBills}
        rowKey="id" search={{ labelWidth: 'auto', collapsed: false }} pagination={{ pageSize: 15 }}
        headerTitle={<Space><span>月度对账单列表</span></Space>}
        toolBarRender={() => [
          <Button key="manual" type="primary" style={{ backgroundColor: '#D23148' }} onClick={() => setModalOpen(true)}>手动生成账单</Button>
        ]}
      />

      <Modal title="手动触发账单生成" open={modalOpen} confirmLoading={generating} onOk={handleManualGenerate} onCancel={() => setModalOpen(false)} okText="生成并下发" okButtonProps={{ style: { backgroundColor: '#D23148' } }}>
        <p className="mt-4 mb-4 text-slate-600">
          通常系统会在每月1日自动生成上月账单。使用此功能可以手动强制立刻生成指定周期内的未计费流水账单。
        </p>
        <label className="block mb-2 font-bold">请选择账单拉取周期：</label>
        <RangePicker style={{ width: '100%' }} defaultValue={[dayjs().subtract(7, 'day'), dayjs()]} />
      </Modal>
    </PageContainer>
  );
};

export default BillingGeneration;
