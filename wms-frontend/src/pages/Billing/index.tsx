import React, { useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Button, Tag, Space, Card, Row, Col, Statistic, Drawer, Descriptions, Table, Divider } from 'antd';
import { FileTextOutlined, ExportOutlined, EyeOutlined, PrinterOutlined } from '@ant-design/icons';

interface BillItem {
  id: string;
  billNo: string;
  customerName: string;
  period: string;
  freightFee: number;
  storageFee: number;
  handlingFee: number;
  surcharges: number;
  totalAmount: number;
  status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERDUE';
  dueDate: string;
  billedAt: string;
}

const mockBills: BillItem[] = [
  {
    id: '1', billNo: 'BILL-2026-02-001', customerName: '深圳市大卖贸易',
    period: '2026-02', freightFee: 4580, storageFee: 320, handlingFee: 450, surcharges: 180,
    totalAmount: 5530, status: 'UNPAID', dueDate: '2026-03-15', billedAt: '2026-02-28',
  },
  {
    id: '2', billNo: 'BILL-2026-02-002', customerName: 'Global E-commerce Ltd.',
    period: '2026-02', freightFee: 12800, storageFee: 960, handlingFee: 1200, surcharges: 640,
    totalAmount: 15600, status: 'PAID', dueDate: '2026-03-10', billedAt: '2026-02-28',
  },
  {
    id: '3', billNo: 'BILL-2026-02-003', customerName: '跨境优品',
    period: '2026-02', freightFee: 2200, storageFee: 110, handlingFee: 220, surcharges: 0,
    totalAmount: 2530, status: 'OVERDUE', dueDate: '2026-03-05', billedAt: '2026-02-28',
  },
  {
    id: '4', billNo: 'BILL-2026-01-001', customerName: '深圳市大卖贸易',
    period: '2026-01', freightFee: 3980, storageFee: 280, handlingFee: 380, surcharges: 120,
    totalAmount: 4760, status: 'PAID', dueDate: '2026-02-15', billedAt: '2026-01-31',
  },
];

