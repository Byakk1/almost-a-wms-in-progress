import React, { useCallback, useEffect, useState } from 'react';
import { ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import {
  Drawer, Tabs, Descriptions, Tag, Space, Button, Form, Select, InputNumber,
  Input, Modal, Popconfirm, message, Alert, Empty, Statistic, Row, Col, Card,
} from 'antd';
import { PlusOutlined, DeleteOutlined, CalculatorOutlined } from '@ant-design/icons';
import request from '../../../utils/request';
import { useCan } from '../../../router/permissions';
import {
  CHARGE_UNIT_LABEL, MAX_DISCOUNT_RATIO, MIN_DISCOUNT_RATIO, STATUS_COLOR,
  STATUS_LABEL, TIER_BASIS_LABEL, TYPE_COLOR, TYPE_LABEL, bandLabel,
} from './constants';

interface Props {
  cardId: string | null;
  onClose: () => void;
  onChanged: () => void;
}

interface CustomerOpt { id: string; name: string; }

const RateCardDetail: React.FC<Props> = ({ cardId, onClose, onChanged }) => {
  const canWrite = useCan('rateCard.write');
  const [card, setCard] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [quote, setQuote] = useState<any>(null);
  const [quoting, setQuoting] = useState(false);
  const [assignForm] = Form.useForm();
  const [quoteForm] = Form.useForm();

  const load = useCallback(async () => {
    if (!cardId) return;
    setLoading(true);
    try {
      const res: any = await request.get(`/rate-cards/${cardId}`);
      setCard(res?.data ?? null);
    } finally {
      setLoading(false);
    }
  }, [cardId]);

  useEffect(() => { load(); setQuote(null); }, [load]);

  useEffect(() => {
    if (!cardId) return;
    request.get('/customers', { params: { pageSize: 200 } })
      .then((res: any) => setCustomers((res?.data ?? []).map((c: any) => ({ id: c.id, name: c.name }))))
      .catch(() => {});
  }, [cardId]);

  const isShipping = card?.type === 'SHIPPING';
  const isDraft = card?.status === 'DRAFT';

  // ─── Items ─ paged, because a shipping card carries one row per (zone × band)
  const itemColumns: ProColumns<any>[] = [
    { title: '费用项', dataIndex: 'itemName', width: 200, search: false,
      render: (_, r) => r.itemName || r.itemCode || '—' },
    { title: '编码', dataIndex: 'itemCode', width: 150 },
    ...(isShipping ? [{ title: '分区', dataIndex: 'zone', width: 100 } as ProColumns<any>] : []),
    { title: '计费基准', dataIndex: 'tierBasis', width: 120, search: false,
      render: (_, r) => TIER_BASIS_LABEL[r.tierBasis] ?? r.tierBasis },
    { title: '区间', width: 160, search: false,
      render: (_, r) => (r.tierBasis === 'NONE' ? '—' : bandLabel(r.rangeStart, r.rangeEnd)) },
    { title: '单价', width: 130, search: false, align: 'right',
      render: (_, r) => (r.quoteOnRequest
        ? <Tag color="warning">面议</Tag>
        : <b>{Number(r.unitPrice).toLocaleString(undefined, { maximumFractionDigits: 4 })}</b>) },
    { title: '单位', dataIndex: 'chargeUnit', width: 110, search: false,
      render: (_, r) => CHARGE_UNIT_LABEL[r.chargeUnit] ?? r.chargeUnit },
    { title: '最低收费', dataIndex: 'minFee', width: 100, search: false,
      render: (_, r) => (r.minFee === null ? '—' : Number(r.minFee)) },
    { title: '备注', dataIndex: 'note', ellipsis: true, search: false },
  ];

  const fetchItems = async (params: any) => {
    const res: any = await request.get(`/rate-cards/${cardId}/items`, {
      params: { page: params.current, pageSize: params.pageSize, zone: params.zone, itemCode: params.itemCode },
    });
    return { data: res?.data ?? [], success: true, total: res?.pagination?.total ?? 0 };
  };

  const fetchZones = async (params: any) => {
    const res: any = await request.get(`/rate-cards/${cardId}/zones`, {
      params: { page: params.current, pageSize: params.pageSize, zone: params.zone, origin: params.origin },
    });
    return { data: res?.data ?? [], success: true, total: res?.pagination?.total ?? 0 };
  };

  // ─── Lifecycle ──────────────────────────────────────────────────────
  const lifecycle = async (action: 'activate' | 'archive') => {
    try {
      await request.put(`/rate-cards/${cardId}/${action}`);
      message.success(action === 'activate' ? '价卡已启用' : '价卡已归档');
      await load();
      onChanged();
    } catch { /* interceptor surfaces the reason (tier gaps, missing zones, …) */ }
  };

  // ─── Assignment ─────────────────────────────────────────────────────
  const submitAssign = async () => {
    const v = await assignForm.validateFields();
    try {
      await request.post('/rate-cards/assign', { ...v, rateCardId: cardId });
      message.success('已绑定客户');
      setAssignOpen(false);
      assignForm.resetFields();
      await load();
    } catch { /* interceptor surfaces it */ }
  };

  const unassign = async (customerId: string) => {
    await request.delete(`/rate-cards/assign/${customerId}/${cardId}`);
    message.success('已解除绑定');
    await load();
  };

  // ─── Quote tester ───────────────────────────────────────────────────
  // Finance and CS get asked "what would this cost" constantly; without this they
  // would be reading the tier table by eye, which is exactly how the old
  // hardcoded matrix went unnoticed for so long.
  const runQuote = async () => {
    // validateFields() must be INSIDE the try: this is a plain Button onClick, not
    // a Modal onOk, so a rejected validation promise escapes as an unhandled
    // rejection instead of just marking the offending field.
    setQuoting(true);
    try {
      const v = await quoteForm.validateFields();
      const res: any = await request.post('/rate-cards/quote', {
        ...v, type: card.type, carrier: card.carrier ?? undefined,
      });
      setQuote(res?.data ?? null);
    } catch {
      setQuote(null);
    } finally {
      setQuoting(false);
    }
  };

  const assignedIds = new Set((card?.customers ?? []).map((c: any) => c.customerId));

  return (
    <Drawer
      open={!!cardId}
      onClose={onClose}
      width={1080}
      destroyOnHidden
      loading={loading}
      title={card ? (
        <Space>
          <span>{card.name}</span>
          <Tag color={TYPE_COLOR[card.type]}>{TYPE_LABEL[card.type] ?? card.type}</Tag>
          <Tag color={STATUS_COLOR[card.status]}>{STATUS_LABEL[card.status] ?? card.status}</Tag>
          {card.isDefault && <Tag color="cyan">默认挂牌价</Tag>}
        </Space>
      ) : '价卡详情'}
      extra={card && canWrite && (
        <Space>
          {card.status === 'DRAFT' && (
            <Popconfirm
              title="启用后价格即冻结"
              description="启用会先校验梯度是否连续、无重叠、顶档开口。之后改价须新建一张生效日期更晚的价卡。"
              onConfirm={() => lifecycle('activate')}
            >
              <Button type="primary">启用</Button>
            </Popconfirm>
          )}
          {card.status !== 'ARCHIVED' && (
            <Popconfirm title="确认归档？" description="归档后不可再启用，也不能分配给客户。" onConfirm={() => lifecycle('archive')}>
              <Button danger>归档</Button>
            </Popconfirm>
          )}
        </Space>
      )}
    >
      {!card ? <Empty /> : (
        <>
          <Descriptions size="small" bordered column={3} className="mb-4">
            <Descriptions.Item label="币种">{card.currency}</Descriptions.Item>
            <Descriptions.Item label="承运商">{card.carrier || '—'}</Descriptions.Item>
            <Descriptions.Item label="生效">{String(card.effectiveAt).slice(0, 10)}</Descriptions.Item>
            <Descriptions.Item label="失效">
              {card.expiredAt ? String(card.expiredAt).slice(0, 10) : <span className="text-gray-400">长期有效</span>}
            </Descriptions.Item>
            <Descriptions.Item label="明细条数">{card.itemCount}</Descriptions.Item>
            <Descriptions.Item label="分区行数">{card.zoneCount}</Descriptions.Item>
            <Descriptions.Item label="备注" span={3}>{card.note || '—'}</Descriptions.Item>
          </Descriptions>

          {isDraft && (
            <Alert
              type="info" showIcon className="mb-4"
              message="草稿状态"
              description="草稿可以自由增删明细。一旦启用，价格即冻结——改价请新建一张生效日期更晚的价卡，而不是修改这一张。"
            />
          )}

          <Tabs
            items={[
              {
                key: 'items',
                label: `计费明细 (${card.itemCount})`,
                children: (
                  <ProTable
                    columns={itemColumns}
                    request={fetchItems}
                    rowKey="id"
                    size="small"
                    search={{ labelWidth: 'auto' }}
                    pagination={{ pageSize: 20, showSizeChanger: true }}
                    scroll={{ x: 1000 }}
                    options={false}
                    cardProps={{ bodyStyle: { padding: 0 } }}
                  />
                ),
              },
              ...(isShipping ? [{
                key: 'zones',
                label: `分区表 (${card.zoneCount})`,
                children: (
                  <>
                    <Alert
                      type="info" showIcon className="mb-3"
                      message="同一邮编，不同发货仓可能落在不同分区"
                      description="询价时按「最长前缀」匹配：V6B 优先于 V6，V6 优先于 V。"
                    />
                    <ProTable
                      columns={[
                        { title: '发货仓', dataIndex: 'origin', width: 140,
                          render: (_, r) => r.origin || <span className="text-gray-400">（不区分）</span> },
                        { title: '目的地邮编/前缀', dataIndex: 'destination', width: 180 },
                        { title: '计费分区', dataIndex: 'zone', width: 140 },
                      ]}
                      request={fetchZones}
                      rowKey="id"
                      size="small"
                      search={{ labelWidth: 'auto' }}
                      pagination={{ pageSize: 20, showSizeChanger: true }}
                      options={false}
                      cardProps={{ bodyStyle: { padding: 0 } }}
                    />
                  </>
                ),
              }] : []),
              {
                key: 'customers',
                label: `客户绑定 (${card.customers?.length ?? 0})`,
                children: (
                  <>
                    <Space className="mb-3">
                      <Button
                        type="primary" icon={<PlusOutlined />} disabled={!canWrite || card.status === 'ARCHIVED'}
                        onClick={() => setAssignOpen(true)}
                      >
                        绑定客户
                      </Button>
                      <span className="text-gray-500 text-xs">
                        同一客户匹配到多张卡时，优先级高者胜出；折扣系数按「绑定关系」生效，不影响该客户的其他价卡
                      </span>
                    </Space>
                    <ProTable
                      columns={[
                        { title: '客户', dataIndex: 'customerName', width: 220 },
                        { title: '客户编码', dataIndex: 'customerCode', width: 160 },
                        { title: '优先级', dataIndex: 'priority', width: 100 },
                        {
                          title: '折扣系数', dataIndex: 'discountRatio', width: 140,
                          render: (_, r) => (Number(r.discountRatio) === 1
                            ? <Tag>标准价</Tag>
                            : <Tag color="gold">{Number(r.discountRatio)}（{Math.round((1 - Number(r.discountRatio)) * 100)}% 折让）</Tag>),
                        },
                        {
                          title: '操作', width: 90,
                          render: (_, r) => (
                            <Popconfirm title="解除绑定？" onConfirm={() => unassign(r.customerId)}>
                              <Button size="small" danger type="text" icon={<DeleteOutlined />} disabled={!canWrite} />
                            </Popconfirm>
                          ),
                        },
                      ]}
                      dataSource={card.customers ?? []}
                      rowKey="customerId"
                      size="small"
                      search={false}
                      pagination={false}
                      options={false}
                      cardProps={{ bodyStyle: { padding: 0 } }}
                    />
                  </>
                ),
              },
              {
                key: 'quote',
                label: '询价试算',
                children: (
                  <Row gutter={16}>
                    <Col span={10}>
                      {/* name= namespaces the field ids (quote_destination, …). Without it antd
                          emits bare ids that collide with the ProTable search boxes on the other
                          tabs — antd keeps activated panes mounted, so both live in the DOM. */}
                      <Form form={quoteForm} name="quote" layout="vertical">
                        <Form.Item label="客户" name="customerId" extra="留空则按默认挂牌价计算">
                          <Select
                            allowClear showSearch optionFilterProp="label" placeholder="（不指定客户）"
                            options={customers.map((c) => ({ value: c.id, label: c.name }))}
                          />
                        </Form.Item>
                        {isShipping && (
                          <>
                            <Form.Item label="目的地邮编" name="destination" rules={[{ required: true, message: '运费必须填邮编' }]}>
                              <Input placeholder="例如 V6B 1A1" />
                            </Form.Item>
                            <Form.Item label="发货仓" name="origin" extra="分区表按发货仓区分时必填">
                              <Input placeholder="例如 多伦多" />
                            </Form.Item>
                          </>
                        )}
                        <Form.Item label="计费编码" name="itemCode" extra="多个计费项时用于指定，如 CPC_RETURN">
                          <Input placeholder="可留空" />
                        </Form.Item>
                        <Form.Item label="计费数值" name="value" extra="分档依据：重量填 kg、库龄填天数">
                          <InputNumber style={{ width: '100%' }} min={0} placeholder="例如 2.5" />
                        </Form.Item>
                        <Form.Item label="数量" name="quantity" extra="留空按 1 计">
                          <InputNumber style={{ width: '100%' }} min={0} />
                        </Form.Item>
                        <Button type="primary" icon={<CalculatorOutlined />} loading={quoting} onClick={runQuote} block>
                          试算
                        </Button>
                      </Form>
                    </Col>
                    <Col span={14}>
                      {!quote ? (
                        <Card size="small"><Empty description="填写左侧条件后点击「试算」" /></Card>
                      ) : (
                        <Card size="small">
                          {quote.quoteOnRequest ? (
                            <Alert type="warning" showIcon message="该项为面议价" description={quote.message || '需人工报价，系统不会按 0 计费'} />
                          ) : (
                            <Row gutter={16} className="mb-3">
                              <Col span={12}>
                                <Statistic title="应收金额" value={quote.amount} precision={2} prefix={quote.currency} />
                              </Col>
                              <Col span={12}>
                                <Statistic
                                  title="标准价金额" value={quote.listAmount} precision={2}
                                  valueStyle={{ color: '#999', textDecoration: Number(quote.discountRatio) === 1 ? 'none' : 'line-through' }}
                                />
                              </Col>
                            </Row>
                          )}
                          <Descriptions size="small" column={2} bordered>
                            <Descriptions.Item label="命中价卡" span={2}>{quote.rateCardName}</Descriptions.Item>
                            <Descriptions.Item label="来源">
                              {quote.source === 'CUSTOMER' ? <Tag color="blue">客户专属</Tag> : <Tag>默认挂牌价</Tag>}
                            </Descriptions.Item>
                            <Descriptions.Item label="折扣系数">
                              {Number(quote.discountRatio) === 1 ? '标准价' : `${quote.discountRatio}`}
                            </Descriptions.Item>
                            {quote.zone && <Descriptions.Item label="计费分区" span={2}>{quote.zone}</Descriptions.Item>}
                            <Descriptions.Item label="命中区间">
                              {quote.tierBasis === 'NONE' ? '不分档' : bandLabel(quote.rangeStart, quote.rangeEnd)}
                            </Descriptions.Item>
                            <Descriptions.Item label="计费单位">
                              {CHARGE_UNIT_LABEL[quote.chargeUnit] ?? quote.chargeUnit}
                            </Descriptions.Item>
                            <Descriptions.Item label="单价">{quote.unitPrice ?? '—'}</Descriptions.Item>
                            <Descriptions.Item label="标准单价">{quote.listUnitPrice ?? '—'}</Descriptions.Item>
                            {quote.minFeeApplied && (
                              <Descriptions.Item label="提示" span={2}>
                                <Tag color="gold">已按最低收费计</Tag>
                                <span className="text-xs text-gray-500">最低收费不参与折扣</span>
                              </Descriptions.Item>
                            )}
                            {quote.note && <Descriptions.Item label="备注" span={2}>{quote.note}</Descriptions.Item>}
                          </Descriptions>
                        </Card>
                      )}
                    </Col>
                  </Row>
                ),
              },
            ]}
          />

          <Modal
            title="绑定客户到此价卡"
            open={assignOpen}
            onCancel={() => setAssignOpen(false)}
            onOk={submitAssign}
            destroyOnHidden
            okText="绑定"
          >
            <Form form={assignForm} name="assign" layout="vertical" initialValues={{ priority: 0, discountRatio: 1 }}>
              <Form.Item label="客户" name="customerId" rules={[{ required: true, message: '请选择客户' }]}>
                <Select
                  showSearch optionFilterProp="label" placeholder="选择客户"
                  options={customers.map((c) => ({
                    value: c.id, label: c.name, disabled: assignedIds.has(c.id),
                  }))}
                />
              </Form.Item>
              <Form.Item label="优先级" name="priority" extra="同一客户匹配到多张卡时，数值大的胜出">
                <InputNumber style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item
                label="折扣系数"
                name="discountRatio"
                rules={[{
                  required: true,
                  type: 'number',
                  min: MIN_DISCOUNT_RATIO,
                  max: MAX_DISCOUNT_RATIO,
                  message: `折扣系数必须在 ${MIN_DISCOUNT_RATIO} – ${MAX_DISCOUNT_RATIO} 之间`,
                }]}
                extra={`1 = 标准价，${MIN_DISCOUNT_RATIO} = 下限（最多 ${Math.round((1 - MIN_DISCOUNT_RATIO) * 100)}% 折让）。超出范围会被拒绝，不会被自动夹到边界。`}
              >
                <InputNumber style={{ width: '100%' }} step={0.01} min={MIN_DISCOUNT_RATIO} max={MAX_DISCOUNT_RATIO} />
              </Form.Item>
            </Form>
          </Modal>
        </>
      )}
    </Drawer>
  );
};

export default RateCardDetail;
