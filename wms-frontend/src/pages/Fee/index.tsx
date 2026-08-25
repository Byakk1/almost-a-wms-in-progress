import React, { useEffect, useState } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import {
  Card, Row, Col, Form, Select, InputNumber, Button, Input, Divider, Table,
  Space, Alert, Statistic, Tag, Descriptions, Empty,
} from 'antd';
import { CalculatorOutlined, ReloadOutlined, TruckOutlined } from '@ant-design/icons';
import request from '../../utils/request';

// 运费试算 — now driven entirely by POST /fee/calculate against the imported rate
// cards. The page used to simulate everything client-side: its own ZONES with
// per-country base rates, COURIERS with multipliers, percentage SURCHARGES and a
// setTimeout(800) to look like a network call. None of it touched the backend, so
// the numbers it showed were invented and would never match a bill.
//
// Deliberately NOT restored from the old version:
//   · fuel / remote / residential percentage surcharges — the carrier bills fuel
//     实报实销 (at whatever it actually invoices), so no card can price it and a
//     hardcoded 12% would be a fabrication. Stated in the notice instead.
//   · 仓储操作费 at 0.5/件 — storage is priced per CBM·day on its own card, not
//     per piece. 价卡管理 › 询价试算 quotes those card types.

interface CarrierOpt {
  carrier: string;
  cardName: string;
}

interface CustomerOpt {
  id: string;
  name: string;
}

interface FeeRow {
  item: string;
  basis: string;
  unitPrice: number | null;
  amount: number | null;
  note?: string;
}

