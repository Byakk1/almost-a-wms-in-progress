import React, { useState } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import {
  Card, Row, Col, Form, Select, InputNumber, Button,
  Divider, Table, Space, Alert, Statistic
} from 'antd';
import { CalculatorOutlined, ReloadOutlined, TruckOutlined } from '@ant-design/icons';

const { Option } = Select;

interface FeeResult {
  item: string;
  qty: number | string;
  unitPrice: number;
  amount: number;
  note?: string;
}

const ZONES: Record<string, { label: string; baseRate: number }> = {
  US: { label: '美国 (US)', baseRate: 38 },
  UK: { label: '英国 (UK)', baseRate: 42 },
  DE: { label: '德国 (DE)', baseRate: 35 },
  AU: { label: '澳大利亚 (AU)', baseRate: 45 },
  CA: { label: '加拿大 (CA)', baseRate: 40 },
  JP: { label: '日本 (JP)', baseRate: 30 },
};

const COURIERS: Record<string, { label: string; multiplier: number }> = {
  FEDEX: { label: 'FedEx Express', multiplier: 1.3 },
  DHL: { label: 'DHL Express', multiplier: 1.25 },
  UPS: { label: 'UPS Standard', multiplier: 1.0 },
  EMS: { label: 'EMS 国际小包', multiplier: 0.75 },
  SEA: { label: '海运整柜 FCL', multiplier: 0.35 },
};

const SURCHARGES = [
  { key: 'fuel', label: '燃油附加费', rate: 0.12 },
  { key: 'remote', label: '偏远地区附加', rate: 0.15 },
  { key: 'residential', label: '住宅派送附加', rate: 0.08 },
];

