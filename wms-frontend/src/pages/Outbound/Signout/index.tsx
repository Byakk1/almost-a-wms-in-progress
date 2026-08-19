import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import {
  Card, Row, Col, Input, Button, Table, Tag, Alert,
  Space, Statistic, Divider, message, Badge, Result, theme, Spin,
} from 'antd';
import {
  ScanOutlined, CheckCircleOutlined, SendOutlined,
  ArrowLeftOutlined, RocketOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import request from '../../../utils/request';
import { useCan } from '../../../router/permissions';

// Row from GET /outbound-orders — the service spreads the whole OutboundOrder,
// so the fulfillment fields (trackingNo / carrier / weights) come through.
interface OutboundRow {
  id: string;
  orderNo: string;
  customerName: string;
  status: string;
  trackingNo: string | null;
  carrier: string | null;
  shipToCountry?: string | null;
  packageActualWeight?: string | number | null;
  packageBillingWeight?: string | number | null;
  totalWeightKg?: string | number | null;
}

interface SignoutItem {
  key: string;
  id: string;
  trackingNo: string;
  orderNo: string;
  customerName: string;
  carrier: string;
  weight: number;
  scannedAt: string;
}

// Decimal columns arrive as strings over JSON.
const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const OrderSignout: React.FC = () => {
  const navigate = useNavigate();
  const scanRef = useRef<any>(null);
  const { token } = theme.useToken();
  const canSign = useCan('outbound.sign'); // POST /outbound-orders/:id/sign — admin only

  const [scanValue, setScanValue] = useState('');
  const [items, setItems] = useState<SignoutItem[]>([]);
  const [lastStatus, setLastStatus] = useState<'idle' | 'ok' | 'error' | 'dup'>('idle');
  const [lastMsg, setLastMsg] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [signedCount, setSignedCount] = useState(0);

  // Only SHIPPED orders can be signed (OUTBOUND_TRANSITIONS: SHIPPED -> SIGNED),
  // and the list endpoint has no trackingNo filter — so the signable queue is
  // fetched once and scans are matched against it in memory.
  const [queue, setQueue] = useState<OutboundRow[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(false);

  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    try {
      const res: any = await request.get('/outbound-orders', {
        params: { status: 'SHIPPED', pageSize: 200 },
      });
      setQueue(res?.data ?? []);
    } catch {
      // request.ts interceptor surfaces errors
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
    scanRef.current?.focus();
  }, [loadQueue]);

  const handleScan = (val: string) => {
    const v = val.trim();
    if (!v) return;

    if (items.find((i) => i.trackingNo === v)) {
      setLastStatus('dup');
      setLastMsg(`⚠️ 重复扫描：${v} 已在签出列表中`);
      setScanValue('');
      return;
    }

    const order = queue.find((o) => o.trackingNo === v);
    if (!order) {
      setLastStatus('error');
      setLastMsg(`❌ 未匹配到待签出订单：${v}（仅「已发货」状态可签出）`);
      message.error('面单号未识别或该订单不可签出');
      setScanValue('');
      return;
    }

    const weight = num(order.packageBillingWeight) || num(order.packageActualWeight) || num(order.totalWeightKg);
    setItems((prev) => [
      {
        key: order.id,
        id: order.id,
        trackingNo: v,
        orderNo: order.orderNo,
        customerName: order.customerName,
        carrier: order.carrier || '—',
        weight,
        scannedAt: new Date().toLocaleTimeString('zh-CN'),
      },
      ...prev,
    ]);
    setLastStatus('ok');
    setLastMsg(`✅ ${order.orderNo} — ${order.customerName} — ${order.carrier || '未指定承运商'}`);
    setScanValue('');
  };

  const handleSubmit = async () => {
    if (items.length === 0) {
      message.warning('请先扫描包裹');
      return;
    }
    setSubmitting(true);
    // The endpoint signs one order at a time, so the batch is submitted
    // sequentially and the result reports how many actually succeeded.
    let ok = 0;
    for (const it of items) {
      try {
        await request.post(`/outbound-orders/${it.id}/sign`);
        ok += 1;
      } catch {
        // interceptor already surfaced the reason for this order
      }
    }
    setSignedCount(ok);
    setSubmitting(false);
    if (ok > 0) {
      setSubmitted(true);
      loadQueue();
    }
  };

  const totalWeight = items.reduce((s, i) => s + i.weight, 0);
  const alertType: Record<string, 'success' | 'error' | 'warning' | 'info'> = {
    ok: 'success', error: 'error', dup: 'warning', idle: 'info',
  };

  const columns = [
    {
      title: '面单号', dataIndex: 'trackingNo', width: 190,
      render: (v: string) => <code className="text-xs bg-slate-100 px-1 rounded">{v}</code>,
    },
    { title: '订单号', dataIndex: 'orderNo', width: 170 },
    { title: '客户', dataIndex: 'customerName', ellipsis: true },
    { title: '承运商', dataIndex: 'carrier', width: 130 },
    {
      title: '重量(kg)', dataIndex: 'weight', width: 100,
      render: (v: number) => (v ? v.toFixed(3) : '—'),
    },
    { title: '扫描时间', dataIndex: 'scannedAt', width: 100 },
    {
      title: '状态', width: 90,
      render: () => <Tag color="processing" icon={<CheckCircleOutlined />}>待提交</Tag>,
    },
  ];

  if (submitted) {
    return (
      <PageContainer>
        <Result
          status="success"
          title={`本批次签出完成！成功 ${signedCount} / ${items.length} 件，合计 ${totalWeight.toFixed(2)} kg`}
          subTitle="订单状态已更新为已签出（SIGNED）"
          extra={[
            <Button
              key="new"
              type="primary"
              onClick={() => {
                setItems([]);
                setSubmitted(false);
                setSignedCount(0);
                setLastStatus('idle');
                loadQueue();
                scanRef.current?.focus();
              }}
            >
              继续签出下一批
            </Button>,
            <Button key="back" onClick={() => navigate('/outbound/picking')}>返回拣货列表</Button>,
          ]}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      header={{
        title: '订单签出控制台',
        subTitle: '扫描包裹面单号，确认物流签出（仅「已发货」订单可签出）',
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
            title={<Space><ScanOutlined style={{ color: token.colorPrimary }} /><span>扫码签出</span></Space>}
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
                <Statistic title="本批已扫" value={items.length} valueStyle={{ color: token.colorPrimary, fontSize: 26 }} />
              </Col>
              <Col span={12}>
                <Statistic title="总重量(kg)" value={totalWeight.toFixed(2)} valueStyle={{ fontSize: 26 }} />
              </Col>
            </Row>
            <Divider />
            <div className="mb-3 text-center text-xs text-slate-400">
              <Spin spinning={loadingQueue} size="small">
                待签出队列：{queue.length} 单
              </Spin>
            </div>
            <Button
              type="primary"
              block
              size="large"
              icon={<SendOutlined />}
              loading={submitting}
              disabled={items.length === 0 || !canSign}
              onClick={handleSubmit}
              style={{ height: 48 }}
            >
              完成签出 ({items.length} 件)
            </Button>
            {!canSign && (
              <div className="mt-2 text-center text-xs text-slate-400">仅管理员可执行签出</div>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={16}>
          <Card
            title={
              <Space>
                <RocketOutlined style={{ color: token.colorPrimary }} />
                <span>本批签出列表</span>
                <Badge count={items.length} style={{ backgroundColor: token.colorSuccess }} />
              </Space>
            }
            extra={items.length > 0 && (
              <Button type="text" danger size="small" onClick={() => { setItems([]); setLastStatus('idle'); }}>
                清空
              </Button>
            )}
            className="shadow-sm"
          >
            {items.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <SendOutlined style={{ fontSize: 48, opacity: 0.25 }} />
                <p className="mt-3">请扫描包裹面单号开始签出</p>
                <p className="text-xs mt-1">
                  {queue.length === 0
                    ? '当前没有「已发货」状态的订单可供签出'
                    : `当前待签出 ${queue.length} 单，例如 ${queue[0]?.trackingNo ?? ''}`}
                </p>
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
