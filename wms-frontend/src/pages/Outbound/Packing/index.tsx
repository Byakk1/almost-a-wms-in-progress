import React, { useState, useRef, useEffect } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import {
  Card, Row, Col, Input, Button, Table, Tag, Alert,
  Space, Select, Form, InputNumber, Divider, message,
  Steps, Descriptions, Badge
} from 'antd';
import {
  ScanOutlined, CheckCircleOutlined, BoxPlotOutlined,
  PrinterOutlined, ArrowLeftOutlined, TruckOutlined,
  ScissorOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const { Option } = Select;

interface PackingOrderItem {
  sku: string;
  productName: string;
  requiredQty: number;
  scannedQty: number;
  status: 'PENDING' | 'DONE' | 'OVER';
}

// Mock order data (normally loaded by order number)
const MOCK_ORDER: {
  orderNo: string;
  customerName: string;
  destination: string;
  items: PackingOrderItem[];
} = {
  orderNo: 'ORD-20260302-001',
  customerName: 'Global E-commerce Ltd.',
  destination: 'US - Los Angeles',
  items: [
    { sku: 'SKU-A001', productName: 'iPhone 15 Pro 手机壳', requiredQty: 3, scannedQty: 0, status: 'PENDING' },
    { sku: 'SKU-B002', productName: '无线蓝牙耳机 AirPods 兼容款', requiredQty: 1, scannedQty: 0, status: 'PENDING' },
    { sku: 'SKU-C003', productName: 'USB-C 快充线 1m', requiredQty: 2, scannedQty: 0, status: 'PENDING' },
  ],
};

// Barcode → SKU map
const BARCODE_SKU_MAP: Record<string, string> = {
  'SF123456789': 'SKU-A001',
  'SF123456790': 'SKU-A001',
  'SF123456791': 'SKU-A001',
  'JD987654321': 'SKU-B002',
  'YT556677889': 'SKU-C003',
  'YT556677890': 'SKU-C003',
};

const COURIERS = [
  { label: 'FedEx 国际快递', value: 'FEDEX' },
  { label: 'UPS 标准', value: 'UPS' },
  { label: 'DHL Express', value: 'DHL' },
  { label: '美森快船', value: 'MAESK' },
  { label: '盐田港快船', value: 'YANTIAN' },
];

const PACKAGE_TYPES = [
  { label: '小箱 (30×20×15cm)', value: 'S' },
  { label: '中箱 (40×30×25cm)', value: 'M' },
  { label: '大箱 (60×40×35cm)', value: 'L' },
  { label: '特大箱 (80×60×50cm)', value: 'XL' },
  { label: '自定义', value: 'CUSTOM' },
];

const PackingWorkbench: React.FC = () => {
  const navigate = useNavigate();
  const scanRef = useRef<any>(null);
  const [form] = Form.useForm();

  const [currentStep, setCurrentStep] = useState(0); // 0: scan, 1: package info, 2: done
  const [orderItems, setOrderItems] = useState<PackingOrderItem[]>(MOCK_ORDER.items);
  const [scanValue, setScanValue] = useState('');
  const [lastScanStatus, setLastScanStatus] = useState<'idle' | 'ok' | 'error' | 'over'>('idle');
  const [lastScanMsg, setLastScanMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (currentStep === 0) scanRef.current?.focus();
  }, [currentStep]);

  const allDone = orderItems.every((i) => i.status === 'DONE');
  const hasOver = orderItems.some((i) => i.status === 'OVER');

  const handleScan = (barcode: string) => {
    const trimmed = barcode.trim();
    if (!trimmed) return;

    const sku = BARCODE_SKU_MAP[trimmed];
    if (!sku) {
      setLastScanStatus('error');
      setLastScanMsg(`❌ 未知条码：${trimmed}`);
      message.error(`未识别的条码：${trimmed}`);
      setScanValue('');
      return;
    }

    const itemIndex = orderItems.findIndex((i) => i.sku === sku);
    if (itemIndex === -1) {
      setLastScanStatus('error');
      setLastScanMsg(`⚠️ 该商品 (${sku}) 不在当前订单中！`);
      setScanValue('');
      return;
    }

    const item = orderItems[itemIndex];
    if (item.scannedQty >= item.requiredQty) {
      setLastScanStatus('over');
      setLastScanMsg(`🚨 超量！${item.productName} 已达到 ${item.requiredQty} 件要求，请勿多扫`);
      message.error(`超量扫描：${item.productName}`);
      setScanValue('');
      return;
    }

    const newQty = item.scannedQty + 1;
    const newStatus: PackingOrderItem['status'] = newQty >= item.requiredQty ? 'DONE' : 'PENDING';
    const updated = [...orderItems];
    updated[itemIndex] = { ...item, scannedQty: newQty, status: newStatus };
    setOrderItems(updated);

    const msg = newStatus === 'DONE'
      ? `✅ ${item.productName} 已完成 (${newQty}/${item.requiredQty})`
      : `📦 ${item.productName}：${newQty}/${item.requiredQty}`;
    setLastScanStatus('ok');
    setLastScanMsg(msg);
    setScanValue('');
  };

  const handlePackingSubmit = async () => {
    const values = form.getFieldsValue();
    if (!values.courier || !values.packageType || !values.weight) {
      message.error('请填写完整的包材和重量信息');
      return;
    }
    setIsSubmitting(true);
    await new Promise((r) => setTimeout(r, 1500));
    setIsSubmitting(false);
    setCurrentStep(2);
    message.success('打包完成！面单已生成');
  };

  const alertColorMap = {
    ok: 'success' as const,
    error: 'error' as const,
    over: 'error' as const,
    idle: 'info' as const,
  };

  const itemColumns = [
    { title: 'SKU', dataIndex: 'sku', width: 110 },
    { title: '商品名称', dataIndex: 'productName', ellipsis: true },
    {
      title: '要求数量',
      dataIndex: 'requiredQty',
      width: 90,
      render: (v: number) => <span className="font-bold">{v}</span>,
    },
    {
      title: '已扫数量',
      dataIndex: 'scannedQty',
      width: 90,
      render: (v: number, record: PackingOrderItem) => (
        <span className={v >= record.requiredQty ? 'text-green-600 font-bold' : 'text-orange-500 font-bold'}>{v}</span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => {
        if (v === 'DONE') return <Tag color="success" icon={<CheckCircleOutlined />}>已完成</Tag>;
        if (v === 'OVER') return <Tag color="error">超量</Tag>;
        return <Tag color="default">待扫描</Tag>;
      },
    },
  ];

  return (
    <PageContainer
      header={{
        title: '按单打包工作台',
        subTitle: `订单：${MOCK_ORDER.orderNo}`,
        extra: [
          <Button key="back" icon={<ArrowLeftOutlined />} onClick={() => navigate('/outbound/picking')}>
            返回列表
          </Button>,
        ],
      }}
    >
      {/* Order Info Banner */}
      <Card size="small" className="mb-4 bg-slate-50 border-slate-200">
        <Descriptions column={{ xs: 1, sm: 2, md: 4 }} size="small">
          <Descriptions.Item label="订单号"><strong>{MOCK_ORDER.orderNo}</strong></Descriptions.Item>
          <Descriptions.Item label="客户">{MOCK_ORDER.customerName}</Descriptions.Item>
          <Descriptions.Item label="目的地">
            <Tag color="blue" icon={<TruckOutlined />}>{MOCK_ORDER.destination}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="进度">
            <Badge
              count={`${orderItems.filter(i => i.status === 'DONE').length}/${orderItems.length}`}
              style={{ backgroundColor: allDone ? '#10b981' : '#D23148' }}
            />
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* Steps */}
      <Steps
        current={currentStep}
        className="mb-6"
        items={[
          { title: '扫描核验商品', icon: <ScanOutlined /> },
          { title: '填写包材与重量', icon: <BoxPlotOutlined /> },
          { title: '打印面单', icon: <PrinterOutlined /> },
        ]}
      />

      {/* Step 0: Scan */}
      {currentStep === 0 && (
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={8}>
            <Card
              title={<Space><ScanOutlined style={{ color: '#D23148' }} /><span>扫码验货</span></Space>}
              className="shadow-sm"
              style={{ position: 'sticky', top: 80 }}
            >
              <Input
                ref={scanRef}
                size="large"
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                onPressEnter={() => handleScan(scanValue)}
                placeholder="扫描商品条码 / Enter 确认"
                prefix={<ScanOutlined className="text-gray-400" />}
                autoFocus
                allowClear
                style={{ fontSize: 16 }}
              />

              {lastScanStatus !== 'idle' && (
                <Alert
                  className="mt-3 rounded-lg"
                  type={alertColorMap[lastScanStatus]}
                  message={lastScanMsg}
                  showIcon
                />
              )}

              <Divider />

              <div className="text-center py-2">
                <div className={`text-4xl font-bold ${allDone ? 'text-green-500' : 'text-primary'}`}>
                  {orderItems.filter(i => i.status === 'DONE').length}/{orderItems.length}
                </div>
                <div className="text-gray-400 text-sm mt-1">SKU 完成进度</div>
              </div>

              {hasOver && (
                <Alert type="error" message="存在超量商品，请重新检查！" showIcon className="mb-3" />
              )}

              <Button
                type="primary"
                block
                size="large"
                disabled={!allDone || hasOver}
                onClick={() => setCurrentStep(1)}
                style={{ backgroundColor: allDone && !hasOver ? '#D23148' : undefined, height: 48, marginTop: 12 }}
                icon={<BoxPlotOutlined />}
              >
                {allDone ? '核验完成，进入打包' : '请继续扫描商品'}
              </Button>
            </Card>
          </Col>

          <Col xs={24} lg={16}>
            <Card
              title={<Space><ScissorOutlined style={{ color: '#10b981' }} /><span>订单商品清单</span></Space>}
              className="shadow-sm"
            >
              <Table
                dataSource={orderItems}
                columns={itemColumns}
                rowKey="sku"
                size="middle"
                pagination={false}
                rowClassName={(record) =>
                  record.status === 'DONE' ? 'bg-green-50' : record.status === 'OVER' ? 'bg-red-50' : ''
                }
              />
              <Alert
                className="mt-4"
                type="info"
                message="操作提示：扫描商品条码逐件核验，所有商品达到要求数量后方可进入打包步骤。超量扫描会触发红色警告。"
                showIcon
              />
            </Card>
          </Col>
        </Row>
      )}

      {/* Step 1: Package Info */}
      {currentStep === 1 && (
        <Row gutter={16} justify="center">
          <Col xs={24} md={18} lg={14}>
            <Card
              title={<Space><BoxPlotOutlined style={{ color: '#D23148' }} /><span>包材信息 & 重量</span></Space>}
              className="shadow-sm"
            >
              <Form form={form} layout="vertical" size="large">
                <Form.Item label="物流渠道" name="courier" rules={[{ required: true }]}>
                  <Select placeholder="请选择物流渠道" suffixIcon={<TruckOutlined />}>
                    {COURIERS.map((c) => (
                      <Option key={c.value} value={c.value}>{c.label}</Option>
                    ))}
                  </Select>
                </Form.Item>

                <Form.Item label="包材规格" name="packageType" rules={[{ required: true }]}>
                  <Select placeholder="请选择纸箱规格">
                    {PACKAGE_TYPES.map((p) => (
                      <Option key={p.value} value={p.value}>{p.label}</Option>
                    ))}
                  </Select>
                </Form.Item>

                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="毛重 (kg)" name="weight" rules={[{ required: true }]}>
                      <InputNumber min={0.1} max={99} step={0.1} precision={1} placeholder="0.0" style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="计费重量 (kg)" name="chargeableWeight">
                      <InputNumber min={0.1} max={99} step={0.1} precision={1} placeholder="自动计算" style={{ width: '100%' }} disabled />
                    </Form.Item>
                  </Col>
                </Row>

                <Form.Item label="备注" name="remarks">
                  <Input.TextArea rows={2} placeholder="可选备注（如: FRAGILE 易碎品）" />
                </Form.Item>

                <Divider />

                <Space className="w-full justify-between">
                  <Button size="large" onClick={() => setCurrentStep(0)} icon={<ArrowLeftOutlined />}>
                    返回重新扫描
                  </Button>
                  <Button
                    type="primary"
                    size="large"
                    loading={isSubmitting}
                    onClick={handlePackingSubmit}
                    icon={<PrinterOutlined />}
                    style={{ backgroundColor: '#D23148', minWidth: 160 }}
                  >
                    确认打包 & 打印面单
                  </Button>
                </Space>
              </Form>
            </Card>
          </Col>
        </Row>
      )}

      {/* Step 2: Done */}
      {currentStep === 2 && (
        <Row justify="center">
          <Col xs={24} md={16} lg={12}>
            <Card className="shadow-sm text-center py-8">
              <CheckCircleOutlined style={{ fontSize: 72, color: '#10b981' }} />
              <h2 className="text-2xl font-bold mt-4 text-gray-800">打包完成！</h2>
              <p className="text-gray-500 mb-6">面单已打印，请粘贴到包裹外侧并放置到待发区</p>
              <Space size="large">
                <Button icon={<PrinterOutlined />} size="large">
                  重新打印面单
                </Button>
                <Button
                  type="primary"
                  size="large"
                  onClick={() => navigate('/outbound/picking')}
                  style={{ backgroundColor: '#D23148' }}
                >
                  处理下一单
                </Button>
              </Space>
            </Card>
          </Col>
        </Row>
      )}
    </PageContainer>
  );
};

export default PackingWorkbench;