const FeeCalculator: React.FC = () => {
  const [form] = Form.useForm();
  const [carriers, setCarriers] = useState<CarrierOpt[]>([]);
  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [origins, setOrigins] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);
  const [calculating, setCalculating] = useState(false);
  const carrier = Form.useWatch('carrier', form);

  // The carrier list is derived from the ACTIVE shipping cards rather than
  // hardcoded, so it cannot drift from what the engine can actually price.
  useEffect(() => {
    request.get('/rate-cards', { params: { type: 'SHIPPING', status: 'ACTIVE', pageSize: 100 } })
      .then((res: any) => setCarriers(
        (res?.data ?? [])
          .filter((c: any) => c.carrier)
          .map((c: any) => ({ carrier: c.carrier, cardName: c.name })),
      ))
      .catch(() => {});
    request.get('/customers', { params: { pageSize: 200 } })
      .then((res: any) => setCustomers((res?.data ?? []).map((c: any) => ({ id: c.id, name: c.name }))))
      .catch(() => {});
  }, []);

  // Origins come from the selected carrier's own zone table: the same postcode
  // sits in a different zone depending on which warehouse ships it, and only the
  // card knows which origins it actually distinguishes.
  useEffect(() => {
    setOrigins([]);
    form.setFieldValue('origin', undefined);
    if (!carrier) return;
    const card = carriers.find((c) => c.carrier === carrier);
    if (!card) return;
    request.get('/rate-cards', { params: { type: 'SHIPPING', status: 'ACTIVE', carrier, pageSize: 1 } })
      .then((res: any) => {
        const id = res?.data?.[0]?.id;
        if (!id) return;
        return request.get(`/rate-cards/${id}/zones`, { params: { pageSize: 500 } })
          .then((z: any) => {
            const set = new Set<string>();
            (z?.data ?? []).forEach((r: any) => { if (r.origin) set.add(r.origin); });
            setOrigins([...set]);
          });
      })
      .catch(() => {});
  }, [carrier, carriers, form]);

  const calculate = async () => {
    setCalculating(true);
    try {
      const v = await form.validateFields();
      const res: any = await request.post('/fee/calculate', {
        customerId: v.customerId,
        carrier: v.carrier,
        origin: v.origin,
        destination: v.destination,
        actualWeightKg: v.actualWeightKg,
        length: v.length, width: v.width, height: v.height,
        pieces: v.pieces,
      });
      setResult(res?.data ?? null);
    } catch {
      setResult(null); // interceptor surfaces server errors; validation marks fields
    } finally {
      setCalculating(false);
    }
  };

  const reset = () => { form.resetFields(); setResult(null); };

  const fromCard = result?.source === 'RATE_CARD';
  const rc = result?.rateCard;

  const rows: FeeRow[] = result ? [{
    item: '基础运费',
    basis: `${result.chargeableWeight} kg`,
    unitPrice: rc?.unitPrice ?? null,
    amount: result.estimatedFee,
    note: fromCard
      ? `${rc?.zone} 区 · ${result.chargeableBasis === 'VOLUMETRIC' ? '按体积重' : '按实重'}`
      : '占位费率，不可对外报价',
  }] : [];

  const columns = [
    { title: '费用项', dataIndex: 'item', width: 140 },
    { title: '计费基数', dataIndex: 'basis', width: 120 },
    {
      title: '单价', dataIndex: 'unitPrice', width: 110,
      render: (v: number | null) => (v === null ? '—' : v),
    },
    {
      title: '金额', dataIndex: 'amount', width: 120,
      render: (v: number | null) => (v === null
        ? <Tag color="warning">面议</Tag>
        : <b>{result?.currency} {v.toFixed(2)}</b>),
    },
    {
      title: '说明', dataIndex: 'note',
      render: (v?: string) => (v ? <span className="text-xs text-slate-400">{v}</span> : '—'),
    },
  ];

  return (
    <PageContainer
      header={{ title: '运费试算', subTitle: '按已启用的运费价卡计算：邮编 → 分区 → 重量档' }}
    >
      <Alert
        type="info" showIcon className="mb-4"
        message="试算结果为基础运费，不含燃油附加费与消费税"
        description="燃油附加费按承运商实际账单实报实销，消费税按目的省税率在（运费+附加费）基础上计收——两者都不在价卡内，故此处不做估算，以免给出一个对不上账单的数字。仓租与操作费另有价卡，可在「系统设置 › 价卡管理 › 询价试算」查询。"
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={10}>
          <Card
            title={<Space><CalculatorOutlined /><span>计费参数</span></Space>}
            className="shadow-sm"
            extra={<Button size="small" icon={<ReloadOutlined />} onClick={reset}>重置</Button>}
          >
            <Form form={form} name="fee" layout="vertical" initialValues={{ pieces: 1 }}>
              <Form.Item
                label="客户" name="customerId"
                extra="选定客户会套用其合同折扣；留空按默认挂牌价"
              >
                <Select
                  allowClear showSearch optionFilterProp="label" placeholder="（不指定客户，按挂牌价）"
                  options={customers.map((c) => ({ value: c.id, label: c.name }))}
                />
              </Form.Item>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label="承运商" name="carrier" rules={[{ required: true, message: '请选择承运商' }]}>
                    <Select
                      placeholder="选择承运商" suffixIcon={<TruckOutlined />}
                      options={carriers.map((c) => ({ value: c.carrier, label: c.carrier }))}
                      notFoundContent={<Empty description="没有已启用的运费价卡" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="发货仓" name="origin" extra={origins.length ? undefined : '该价卡不区分发货仓'}>
                    <Select
                      allowClear placeholder={origins.length ? '选择发货仓' : '—'}
                      disabled={!origins.length}
                      options={origins.map((o) => ({ value: o, label: o }))}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item
                label="目的地邮编" name="destination"
                rules={[{ required: true, message: '请填写目的地邮编' }]}
                extra="按最长前缀匹配分区：V6B 优先于 V6，V6 优先于 V"
              >
                <Input placeholder="例如 V6B 1A1" />
              </Form.Item>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label="单件实重 (kg)" name="actualWeightKg" rules={[{ required: true, message: '请填写实重' }]}>
                    <InputNumber min={0} step={0.1} style={{ width: '100%' }} placeholder="0.00" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="件数" name="pieces">
                    <InputNumber min={1} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>

              <Divider orientation="left" plain>体积尺寸（可选，三边需齐全）</Divider>
              <Row gutter={8}>
                {(['length', 'width', 'height'] as const).map((k, i) => (
                  <Col span={8} key={k}>
                    <Form.Item label={['长 (cm)', '宽 (cm)', '高 (cm)'][i]} name={k}>
                      <InputNumber min={0} style={{ width: '100%' }} placeholder={['L', 'W', 'H'][i]} />
                    </Form.Item>
                  </Col>
                ))}
              </Row>

              <Button
                type="primary" size="large" block icon={<CalculatorOutlined />}
                loading={calculating} onClick={calculate}
              >
                试算
              </Button>
            </Form>
          </Card>
        </Col>

        <Col xs={24} lg={14}>
          {!result ? (
            <Card className="shadow-sm">
              <Empty description="填写左侧参数后点击「试算」" />
            </Card>
          ) : (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              {!fromCard && (
                <Alert
                  type="warning" showIcon
                  message="未命中价卡，以下为占位估算"
                  description={result.fallbackReason || '请检查承运商、发货仓与邮编是否在价卡的分区表内。'}
                />
              )}
              {result.quoteOnRequest && (
                <Alert type="warning" showIcon message="该重量段为面议价" description="超出价卡最高重量档，需人工报价——系统不会按 0 计费。" />
              )}

              <Card className="shadow-sm">
                <Row gutter={16}>
                  <Col span={8}>
                    <Statistic
                      title="预估运费"
                      value={result.estimatedFee ?? '—'}
                      precision={result.estimatedFee === null ? undefined : 2}
                      prefix={result.estimatedFee === null ? undefined : result.currency}
                    />
                  </Col>
                  <Col span={8}>
                    <Statistic title="计费重量" value={result.chargeableWeight} suffix="kg" />
                  </Col>
                  <Col span={8}>
                    <Statistic
                      title="标准价"
                      value={rc && rc.discountRatio !== 1 && rc.listUnitPrice !== null ? rc.listUnitPrice : '—'}
                      valueStyle={{ color: '#999' }}
                    />
                  </Col>
                </Row>
              </Card>

              <Card title="计费明细" className="shadow-sm" size="small">
                <Table
                  rowKey="item" size="small" pagination={false}
                  columns={columns} dataSource={rows}
                />
              </Card>

              <Card title="计费依据" className="shadow-sm" size="small">
                <Descriptions size="small" column={2} bordered>
                  <Descriptions.Item label="实重合计">{result.totalWeight} kg</Descriptions.Item>
                  <Descriptions.Item label="体积重">{result.volumetricWeight} kg</Descriptions.Item>
                  <Descriptions.Item label="计费依据" span={2}>
                    {result.chargeableBasis === 'VOLUMETRIC'
                      ? <Tag color="orange">按体积重（体积重 &gt; 实重）</Tag>
                      : <Tag color="green">按实重</Tag>}
                    <span className="text-xs text-slate-400 ml-2">体积重 = 长×宽×高 ÷ 5000</span>
                  </Descriptions.Item>
                  {fromCard && (
                    <>
                      <Descriptions.Item label="命中价卡" span={2}>{rc.name}</Descriptions.Item>
                      <Descriptions.Item label="价格来源">
                        {rc.resolvedFrom === 'CUSTOMER' ? <Tag color="blue">客户专属</Tag> : <Tag>默认挂牌价</Tag>}
                      </Descriptions.Item>
                      <Descriptions.Item label="折扣系数">
                        {rc.discountRatio === 1 ? '标准价' : `${rc.discountRatio}（${Math.round((1 - rc.discountRatio) * 100)}% 折让）`}
                      </Descriptions.Item>
                      <Descriptions.Item label="计费分区">{rc.zone}</Descriptions.Item>
                      <Descriptions.Item label="命中重量档">
                        {rc.band?.from ?? 0} – {rc.band?.to ?? '∞'}
                      </Descriptions.Item>
                      {rc.minFeeApplied && (
                        <Descriptions.Item label="提示" span={2}>
                          <Tag color="gold">已按最低收费计</Tag>
                          <span className="text-xs text-slate-400">最低收费不参与折扣</span>
                        </Descriptions.Item>
                      )}
                    </>
                  )}
                  <Descriptions.Item label="说明" span={2}>{result.details}</Descriptions.Item>
                </Descriptions>
              </Card>
            </Space>
          )}
        </Col>
      </Row>
    </PageContainer>
  );
};

export default FeeCalculator;