const FeeCalculator: React.FC = () => {
  const [form] = Form.useForm();
  const [results, setResults] = useState<FeeResult[] | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [totalFee, setTotalFee] = useState(0);

  const handleCalculate = async () => {
    const values = form.getFieldsValue();
    const { zone, courier, weight, length, width, height, pieces, surcharges } = values;

    if (!zone || !courier || !weight) {
      form.validateFields();
      return;
    }

    setCalculating(true);
    await new Promise((r) => setTimeout(r, 800));

    const zoneInfo = ZONES[zone];
    const courierInfo = COURIERS[courier];

    // Calculate volumetric weight (cm→kg, divisor 5000)
    const volWeight = length && width && height ? (length * width * height) / 5000 : 0;
    const chargeableWeight = Math.max(weight, volWeight);

    const freightBase = chargeableWeight * zoneInfo.baseRate * courierInfo.multiplier;
    const rows: FeeResult[] = [
      {
        item: '基础运费',
        qty: `${chargeableWeight.toFixed(2)} kg`,
        unitPrice: zoneInfo.baseRate * courierInfo.multiplier,
        amount: freightBase,
        note: volWeight > weight ? `计泡重 ${volWeight.toFixed(2)} kg` : `计实重`,
      },
    ];

    let surcharge = 0;
    if (surcharges?.includes('fuel')) {
      const amt = freightBase * SURCHARGES[0].rate;
      surcharge += amt;
      rows.push({ item: '燃油附加费', qty: '12%', unitPrice: freightBase, amount: amt });
    }
    if (surcharges?.includes('remote')) {
      const amt = freightBase * SURCHARGES[1].rate;
      surcharge += amt;
      rows.push({ item: '偏远地区附加', qty: '15%', unitPrice: freightBase, amount: amt });
    }
    if (surcharges?.includes('residential')) {
      const amt = freightBase * SURCHARGES[2].rate;
      surcharge += amt;
      rows.push({ item: '住宅派送附加', qty: '8%', unitPrice: freightBase, amount: amt });
    }

    // Storage fee
    if (pieces && pieces > 0) {
      const storageAmt = pieces * 0.5;
      rows.push({ item: '仓储操作费', qty: `${pieces} 件`, unitPrice: 0.5, amount: storageAmt, note: '0.5元/件' });
    }

    const total = rows.reduce((s, r) => s + r.amount, 0);
    setResults(rows);
    setTotalFee(total);
    setCalculating(false);
  };

  const columns = [
    { title: '费用项', dataIndex: 'item', width: 150 },
    { title: '计费基数', dataIndex: 'qty', width: 120 },
    {
      title: '单价',
      dataIndex: 'unitPrice',
      width: 100,
      render: (v: number) => `¥${v.toFixed(2)}`,
    },
    {
      title: '金额',
      dataIndex: 'amount',
      width: 110,
      render: (v: number) => <span className="font-bold text-primary">¥{v.toFixed(2)}</span>,
    },
    {
      title: '备注',
      dataIndex: 'note',
      render: (v?: string) => v ? <span className="text-xs text-slate-400">{v}</span> : '-',
    },
  ];

  return (
    <PageContainer
      header={{
        title: '费用试算工具',
        subTitle: '多维度运费组合计算，帮助客户预估出货成本',
      }}
    >
      <Row gutter={[16, 16]}>
        {/* Left: Input Form */}
        <Col xs={24} lg={10}>
          <Card
            title={<Space><CalculatorOutlined style={{ color: '#D23148' }} /><span>计费参数</span></Space>}
            className="shadow-sm"
          >
            <Form form={form} layout="vertical" size="large">
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label="目的国/区" name="zone" rules={[{ required: true, message: '请选择目的地' }]}>
                    <Select placeholder="选择目的地" suffixIcon={<TruckOutlined />}>
                      {Object.entries(ZONES).map(([k, v]) => (
                        <Option key={k} value={k}>{v.label}</Option>
                      ))}
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="物流渠道" name="courier" rules={[{ required: true, message: '请选择渠道' }]}>
                    <Select placeholder="选择渠道">
                      {Object.entries(COURIERS).map(([k, v]) => (
                        <Option key={k} value={k}>{v.label}</Option>
                      ))}
                    </Select>
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label="实重 (kg)" name="weight" rules={[{ required: true }]}>
                    <InputNumber min={0.1} step={0.1} precision={2} style={{ width: '100%' }} placeholder="0.00" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="件数" name="pieces">
                    <InputNumber min={1} style={{ width: '100%' }} placeholder="1" />
                  </Form.Item>
                </Col>
              </Row>

              <Divider orientation="left" plain>体积尺寸（可选）</Divider>
              <Row gutter={8}>
                <Col span={8}>
                  <Form.Item label="长 (cm)" name="length">
                    <InputNumber min={1} style={{ width: '100%' }} placeholder="L" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="宽 (cm)" name="width">
                    <InputNumber min={1} style={{ width: '100%' }} placeholder="W" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="高 (cm)" name="height">
                    <InputNumber min={1} style={{ width: '100%' }} placeholder="H" />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item label="附加费选项" name="surcharges">
                <Select mode="multiple" placeholder="可选：附加费类型">
                  {SURCHARGES.map((s) => (
                    <Option key={s.key} value={s.key}>{s.label} ({(s.rate * 100).toFixed(0)}%)</Option>
                  ))}
                </Select>
              </Form.Item>

              <Space className="w-full" direction="vertical">
                <Button
                  type="primary"
                  block
                  size="large"
                  icon={<CalculatorOutlined />}
                  loading={calculating}
                  onClick={handleCalculate}
                  style={{ backgroundColor: '#D23148', height: 48 }}
                >
                  立即试算
                </Button>
                <Button
                  block
                  icon={<ReloadOutlined />}
                  onClick={() => { form.resetFields(); setResults(null); }}
                >
                  重置
                </Button>
              </Space>
            </Form>
          </Card>
        </Col>

        {/* Right: Results */}
        <Col xs={24} lg={14}>
          <Card
            title={<Space><CalculatorOutlined style={{ color: '#10b981' }} /><span>计费明细</span></Space>}
            className="shadow-sm"
          >
            {results === null ? (
              <div className="text-center py-16 text-gray-400">
                <CalculatorOutlined style={{ fontSize: 56, opacity: 0.25 }} />
                <p className="mt-3">填写参数后点击「立即试算」查看费用明细</p>
              </div>
            ) : (
              <>
                <Table
                  dataSource={results}
                  columns={columns}
                  rowKey="item"
                  size="middle"
                  pagination={false}
                  summary={() => (
                    <tr className="bg-slate-50 font-bold">
                      <td colSpan={3} className="px-4 py-3 text-right text-slate-700">合计</td>
                      <td className="px-4 py-3">
                        <span className="text-xl font-bold text-primary">¥{totalFee.toFixed(2)}</span>
                      </td>
                      <td />
                    </tr>
                  )}
                />
                <Alert
                  className="mt-4"
                  type="info"
                  message="说明：以上为预估金额，实际费用以出货后系统生成账单为准，重量以实际称重为准。"
                  showIcon
                />
                <Row gutter={16} className="mt-4">
                  <Col span={8}>
                    <Statistic
                      title="预计运费"
                      value={`¥${totalFee.toFixed(2)}`}
                      valueStyle={{ color: '#D23148', fontSize: 20 }}
                    />
                  </Col>
                  <Col span={8}>
                    <Statistic
                      title="费用项目数"
                      value={results.length}
                      valueStyle={{ fontSize: 20 }}
                    />
                  </Col>
                  <Col span={8}>
                    <Button
                      type="primary"
                      style={{ backgroundColor: '#D23148', marginTop: 20 }}
                      onClick={() => alert('已复制费用明细到剪贴板')}
                    >
                      复制报价
                    </Button>
                  </Col>
                </Row>
              </>
            )}
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
};

export default FeeCalculator;
