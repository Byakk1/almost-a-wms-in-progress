import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  Tag, Space, Button, Statistic, Row, Col, Card, Modal, Form,
  Select, InputNumber, Input, message, theme,
} from 'antd';
import { DollarOutlined, PlusOutlined, ReloadOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import request from '../../../utils/request';
import { useCan } from '../../../router/permissions';

// Mirrors GET /customer-transactions. CustomerTransaction carries only
// {customerId, type, amount, description, createdAt} — there is no flow number,
// no operator and no stored before/after balance, so the mock's columns for those
// are gone. The before/after pair is preserved in the OperationLog instead.
interface FlowItem {
  id: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  type: 'topup' | 'deduction' | 'adjustment' | string;
  amount: number;
  description: string;
  createdAt: string;
}

interface CustomerOpt {
  id: string;
  name: string;
  balance: number;
}

const TYPE_LABEL: Record<string, string> = {
  topup: '充值',
  deduction: '扣款',
  adjustment: '调整',
};

const TYPE_COLOR: Record<string, string> = {
  topup: 'success',
  deduction: 'error',
  adjustment: 'default',
};

const AccountFlow: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const { token } = theme.useToken();
  const canWrite = useCan('customer.transaction'); // POST /customer-transactions — finance only

  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [totals, setTotals] = useState({ inflow: 0, outflow: 0, count: 0 });
  const [form] = Form.useForm();

  const loadCustomers = useCallback(async () => {
    try {
      const res: any = await request.get('/customers', { params: { pageSize: 200 } });
      setCustomers(
        (res?.data ?? []).map((c: any) => ({ id: c.id, name: c.name, balance: Number(c.balance ?? 0) })),
      );
    } catch {
      // request.ts interceptor surfaces errors
    }
  }, []);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const fetchFlows = async (params: any) => {
    const { current = 1, pageSize = 10, customerId, type } = params || {};
    const res: any = await request.get('/customer-transactions', {
      params: { page: current, pageSize, customerId, type },
    });
    const rows: FlowItem[] = res?.data ?? [];

    // Summarised over the rows in view — the endpoint returns no aggregate, so the
    // cards are explicitly labelled 本页 rather than implying a global total.
    setTotals({
      inflow: rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0),
      outflow: rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0),
      count: res?.pagination?.total ?? rows.length,
    });

    return { data: rows, success: true, total: res?.pagination?.total ?? rows.length };
  };

  const submit = async () => {
    const vals = await form.validateFields();
    // amount is the signed delta server-side; 扣款 is entered as a positive number
    // and negated here so the operator never has to reason about the sign.
    const amount = vals.type === 'deduction' ? -Math.abs(vals.amount) : vals.amount;
    setSaving(true);
    try {
      const res: any = await request.post('/customer-transactions', { ...vals, amount });
      message.success(
        `${res?.data?.customerName ?? ''} 余额 ${res?.data?.balanceBefore} → ${res?.data?.balanceAfter}`,
      );
      setOpen(false);
      form.resetFields();
      loadCustomers();
      actionRef.current?.reload();
    } catch {
      // request.ts interceptor surfaces errors
    } finally {
      setSaving(false);
    }
  };

  const columns: ProColumns<FlowItem>[] = [
    {
      title: '客户',
      dataIndex: 'customerId',
      width: 220,
      valueType: 'select',
      fieldProps: {
        options: customers.map((c) => ({ value: c.id, label: c.name })),
        showSearch: true,
        optionFilterProp: 'label',
      },
      render: (_, r) => <span>{r.customerName || '—'}</span>,
    },
    {
      title: '交易类型',
      dataIndex: 'type',
      width: 110,
      valueType: 'select',
      valueEnum: {
        topup: { text: '充值' },
        deduction: { text: '扣款' },
        adjustment: { text: '调整' },
      },
      render: (_, r) => <Tag color={TYPE_COLOR[r.type] ?? 'default'}>{TYPE_LABEL[r.type] ?? r.type}</Tag>,
    },
    {
      title: '金额',
      dataIndex: 'amount',
      width: 150,
      search: false,
      render: (_, r) => (
        <span style={{ color: r.amount < 0 ? token.colorError : token.colorSuccess, fontWeight: 700 }}>
          {r.amount < 0 ? <ArrowDownOutlined /> : <ArrowUpOutlined />} ¥{Math.abs(r.amount).toLocaleString()}
        </span>
      ),
    },
    { title: '备注', dataIndex: 'description', ellipsis: true, search: false, render: (_, r) => r.description || '—' },
    { title: '发生时间', dataIndex: 'createdAt', width: 180, search: false },
  ];

  return (
    <PageContainer
      header={{ title: '客户账户流水', subTitle: '账户充值 / 扣款 / 调整记录，客户余额随流水同步变动' }}
    >
      <Row gutter={16} className="mb-4">
        <Col xs={24} sm={8}>
          <Card size="small" className="shadow-sm">
            <Statistic
              title="本页收入合计"
              value={totals.inflow.toFixed(2)}
              valueStyle={{ color: token.colorSuccess }}
              prefix={<ArrowUpOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" className="shadow-sm">
            <Statistic
              title="本页支出合计"
              value={Math.abs(totals.outflow).toFixed(2)}
              valueStyle={{ color: token.colorError }}
              prefix={<ArrowDownOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" className="shadow-sm">
            <Statistic title="流水总条数" value={totals.count} prefix={<DollarOutlined />} />
          </Card>
        </Col>
      </Row>

      <ProTable<FlowItem>
        columns={columns}
        actionRef={actionRef}
        cardBordered
        request={fetchFlows}
        rowKey="id"
        scroll={{ x: 900 }}
        search={{ labelWidth: 'auto', collapsed: false }}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        dateFormatter="string"
        headerTitle={<Space><DollarOutlined style={{ color: token.colorPrimary }} /><span>流水明细</span></Space>}
        toolBarRender={() => [
          <Button key="refresh" icon={<ReloadOutlined />} onClick={() => actionRef.current?.reload()}>刷新</Button>,
          <Button key="add" type="primary" icon={<PlusOutlined />} disabled={!canWrite} onClick={() => setOpen(true)}>
            记一笔
          </Button>,
        ]}
        rowClassName={(r) => (r.amount < 0 ? 'bg-red-50' : 'bg-green-50')}
      />

      <Modal
        title="登记账户流水"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={saving}
        destroyOnHidden
        okText="提交"
      >
        <Form form={form} layout="vertical" initialValues={{ type: 'topup' }}>
          <Form.Item label="客户" name="customerId" rules={[{ required: true, message: '请选择客户' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择客户"
              options={customers.map((c) => ({
                value: c.id,
                label: `${c.name}（当前余额 ${c.balance.toFixed(2)}）`,
              }))}
            />
          </Form.Item>
          <Form.Item label="交易类型" name="type" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'topup', label: '充值（增加余额）' },
                { value: 'deduction', label: '扣款（减少余额）' },
                { value: 'adjustment', label: '调整（按填写正负增减）' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="金额"
            name="amount"
            rules={[{ required: true, message: '请输入金额' }]}
            extra="扣款填正数即可，系统自动记为负数；调整可直接填负数"
          >
            <InputNumber style={{ width: '100%' }} step={0.01} placeholder="0.00" />
          </Form.Item>
          <Form.Item label="备注" name="description">
            <Input.TextArea rows={2} placeholder="例如：银行转账充值 / 2 月账单扣费" />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default AccountFlow;
