import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Checkbox, Descriptions, Divider, Drawer, Empty, Form, InputNumber, Modal,
  Space, Table, Tag, Typography, message, theme,
} from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import { useCan } from '../../router/permissions';
import {
  CONFIRMATION_TRIGGERS, KIND_LABEL, KIND_ORDER, STATUS_COLOR, STATUS_LABEL,
  errMsg, finalizeBill, fmtDay, fmtMoney, fmtTime, getBill, markBillPaid, normalizeKind, toNum,
} from './api';
import type { BillDetail, BillItem, BillItemKind, ConfirmationCode } from './api';

interface Props {
  /** Bill to show; null closes the drawer. */
  billId: string | null;
  /** When the caller already holds the full bill (just generated), pass it to
      skip the first GET; the drawer still re-fetches after any mutation. */
  initial?: BillDetail | null;
  onClose: () => void;
  /** Called after mark-paid / finalize succeed so the list behind can reload. */
  onChanged?: () => void;
}

type Group = { kind: Exclude<BillItemKind, null>; rows: BillItem[]; subtotal: number };

/** Lines grouped by kind in invoice order with per-group subtotals. Pre-E4 rows
    (kind=null) fold into BASE. Empty groups are dropped so a bill with no tax
    does not show an empty 税费 block. */
