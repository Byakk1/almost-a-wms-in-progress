import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  Card, Col, DatePicker, Modal, Row, Select, Space, Statistic, Tag, Typography, message, theme,
} from 'antd';
import { FileTextOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import dayjs from 'dayjs';
import { useCan } from '../../router/permissions';
import BillDetailDrawer from './BillDetailDrawer';
import {
  STATUS_COLOR, STATUS_LABEL, errMsg, fmtDay, fmtMoney, listBills, listCustomerOptions, markBillPaid, toNum,
} from './api';
import type { Bill, CustomerOption } from './api';

const BillingDashboard: React.FC = () => {
  const { token } = theme.useToken();
  const actionRef = useRef<ActionType>(null);
  const canPay = useCan('bill.pay');
  const canFinalize = useCan('bill.finalize');
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  // The last page the table loaded, for the KPI cards. They summarise what is
  // on screen for the filtered month — not a server aggregate — so the label
  // says 本月 and the subtitle says which month.
  const [loaded, setLoaded] = useState<{ period: string | undefined; rows: Bill[]; total: number }>({
    period: undefined, rows: [], total: 0,
  });

  useEffect(() => {
    listCustomerOptions().then(setCustomers).catch(() => {});
  }, []);

  const customerOptions = useMemo(
    () => customers.map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name })),
    [customers],
  );

  const fetchList = async (params: any) => {
    const period: string | undefined = params.period
      ? dayjs(params.period).format('YYYY-MM')
      : undefined;
    const res = await listBills({
      customerId: params.customerId || undefined,
      period,
      status: params.status || undefined,
      isProvisional: params.isProvisional === undefined || params.isProvisional === '' ? undefined : params.isProvisional === 'true',
      page: params.current,
      pageSize: params.pageSize,
    });
    const rows = res?.data ?? [];
    setLoaded({ period, rows, total: res?.pagination?.total ?? rows.length });
    return { data: rows, success: true, total: res?.pagination?.total ?? rows.length };
  };

  const kpi = useMemo(() => {
    const rows = loaded.rows;
    return {
      count: loaded.total,
      amount: rows.reduce((s, b) => s + toNum(b.amount), 0),
      unpaid: rows.filter((b) => b.status !== 'paid').reduce((s, b) => s + toNum(b.amount), 0),
      provisional: rows.filter((b) => b.isProvisional).length,
    };
  }, [loaded]);

  // Declarative <Modal>, not the static Modal.confirm(): under antd 5 + React 19
  // the static function cannot consume the ConfigProvider context and renders
  // NOTHING (probed in the E4 browser verification). See BillDetailDrawer.
  const [payTarget, setPayTarget] = useState<Bill | null>(null);
  const [paying, setPaying] = useState(false);
  const confirmMarkPaid = (bill: Bill) => setPayTarget(bill);
  const doMarkPaid = async () => {
    if (!payTarget) return;
    setPaying(true);
    try {
      await markBillPaid(payTarget.id);
      message.success('已标记为已付');
      setPayTarget(null);
      actionRef.current?.reload();
    } catch (e: any) {
      message.error(errMsg(e));
    } finally {
      setPaying(false);
    }
  };

  const columns: ProColumns<Bill>[] = [
    {
      title: '账单编号',
      dataIndex: 'billNo',
      width: 170,
      search: false,
      copyable: true,
      render: (_, r) => <a className="code" onClick={() => setDrawerId(r.id)}>{r.billNo}</a>,
    },
    {
      title: '客户',
      dataIndex: 'customerId',
      ellipsis: true,
      renderFormItem: () => (
        <Select allowClear showSearch optionFilterProp="label" options={customerOptions} placeholder="全部客户" />
      ),
      render: (_, r) => (r.customer
        ? <span><span className="code">{r.customer.code}</span> · {r.customer.name}</span>
        : <span className="code">{r.customerId}</span>),
    },
    {
      title: '账期',
      dataIndex: 'period',
      width: 110,
      renderFormItem: () => <DatePicker picker="month" format="YYYY-MM" style={{ width: '100%' }} placeholder="选择月份" />,
      render: (_, r) => <Tag className="num">{r.period}</Tag>,
    },
    {
      title: '金额',
      dataIndex: 'amount',
      width: 140,
      align: 'right',
      search: false,
      render: (_, r) => <b className="num">{fmtMoney(r.amount)}</b>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 150,
      valueType: 'select',
      fieldProps: { options: [{ label: '待付款', value: 'unpaid' }, { label: '已结清', value: 'paid' }], placeholder: '全部' },
      render: (_, r) => (
        <Space size={4}>
          <Tag color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status] ?? r.status}</Tag>
          {r.isProvisional && <Tag color="gold">待确认</Tag>}
        </Space>
      ),
    },
    {
      title: '待确认',
      dataIndex: 'isProvisional',
      hideInTable: true,
      valueType: 'select',
      fieldProps: { options: [{ label: '仅待确认', value: 'true' }, { label: '仅已确认', value: 'false' }], placeholder: '全部' },
    },
    {
      title: '到期日',
      dataIndex: 'dueDate',
      width: 110,
      search: false,
      render: (_, r) => <span className="num">{fmtDay(r.dueDate)}</span>,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 200,
      fixed: 'right',
      render: (_, r) => [
        <a key="view" className="console-primary-action" onClick={() => setDrawerId(r.id)}>查看</a>,
        canPay && r.status !== 'paid' && (
          <a key="pay" className="console-primary-action" onClick={() => confirmMarkPaid(r)}>标记已付</a>
        ),
        canFinalize && r.isProvisional && (
          <a key="finalize" className="console-primary-action" onClick={() => setDrawerId(r.id)}>补录/确认</a>
        ),
      ],
    },
  ];

  const periodLabel = loaded.period ?? '全部账期';

  return (
    <PageContainer
      header={{
        title: '客户账单管理',
        subTitle: '按客户、账期查看月度账单；核对费用明细与税费，登记收款',
      }}
    >
      <Row gutter={16} className="mb-4">
        <Col xs={24} sm={6}>
          <Card size="small" className="shadow-sm">
            <Statistic title={`本月账单数 · ${periodLabel}`} value={kpi.count} suffix="笔" className="num" />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card size="small" className="shadow-sm">
            <Statistic
              title="本月金额合计"
              value={fmtMoney(kpi.amount)}
              className="num"
              valueStyle={{ color: token.colorPrimary }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>币种以价卡为准</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card size="small" className="shadow-sm">
            <Statistic title="待付款金额" value={fmtMoney(kpi.unpaid)} className="num" valueStyle={{ color: token.colorWarning }} />
          </Card>
        </Col>
        <Col xs={24} sm={6}>
          <Card size="small" className="shadow-sm">
            <Statistic title="待确认账单数" value={kpi.provisional} suffix="笔" className="num" valueStyle={{ color: token.colorWarning }} />
          </Card>
        </Col>
      </Row>

      <ProTable<Bill>
        columns={columns}
        actionRef={actionRef}
        cardBordered
        request={fetchList}
        rowKey="id"
        scroll={{ x: 1000 }}
        search={{ labelWidth: 'auto', collapsed: false }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        options={{ reload: true, density: false, setting: false }}
        headerTitle={<Space><FileTextOutlined style={{ color: token.colorPrimary }} /><span>账单列表</span></Space>}
        toolBarRender={() => [
          <Button key="refresh" icon={<ReloadOutlined />} onClick={() => actionRef.current?.reload()}>刷新</Button>,
        ]}
      />

      <BillDetailDrawer
        billId={drawerId}
        onClose={() => setDrawerId(null)}
        onChanged={() => actionRef.current?.reload()}
      />

      <Modal
        open={!!payTarget}
        title={`标记账单 ${payTarget?.billNo ?? ''} 为已付？`}
        onCancel={() => setPayTarget(null)}
        okText="确认收款"
        cancelText="取消"
        confirmLoading={paying}
        onOk={doMarkPaid}
        destroyOnHidden
      >
        {payTarget?.isProvisional
          ? '该账单仍有待确认项，确认按当前金额记收款？'
          : `将记录一笔 ${fmtMoney(payTarget?.amount)} 的收款并更新客户余额。`}
      </Modal>
    </PageContainer>
  );
};

export default BillingDashboard;
