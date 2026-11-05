import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  Alert, Button, Card, Col, DatePicker, Form, InputNumber, Row, Select, Space, Statistic, Table, Tag,
  Typography, message, theme,
} from 'antd';
import { FileTextOutlined, PlusOutlined, DeleteOutlined, ThunderboltOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { useCan } from '../../../router/permissions';
import BillDetailDrawer from '../../Billing/BillDetailDrawer';
import {
  STATUS_COLOR, STATUS_LABEL, errMsg, fmtDay, fmtMoney, generateBill, httpStatus, listBills,
  listCustomerOptions, toNum,
} from '../../Billing/api';
import type { Bill, BillDetail, CustomerOption } from '../../Billing/api';

// Codes the finance user may enter as pass-through actuals at generation time.
// FUEL is the only PASS_THROUGH surcharge at launch (PRD §10 decision 5).
const ACTUAL_CODE_OPTIONS = [{ value: 'FUEL', label: 'FUEL · 燃油附加费（实报实销）' }];

interface GenForm {
  customerId: string;
  period: Dayjs;
  actuals?: { code: string; amount: number }[];
}

const BillingGeneration: React.FC = () => {
  const { token } = theme.useToken();
  const actionRef = useRef<ActionType>(null);
  const canGenerate = useCan('bill.generate');
  const [form] = Form.useForm<GenForm>();
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [generating, setGenerating] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ id: string; initial: BillDetail | null } | null>(null);
  const [loaded, setLoaded] = useState<Bill[]>([]);

  const watchedCustomer = Form.useWatch('customerId', form);
  const watchedPeriod = Form.useWatch('period', form);
  const periodStr = watchedPeriod ? dayjs(watchedPeriod).format('YYYY-MM') : undefined;

  useEffect(() => {
    listCustomerOptions().then(setCustomers).catch(() => {});
  }, []);

  // The list under the form follows the form's customer/period so the user sees
  // the bill they are about to create (or the one that already exists).
  useEffect(() => {
    actionRef.current?.reload();
  }, [watchedCustomer, periodStr]);

  const customerOptions = useMemo(
    () => customers.map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name })),
    [customers],
  );

  const fetchList = async (params: any) => {
    const res = await listBills({
      customerId: watchedCustomer || undefined,
      period: periodStr,
      page: params.current,
      pageSize: params.pageSize,
    });
    const rows = res?.data ?? [];
    setLoaded(rows);
    return { data: rows, success: true, total: res?.pagination?.total ?? rows.length };
  };

  const kpi = useMemo(() => ({
    customers: new Set(loaded.map((b) => b.customerId)).size,
    amount: loaded.reduce((s, b) => s + toNum(b.amount), 0),
    provisional: loaded.filter((b) => b.isProvisional).length,
  }), [loaded]);

  const submit = async () => {
    // validateFields() inside the try — plain Button onClick, not Modal onOk
    // (report v4.36 bug class).
    setConflict(null);
    setGenerating(true);
    try {
      const v = await form.validateFields();
      const actuals = (v.actuals ?? [])
        .filter((a) => a && a.code && a.amount !== undefined && a.amount !== null)
        .map((a) => ({ code: a.code, amount: Number(a.amount) }));
      const res = await generateBill({
        customerId: v.customerId,
        period: dayjs(v.period).format('YYYY-MM'),
        actuals: actuals.length ? actuals : undefined,
      });
      const bill = res?.data;
      message.success(`已生成账单 ${bill?.billNo ?? ''}`);
      actionRef.current?.reload();
      if (bill?.id) setDrawer({ id: bill.id, initial: bill });
    } catch (e: any) {
      if (e?.errorFields) return; // the form already marks the offending field
      // 409 = 账单已存在 — show the server's own message inline next to the form
      // instead of only a vanishing toast, because the user needs the billNo it names.
      if (httpStatus(e) === 409) setConflict(errMsg(e, '该客户该账期的账单已存在'));
      else message.error(errMsg(e));
    } finally {
      setGenerating(false);
    }
  };

  const columns: ProColumns<Bill>[] = [
    {
      title: '账单编号', dataIndex: 'billNo', width: 170, copyable: true,
      render: (_, r) => <a className="code" onClick={() => setDrawer({ id: r.id, initial: null })}>{r.billNo}</a>,
    },
    {
      title: '客户', dataIndex: 'customerId', ellipsis: true,
      render: (_, r) => (r.customer
        ? <span><span className="code">{r.customer.code}</span> · {r.customer.name}</span>
        : <span className="code">{r.customerId}</span>),
    },
    { title: '账期', dataIndex: 'period', width: 100, render: (_, r) => <Tag className="num">{r.period}</Tag> },
    { title: '金额', dataIndex: 'amount', width: 140, align: 'right', render: (_, r) => <b className="num">{fmtMoney(r.amount)}</b> },
    {
      title: '状态', dataIndex: 'status', width: 150,
      render: (_, r) => (
        <Space size={4}>
          <Tag color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status] ?? r.status}</Tag>
          {r.isProvisional && <Tag color="gold">待确认</Tag>}
        </Space>
      ),
    },
    { title: '到期日', dataIndex: 'dueDate', width: 110, render: (_, r) => <span className="num">{fmtDay(r.dueDate)}</span> },
    { title: '生成时间', dataIndex: 'createdAt', width: 170, render: (_, r) => <span className="num">{r.createdAt ? new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</span> },
    {
      title: '操作', valueType: 'option', width: 80, fixed: 'right',
      render: (_, r) => [
        <a key="view" className="console-primary-action" onClick={() => setDrawer({ id: r.id, initial: null })}>查看</a>,
      ],
    },
  ];

  return (
    <PageContainer
      header={{
        title: '月度账单生成',
        subTitle: '选择客户与账期，按价卡、税率与附加费规则生成当月账单；生成后可在客户账单管理中登记收款',
      }}
    >
      <Row gutter={16} className="mb-4">
        <Col xs={24} sm={8}>
          <Card size="small" className="shadow-sm">
            <Statistic title={`本期已出账客户数 · ${periodStr ?? '全部账期'}`} value={kpi.customers} suffix="家" className="num" />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" className="shadow-sm">
            <Statistic title="本期出账合计" value={fmtMoney(kpi.amount)} className="num" valueStyle={{ color: token.colorPrimary }} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>币种以价卡为准</Typography.Text>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" className="shadow-sm">
            <Statistic title="待确认账单数" value={kpi.provisional} suffix="笔" className="num" valueStyle={{ color: token.colorWarning }} />
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        className="shadow-sm mb-4"
        title={<Space><ThunderboltOutlined style={{ color: token.colorPrimary }} /><span>生成账单</span></Space>}
      >
        {!canGenerate && (
          <Alert type="info" showIcon className="mb-3" message="当前角色只能查看账单，不能生成" />
        )}
        {conflict && (
          <Alert
            type="warning" showIcon closable className="mb-3"
            message="账单已存在" description={conflict}
            onClose={() => setConflict(null)}
            data-testid="gen-conflict"
          />
        )}
        <Form<GenForm>
          form={form}
          layout="vertical"
          name="gen"
          initialValues={{ period: dayjs().subtract(1, 'month') }}
          disabled={!canGenerate}
        >
          <Row gutter={16}>
            <Col xs={24} md={10}>
              <Form.Item name="customerId" label="客户" rules={[{ required: true, message: '请选择客户' }]}>
                <Select showSearch optionFilterProp="label" options={customerOptions} placeholder="选择客户" />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="period" label="账期" rules={[{ required: true, message: '请选择账期' }]} extra="按自然月出账">
                <DatePicker picker="month" format="YYYY-MM" style={{ width: '100%' }} allowClear={false} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label=" " colon={false}>
                <Button type="primary" icon={<FileTextOutlined />} loading={generating} onClick={submit} block disabled={!canGenerate}>
                  生成账单
                </Button>
              </Form.Item>
            </Col>
          </Row>

          <Form.List name="actuals">
            {(fields, { add, remove }) => (
              <>
                <Space className="mb-2" align="baseline">
                  <Typography.Text strong>实报实销金额</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    可选。燃油等按承运商账单实报实销的附加费，若已知金额可在此填写；留空则账单生成为「待确认」，之后再补录。
                  </Typography.Text>
                </Space>
                <Table
                  size="small"
                  pagination={false}
                  rowKey={(f: any) => f.key}
                  dataSource={fields}
                  locale={{ emptyText: '未填写实报实销金额' }}
                  columns={[
                    {
                      title: '编码', width: 260,
                      render: (_: unknown, f: any) => (
                        <Form.Item name={[f.name, 'code']} style={{ margin: 0 }} rules={[{ required: true, message: '请选择编码' }]}>
                          <Select options={ACTUAL_CODE_OPTIONS} placeholder="选择编码" />
                        </Form.Item>
                      ),
                    },
                    {
                      title: '金额', width: 200,
                      render: (_: unknown, f: any) => (
                        <Form.Item
                          name={[f.name, 'amount']} style={{ margin: 0 }}
                          rules={[{ required: true, type: 'number', min: 0, message: '请填写 ≥ 0 的金额' }]}
                        >
                          <InputNumber style={{ width: '100%' }} min={0} precision={2} placeholder="0.00" />
                        </Form.Item>
                      ),
                    },
                    {
                      title: '', width: 60,
                      render: (_: unknown, f: any) => (
                        <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => remove(f.name)} />
                      ),
                    },
                  ]}
                />
                <Button
                  type="dashed" icon={<PlusOutlined />} className="mt-2" size="small"
                  disabled={fields.length >= ACTUAL_CODE_OPTIONS.length}
                  onClick={() => add({ code: 'FUEL' })}
                >
                  添加实报实销项
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Card>

      <ProTable<Bill>
        columns={columns}
        actionRef={actionRef}
        cardBordered
        request={fetchList}
        rowKey="id"
        search={false}
        scroll={{ x: 1000 }}
        pagination={{ defaultPageSize: 10, showSizeChanger: true }}
        options={{ reload: true, density: false, setting: false }}
        headerTitle={(
          <Space>
            <FileTextOutlined style={{ color: token.colorPrimary }} />
            <span>已生成账单</span>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {watchedCustomer || periodStr ? '按上方客户 / 账期筛选' : '全部'}
            </Typography.Text>
          </Space>
        )}
      />

      <BillDetailDrawer
        billId={drawer?.id ?? null}
        initial={drawer?.initial ?? null}
        onClose={() => setDrawer(null)}
        onChanged={() => actionRef.current?.reload()}
      />
    </PageContainer>
  );
};

export default BillingGeneration;