const groupLines = (items: BillItem[]): Group[] => {
  const byKind = new Map<Exclude<BillItemKind, null>, BillItem[]>();
  for (const it of items) {
    const k = normalizeKind(it.kind);
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k)!.push(it);
  }
  return KIND_ORDER
    .filter((k) => byKind.has(k))
    .map((k) => {
      const rows = byKind.get(k)!;
      return { kind: k, rows, subtotal: rows.reduce((s, r) => s + toNum(r.totalAmount), 0) };
    });
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const BillDetailDrawer: React.FC<Props> = ({ billId, initial, onClose, onChanged }) => {
  const { token } = theme.useToken();
  const canPay = useCan('bill.pay');
  const canFinalize = useCan('bill.finalize');
  const [bill, setBill] = useState<BillDetail | null>(initial ?? null);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeForm] = Form.useForm();

  const load = useCallback(async () => {
    if (!billId) return;
    setLoading(true);
    try {
      const res = await getBill(billId);
      setBill(res?.data ?? null);
    } catch {
      // interceptor toasts the HTTP error; keep whatever we had
    } finally {
      setLoading(false);
    }
  }, [billId]);

  useEffect(() => {
    if (!billId) { setBill(null); return; }
    // A freshly generated bill arrives in full from POST /bills/generate; a row
    // click from the list carries only the summary, so fetch the detail.
    if (initial && initial.id === billId) setBill(initial);
    else load();
  }, [billId, initial, load]);

  const groups = useMemo(() => groupLines(bill?.items ?? []), [bill]);
  const linesTotal = useMemo(() => round2(groups.reduce((s, g) => s + g.subtotal, 0)), [groups]);
  const billAmount = toNum(bill?.amount);
  // The on-screen total must equal CustomerBill.amount (PRD §6 primary metric).
  // If the two disagree the UI says so instead of quietly showing one of them.
  const totalMismatch = bill ? Math.abs(linesTotal - billAmount) > 0.005 : false;

  const warnings = bill?.warnings ?? [];
  const pendingSurcharges = useMemo(
    () => (bill?.items ?? []).filter((it) => normalizeKind(it.kind) === 'SURCHARGE' && it.isProvisional),
    [bill],
  );
  const applicableConfirmations = useMemo(
    () => CONFIRMATION_TRIGGERS.filter((t) => warnings.some((w) => w.includes(t.needle))),
    [warnings],
  );

  const afterMutation = async () => {
    await load();
    onChanged?.();
  };

  // Declarative <Modal>, not the static Modal.confirm(): under antd 5 + React 19
  // the static function cannot consume the ConfigProvider context and renders
  // NOTHING (probed in the E4 browser verification — the click was a no-op).
  // Same reason the E3 users page keeps every dialog as a component.
  const [payConfirmOpen, setPayConfirmOpen] = useState(false);
  const confirmMarkPaid = () => { if (bill) setPayConfirmOpen(true); };
  const doMarkPaid = async () => {
    if (!bill) return;
    setPaying(true);
    try {
      await markBillPaid(bill.id);
      message.success('已标记为已付');
      setPayConfirmOpen(false);
      await afterMutation();
    } catch (e: any) {
      message.error(errMsg(e));
    } finally {
      setPaying(false);
    }
  };

  const openFinalize = () => {
    finalizeForm.resetFields();
    setFinalizeOpen(true);
  };

  const submitFinalize = async () => {
    if (!bill) return;
    // validateFields() inside the try: this is a plain Button onClick, not Modal
    // onOk, so a rejected validation would otherwise escape as an unhandled
    // rejection (report v4.36 bug class).
    setFinalizing(true);
    try {
      const v = await finalizeForm.validateFields();
      const actuals = pendingSurcharges.map((it) => ({ code: it.feeType, amount: Number(v[`actual_${it.id}`]) }));
      const confirmations = (applicableConfirmations
        .filter((t) => v[`confirm_${t.code}`])
        .map((t) => t.code)) as ConfirmationCode[];
      await finalizeBill(bill.id, {
        actuals: actuals.length ? actuals : undefined,
        confirmations: confirmations.length ? confirmations : undefined,
      });
      message.success('已补录并确认');
      setFinalizeOpen(false);
      await afterMutation();
    } catch (e: any) {
      if (e?.errorFields) return; // the form already marks the offending field
      message.error(errMsg(e));
    } finally {
      setFinalizing(false);
    }
  };

  const lineColumns = [
    { title: '费用项', dataIndex: 'feeType', width: 160, render: (v: string) => <span className="code">{v}</span> },
    {
      title: '说明', dataIndex: 'description', ellipsis: true,
      render: (v: string, r: BillItem) => (
        <Space size={4}>
          <span>{v || '—'}</span>
          {r.isProvisional && <Tag color="gold">待录入</Tag>}
        </Space>
      ),
    },
    { title: '数量', dataIndex: 'qty', width: 80, align: 'right' as const, render: (v: number | string) => <span className="num">{toNum(v)}</span> },
    { title: '单价', dataIndex: 'unitPrice', width: 110, align: 'right' as const, render: (v: number | string) => <span className="num">{fmtMoney(v)}</span> },
    { title: '金额', dataIndex: 'totalAmount', width: 120, align: 'right' as const, render: (v: number | string) => <b className="num">{fmtMoney(v)}</b> },
  ];

  return (
    <Drawer
      open={!!billId}
      onClose={onClose}
      width={880}
      destroyOnHidden
      loading={loading && !bill}
      title={bill ? (
        <Space>
          <FileTextOutlined style={{ color: token.colorPrimary }} />
          <span className="code">{bill.billNo}</span>
          <Tag color={STATUS_COLOR[bill.status]}>{STATUS_LABEL[bill.status] ?? bill.status}</Tag>
          {bill.isProvisional && <Tag color="gold">待确认</Tag>}
        </Space>
      ) : '账单详情'}
      extra={bill && (
        <Space>
          {canFinalize && bill.isProvisional && (
            <Button onClick={openFinalize}>补录 / 确认</Button>
          )}
          {canPay && bill.status !== 'paid' && (
            <Button type="primary" loading={paying} onClick={confirmMarkPaid}>标记已付</Button>
          )}
        </Space>
      )}
    >
      {!bill ? (loading ? null : <Empty />) : (
        <>
          <Descriptions size="small" bordered column={3} className="mb-4">
            <Descriptions.Item label="客户" span={2}>
              {bill.customer ? <><span className="code">{bill.customer.code}</span> · {bill.customer.name}</> : bill.customerId}
            </Descriptions.Item>
            <Descriptions.Item label="账期"><span className="num">{bill.period}</span></Descriptions.Item>
            <Descriptions.Item label="账单号"><span className="code">{bill.billNo}</span></Descriptions.Item>
            <Descriptions.Item label="状态">
              <Space size={4}>
                <Tag color={STATUS_COLOR[bill.status]}>{STATUS_LABEL[bill.status] ?? bill.status}</Tag>
                {bill.isProvisional && <Tag color="gold">待确认</Tag>}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="税号">{bill.taxRegistrationNo ? <span className="code">{bill.taxRegistrationNo}</span> : '—'}</Descriptions.Item>
            <Descriptions.Item label="到期"><span className="num">{fmtDay(bill.dueDate)}</span></Descriptions.Item>
            <Descriptions.Item label="已付时间"><span className="num">{fmtTime(bill.paidAt)}</span></Descriptions.Item>
            <Descriptions.Item label="确认时间"><span className="num">{fmtTime(bill.finalizedAt)}</span></Descriptions.Item>
            <Descriptions.Item label="事件数" span={3}>
              {bill.sourceEvents
                ? <span className="num">出库 {bill.sourceEvents.outboundOrders} · 入库 {bill.sourceEvents.receivingOrders}</span>
                : '—'}
            </Descriptions.Item>
          </Descriptions>

          {warnings.length > 0 && (
            // Verbatim from the API: this is how the storage waiver and the
            // tax-review flags reach the invoice. Nothing is filtered or reworded.
            <Alert
              type="warning"
              showIcon
              className="mb-4"
              message={`提示（${warnings.length}）`}
              description={(
                <ul style={{ margin: 0, paddingLeft: 18 }} data-testid="bill-warnings">
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
            />
          )}

          {groups.length === 0 ? (
            <Empty description="本期没有计费明细" />
          ) : groups.map((g) => (
            <div key={g.kind} className="mb-4" data-testid={`bill-group-${g.kind}`}>
              <Divider orientation="left" orientationMargin={0} style={{ marginTop: 8 }}>
                <Space size={6}>
                  <span>{KIND_LABEL[g.kind]}</span>
                  <Typography.Text type="secondary" style={{ fontWeight: 400 }}>{g.rows.length} 项</Typography.Text>
                </Space>
              </Divider>
              <Table
                dataSource={g.rows}
                columns={lineColumns}
                rowKey="id"
                size="small"
                pagination={false}
                summary={() => (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={4}>
                      <Typography.Text type="secondary">小计 · {KIND_LABEL[g.kind]}</Typography.Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">
                      <b className="num">{fmtMoney(g.subtotal)}</b>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                )}
              />
            </div>
          ))}

          <div
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              padding: '12px 16px', background: token.colorFillAlter, borderRadius: token.borderRadius,
            }}
          >
            <Space direction="vertical" size={0}>
              <span style={{ fontWeight: 600 }}>账单合计</span>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>币种以价卡为准</Typography.Text>
            </Space>
            <span className="num" style={{ fontSize: 20, fontWeight: 700, color: token.colorPrimary }} data-testid="bill-total">
              {fmtMoney(bill.amount)}
            </span>
          </div>
          {totalMismatch && (
            <Alert
              type="error"
              showIcon
              className="mt-3"
              message="明细合计与账单金额不一致"
              description={`明细合计 ${fmtMoney(linesTotal)}，账单金额 ${fmtMoney(bill.amount)}。请勿据此开票，联系管理员核查。`}
            />
          )}
        </>
      )}

      <Modal
        open={finalizeOpen}
        title={`补录 / 确认 · ${bill?.billNo ?? ''}`}
        onCancel={() => setFinalizeOpen(false)}
        destroyOnHidden
        footer={[
          <Button key="cancel" onClick={() => setFinalizeOpen(false)}>取消</Button>,
          <Button key="ok" type="primary" loading={finalizing} onClick={submitFinalize}>提交确认</Button>,
        ]}
      >
        <Alert
          type="info"
          showIcon
          className="mb-4"
          message="确认后将重算税费并只记差额"
          description="实报实销项按承运商账单金额填写；确认项勾选即表示已人工复核。提交后账单不再是待确认状态。"
        />
        <Form form={finalizeForm} layout="vertical" name="finalize">
          {pendingSurcharges.length > 0 && (
            <>
              <Typography.Text strong>待录入的实报实销项</Typography.Text>
              <Table
                className="mt-2 mb-4"
                dataSource={pendingSurcharges}
                rowKey="id"
                size="small"
                pagination={false}
                columns={[
                  { title: '编码', dataIndex: 'feeType', width: 120, render: (v: string) => <span className="code">{v}</span> },
                  { title: '说明', dataIndex: 'description', ellipsis: true },
                  {
                    title: '实际金额', width: 180,
                    render: (_: unknown, r: BillItem) => (
                      <Form.Item
                        name={`actual_${r.id}`}
                        style={{ margin: 0 }}
                        rules={[{ required: true, type: 'number', min: 0, message: '请填写 ≥ 0 的金额' }]}
                      >
                        <InputNumber style={{ width: '100%' }} min={0} precision={2} placeholder="0.00" />
                      </Form.Item>
                    ),
                  },
                ]}
              />
            </>
          )}
          {applicableConfirmations.length > 0 && (
            <>
              <Typography.Text strong>需人工确认</Typography.Text>
              <div className="mt-2">
                {applicableConfirmations.map((t) => (
                  <Form.Item key={t.code} name={`confirm_${t.code}`} valuePropName="checked" style={{ marginBottom: 8 }}>
                    <Checkbox>{t.label}</Checkbox>
                  </Form.Item>
                ))}
              </div>
            </>
          )}
          {pendingSurcharges.length === 0 && applicableConfirmations.length === 0 && (
            <Empty description="没有待录入或待确认的项目" />
          )}
        </Form>
      </Modal>

      <Modal
        open={payConfirmOpen}
        title={`标记账单 ${bill?.billNo ?? ''} 为已付？`}
        onCancel={() => setPayConfirmOpen(false)}
        okText="确认收款"
        cancelText="取消"
        confirmLoading={paying}
        onOk={doMarkPaid}
        destroyOnHidden
      >
        {bill?.isProvisional
          ? '该账单仍有待确认项，确认按当前金额记收款？'
          : `将记录一笔 ${fmtMoney(bill?.amount)} 的收款并更新客户余额。`}
      </Modal>
    </Drawer>
  );
};

export default BillDetailDrawer;