const BillingDashboard: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [drawerBill, setDrawerBill] = useState<BillItem | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const fetchBills = async (_params: any, _sort: any, _filter: any) => {
    await new Promise((r) => setTimeout(r, 600));
    return { data: mockBills, success: true, total: mockBills.length };
  };

  const totalUnpaid = mockBills
    .filter((b) => b.status === 'UNPAID' || b.status === 'OVERDUE')
    .reduce((s, b) => s + b.totalAmount, 0);

  const columns: ProColumns<BillItem>[] = [
    {
      title: '账单编号',
      dataIndex: 'billNo',
      copyable: true,
      width: 170,
      render: (v) => <span className="font-mono text-sm">{v as string}</span>,
    },
    { title: '客户名称', dataIndex: 'customerName', ellipsis: true },
    {
      title: '账期',
      dataIndex: 'period',
      width: 100,
      render: (v) => <Tag>{v as string}</Tag>,
    },
    {
      title: '运费',
      dataIndex: 'freightFee',
      width: 100,
      search: false,
      render: (v) => `¥${(v as number).toLocaleString()}`,
    },
    {
      title: '仓储费',
      dataIndex: 'storageFee',
      width: 90,
      search: false,
      render: (v) => `¥${(v as number).toLocaleString()}`,
    },
    {
      title: '操作费',
      dataIndex: 'handlingFee',
      width: 90,
      search: false,
      render: (v) => `¥${(v as number).toLocaleString()}`,
    },
    {
      title: '账单总额',
      dataIndex: 'totalAmount',
      width: 120,
      search: false,
      sorter: true,
      render: (v) => <span className="font-bold text-lg text-primary">¥{(v as number).toLocaleString()}</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueEnum: {
        UNPAID: { text: '待付款', status: 'Warning' },
        PARTIAL: { text: '部分付款', status: 'Processing' },
        PAID: { text: '已结清', status: 'Success' },
        OVERDUE: { text: '已逾期', status: 'Error' },
      },
    },
    { title: '到期日', dataIndex: 'dueDate', width: 110, search: false },
    {
      title: '操作',
      valueType: 'option',
      width: 130,
      render: (_, record) => [
        <a key="view" className="text-primary" onClick={() => setDrawerBill(record)}>
          <EyeOutlined className="mr-1" />查看
        </a>,
        <a key="print" className="text-blue-500"><PrinterOutlined className="mr-1" />打印</a>,
      ],
    },
  ];

  const detailColumns = [
    { title: '费用项', dataIndex: 'item' },
    { title: '金额', dataIndex: 'amount', render: (v: number) => `¥${v.toLocaleString()}` },
    { title: '占比', dataIndex: 'ratio', render: (v: string) => <Tag>{v}</Tag> },
  ];

  const getDetailRows = (bill: BillItem) => {
    const total = bill.totalAmount;
    return [
      { item: '运费', amount: bill.freightFee, ratio: `${((bill.freightFee / total) * 100).toFixed(1)}%` },
      { item: '仓储费', amount: bill.storageFee, ratio: `${((bill.storageFee / total) * 100).toFixed(1)}%` },
      { item: '操作处理费', amount: bill.handlingFee, ratio: `${((bill.handlingFee / total) * 100).toFixed(1)}%` },
      { item: '附加费合计', amount: bill.surcharges, ratio: `${((bill.surcharges / total) * 100).toFixed(1)}%` },
    ];
  };

  return (
    <PageContainer
      header={{
        title: '客户账单管理',
        subTitle: '查看、打印和管理客户月度账单与费用明细',
      }}
    >
      {/* Summary */}
      <Row gutter={16} className="mb-4">
        <Col span={6}>
          <Card size="small" className="shadow-sm text-center">
            <Statistic title="本月账单总额" value={mockBills.filter(b => b.period === '2026-02').reduce((s, b) => s + b.totalAmount, 0)} prefix="¥" valueStyle={{ color: '#D23148', fontSize: 22 }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" className="shadow-sm text-center">
            <Statistic title="待收款" value={totalUnpaid} prefix="¥" valueStyle={{ color: '#f97316', fontSize: 22 }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" className="shadow-sm text-center">
            <Statistic title="逾期账单" value={mockBills.filter(b => b.status === 'OVERDUE').length} suffix="笔" valueStyle={{ color: '#ef4444', fontSize: 22 }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" className="shadow-sm text-center">
            <Statistic title="已结清" value={mockBills.filter(b => b.status === 'PAID').length} suffix="笔" valueStyle={{ color: '#10b981', fontSize: 22 }} />
          </Card>
        </Col>
      </Row>

      <ProTable<BillItem>
        columns={columns}
        actionRef={actionRef}
        cardBordered
        request={fetchBills}
        rowKey="id"
        search={{ labelWidth: 'auto', collapsed: false }}
        pagination={{ pageSize: 10 }}
        dateFormatter="string"
        headerTitle={<Space><FileTextOutlined style={{ color: '#D23148' }} /><span>账单列表</span></Space>}
        toolBarRender={() => [
          <Button key="export" icon={<ExportOutlined />}>批量导出</Button>,
        ]}
        rowClassName={(r) => r.status === 'OVERDUE' ? 'bg-red-50' : ''}
      />

      {/* Bill Detail Drawer */}
      <Drawer
        title={<Space><FileTextOutlined style={{ color: '#D23148' }} />{drawerBill?.billNo}</Space>}
        open={!!drawerBill}
        onClose={() => setDrawerBill(null)}
        width={480}
        extra={
          <Button icon={<PrinterOutlined />} type="primary" style={{ backgroundColor: '#D23148' }}>
            打印账单
          </Button>
        }
      >
        {drawerBill && (
          <>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="客户">{drawerBill.customerName}</Descriptions.Item>
              <Descriptions.Item label="账期">{drawerBill.period}</Descriptions.Item>
              <Descriptions.Item label="开单日期">{drawerBill.billedAt}</Descriptions.Item>
              <Descriptions.Item label="到期日">{drawerBill.dueDate}</Descriptions.Item>
              <Descriptions.Item label="状态" span={2}>
                <Tag color={drawerBill.status === 'PAID' ? 'success' : drawerBill.status === 'OVERDUE' ? 'error' : 'warning'}>
                  {drawerBill.status === 'PAID' ? '已结清' : drawerBill.status === 'OVERDUE' ? '已逾期' : '待付款'}
                </Tag>
              </Descriptions.Item>
            </Descriptions>
            <Divider>费用明细</Divider>
            <Table
              dataSource={getDetailRows(drawerBill)}
              columns={detailColumns}
              rowKey="item"
              size="small"
              pagination={false}
              summary={() => (
                <tr className="bg-slate-50 font-bold">
                  <td className="px-3 py-2">合计</td>
                  <td className="px-3 py-2 text-primary">¥{drawerBill.totalAmount.toLocaleString()}</td>
                  <td className="px-3 py-2">100%</td>
                </tr>
              )}
            />
          </>
        )}
      </Drawer>
    </PageContainer>
  );
};

export default BillingDashboard;
