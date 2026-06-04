import React, { useState, useRef, useEffect } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import {
  Card, Row, Col, Input, Button, Table, Tag, Alert,
  Space, Statistic, Divider, message, Badge, Result
} from 'antd';
import {
  ScanOutlined, CheckCircleOutlined, SendOutlined,
  ArrowLeftOutlined, RocketOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

interface SignoutItem {
  key: string;
  trackingNo: string;
  orderNo: string;
  customerName: string;
  sku: string;
  weight: number;
  courier: string;
  destination: string;
  scannedAt: string;
  status: 'OK' | 'DUPLICATE' | 'NOT_FOUND';
}

const MOCK_ORDERS: Record<string, Omit<SignoutItem, 'key' | 'scannedAt' | 'status'>> = {
  'SF1234500001': { trackingNo: 'SF1234500001', orderNo: 'ORD-260304-001', customerName: '深圳大卖贸易', sku: 'SKU-A001', weight: 0.85, courier: 'SF Express', destination: 'US' },
  'JD9876500002': { trackingNo: 'JD9876500002', orderNo: 'ORD-260304-002', customerName: 'Global E-commerce', sku: 'SKU-B002', weight: 1.20, courier: 'JD Logistics', destination: 'UK' },
  'YT3344400003': { trackingNo: 'YT3344400003', orderNo: 'ORD-260304-003', customerName: '跨境优品', sku: 'SKU-C003', weight: 0.42, courier: 'YTO Express', destination: 'DE' },
  'EMS9988700004': { trackingNo: 'EMS9988700004', orderNo: 'ORD-260304-004', customerName: '欧洲专线', sku: 'SKU-D004', weight: 2.10, courier: 'EMS', destination: 'FR' },
  'UPS5566000005': { trackingNo: 'UPS5566000005', orderNo: 'ORD-260304-005', customerName: '深圳大卖贸易', sku: 'SKU-E005', weight: 0.65, courier: 'UPS', destination: 'AU' },
};

const OrderSignout: React.FC = () => {
  const navigate = useNavigate();
  const scanRef = useRef<any>(null);
  const [scanValue, setScanValue] = useState('');
  const [items, setItems] = useState<SignoutItem[]>([]);
  const [lastStatus, setLastStatus] = useState<'idle' | 'ok' | 'error' | 'dup'>('idle');
  const [lastMsg, setLastMsg] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { scanRef.current?.focus(); }, []);

  const handleScan = (val: string) => {
    const v = val.trim();
    if (!v) return;
    const order = MOCK_ORDERS[v];
    if (!order) {
      setLastStatus('error');
      setLastMsg(`❌ 未知面单号：${v}，无对应订单`);
      message.error('面单号未识别');
      setScanValue('');
      return;
    }
    const dup = items.find((i) => i.trackingNo === v);
    if (dup) {
      setLastStatus('dup');
      setLastMsg(`⚠️ 重复扫描：${v} 已在签出列表中`);
      setScanValue('');
      return;
    }
    const newItem: SignoutItem = {
      ...order,
      key: `${v}-${Date.now()}`,
      scannedAt: new Date().toLocaleTimeString('zh-CN'),
      status: 'OK',
    };
    setItems((prev) => [newItem, ...prev]);
    setLastStatus('ok');
    setLastMsg(`✅ ${order.orderNo} — ${order.customerName} — ${order.courier} → ${order.destination}`);
    setScanValue('');
  };

  const handleSubmit = async () => {
    if (items.length === 0) { message.warning('请先扫描包裹'); return; }
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 1500));
    setSubmitting(false);
    setSubmitted(true);
  };

  const totalWeight = items.reduce((s, i) => s + i.weight, 0);
  const alertType: Record<string, 'success' | 'error' | 'warning' | 'info'> = { ok: 'success', error: 'error', dup: 'warning', idle: 'info' };

  const columns = [
    {
      title: '面单号',
      dataIndex: 'trackingNo',
      width: 150,
      render: (v: string) => <code className="text-xs bg-slate-100 px-1 rounded">{v}</code>,
    },
    { title: '订单号', dataIndex: 'orderNo', width: 150 },
    { title: '客户', dataIndex: 'customerName', ellipsis: true },
    { title: 'SKU', dataIndex: 'sku', width: 100 },
    { title: '重量(kg)', dataIndex: 'weight', width: 90 },
    { title: '物流渠道', dataIndex: 'courier', width: 120 },
    {
      title: '目的地',
      dataIndex: 'destination',
      width: 80,
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    { title: '扫描时间', dataIndex: 'scannedAt', width: 85 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      render: () => <Tag color="success" icon={<CheckCircleOutlined />}>已签出</Tag>,
    },
  ];

  if (submitted) {
    return (
      <PageContainer>
        <Result
          status="success"
          title={`本批次签出完成！共 ${items.length} 件，合计 ${totalWeight.toFixed(2)} kg`}
          subTitle="包裹状态已更新为已签出，物流跟踪即将开始"
          extra={[
            <Button key="new" type="primary" style={{ backgroundColor: '#D23148' }} onClick={() => { setItems([]); setSubmitted(false); setLastStatus('idle'); scanRef.current?.focus(); }}>
              继续签出下一批
            </Button>,
            <Button key="back" onClick={() => navigate('/outbound/shipment/main')}>返回出货管理</Button>,
          ]}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      header={{
        title: '订单签出控制台',
        subTitle: '扫描包裹面单条码，确认签出并推送物流轨迹',
        extra: [
          <Button key="back" icon={<ArrowLeftOutlined />} onClick={() => navigate('/outbound/picking')}>
            返回拣货列表
          </Button>,
        ],
      }}
    >
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Card
            title={<Space><ScanOutlined style={{ color: '#D23148' }} /><span>扫码签出</span></Space>}
            className="shadow-sm"
            style={{ position: 'sticky', top: 80 }}
          >
            <Input
              ref={scanRef}
              size="large"
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              onPressEnter={() => handleScan(scanValue)}
              placeholder="扫描包裹面单号 / Enter 确认"
              prefix={<ScanOutlined className="text-gray-400" />}
              autoFocus
              allowClear
              style={{ fontSize: 16 }}
            />
            {lastStatus !== 'idle' && (
              <Alert className="mt-3" type={alertType[lastStatus]} message={lastMsg} showIcon />
            )}
            <Divider />
            <Row gutter={16} className="text-center">
              <Col span={12}>
                <Statistic title="已签出件数" value={items.length} valueStyle={{ color: '#D23148', fontSize: 26 }} />
              </Col>
              <Col span={12}>
                <Statistic title="总重量(kg)" value={totalWeight.toFixed(2)} valueStyle={{ color: '#1e293b', fontSize: 26 }} />
              </Col>
            </Row>
            <Divider />
            <Button
              type="primary"
              block
              size="large"
              icon={<SendOutlined />}
              loading={submitting}
              disabled={items.length === 0}
              onClick={handleSubmit}
              style={{ backgroundColor: '#D23148', height: 48 }}
            >
              完成签出 ({items.length} 件)
            </Button>
          </Card>
        </Col>

        <Col xs={24} lg={16}>
          <Card
            title={
              <Space>
                <RocketOutlined style={{ color: '#D23148' }} />
                <span>本批签出列表</span>
                <Badge count={items.length} style={{ backgroundColor: '#10b981' }} />
              </Space>
            }
            extra={items.length > 0 && <Button type="text" danger size="small" onClick={() => { setItems([]); setLastStatus('idle'); }}>清空</Button>}
            className="shadow-sm"
          >
            {items.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <SendOutlined style={{ fontSize: 48, opacity: 0.25 }} />
                <p className="mt-3">请扫描包裹面单号开始签出</p>
                <p className="text-xs mt-1">测试面单号：SF1234500001 / JD9876500002 / YT3344400003</p>
              </div>
            ) : (
              <Table dataSource={items} columns={columns} size="small" rowKey="key" pagination={false} scroll={{ y: 480 }} />
            )}
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
};

export default OrderSignout;
