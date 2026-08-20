import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import {
  Card, Row, Col, Input, Button, Table, Tag, Alert, Select, Empty,
  Space, Statistic, Divider, message, Progress, theme,
} from 'antd';
import {
  ScanOutlined, CheckCircleOutlined, SaveOutlined,
  ArrowLeftOutlined, InboxOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import request from '../../../utils/request';
import { useCan } from '../../../router/permissions';

// GET /receiving-orders/:id returns the order with items -> product joined.
interface ReceivingItem {
  id: string;
  expectedQty: number;
  receivedQty: number;
  product: { id: string; sku: string; name: string; barcode: string | null };
}

interface ReceivingOrder {
  id: string;
  receivingNo: string;
  status: string;
  customer?: { name: string } | null;
  items: ReceivingItem[];
}

interface OrderOption {
  id: string;
  receivingNo: string;
  status: string;
  customer?: { name: string } | null;
}

// Only these two states accept a scan (receiving-orders.service.ts#receive).
const SCANNABLE = ['CHECKING', 'RECEIVING'];

const ReceivingWorkbench: React.FC = () => {
  const navigate = useNavigate();
  const scanRef = useRef<any>(null);
  const { token } = theme.useToken();
  const canReceive = useCan('receiving.receive');

  const [options, setOptions] = useState<OrderOption[]>([]);
  const [orderId, setOrderId] = useState<string>();
  const [order, setOrder] = useState<ReceivingOrder | null>(null);
  const [scanValue, setScanValue] = useState('');
  const [lastStatus, setLastStatus] = useState<'idle' | 'ok' | 'error' | 'warn'>('idle');
  const [lastMsg, setLastMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [completing, setCompleting] = useState(false);

  // The list endpoint filters by a single status, so the scannable queue is the
  // union of the two states that accept a scan.
  const loadOptions = useCallback(async () => {
    try {
      const results = await Promise.all(
        SCANNABLE.map((s) =>
          request.get('/receiving-orders', { params: { status: s, pageSize: 100 } }).catch(() => null),
        ),
      );
      const merged = results.flatMap((r: any) => r?.data ?? []);
      setOptions(merged);
    } catch {
      // request.ts interceptor surfaces errors
    }
  }, []);

  // Item quantities are re-read from the server after every scan — receivedQty is
  // owned by the backend (it enforces the over-receipt guard), never accumulated here.
  const loadOrder = useCallback(async (id: string) => {
    try {
      const res: any = await request.get(`/receiving-orders/${id}`);
      setOrder(res?.data ?? null);
    } catch {
      setOrder(null);
    }
  }, []);

  useEffect(() => {
    loadOptions();
    scanRef.current?.focus();
  }, [loadOptions]);

  useEffect(() => {
    if (orderId) loadOrder(orderId);
    else setOrder(null);
  }, [orderId, loadOrder]);

  const handleScan = async (val: string) => {
    const v = val.trim();
    if (!v) return;
    if (!order) {
      setLastStatus('error');
      setLastMsg('请先选择一张收货单');
      setScanValue('');
      return;
    }

    // The receive endpoint keys on SKU, so a scanned barcode is resolved to its
    // SKU against this order's items before the call.
    const hit = order.items.find(
      (i) => i.product.sku === v || (i.product.barcode && i.product.barcode === v),
    );
    if (!hit) {
      setLastStatus('error');
      setLastMsg(`❌ 该收货单中没有匹配的商品：${v}`);
      message.error('条码/SKU 不在本收货单内');
      setScanValue('');
      return;
    }

    setBusy(true);
    try {
      await request.post(`/receiving-orders/${order.id}/receive`, { sku: hit.product.sku, qty: 1 });
      setLastStatus('ok');
      setLastMsg(`✅ ${hit.product.name}（${hit.product.sku}）+1`);
      await loadOrder(order.id);
    } catch {
      // Interceptor already showed the server's reason (e.g. over-receipt).
      setLastStatus('warn');
      setLastMsg(`⚠️ ${hit.product.sku} 收货未成功，请查看提示`);
    } finally {
      setBusy(false);
      setScanValue('');
      scanRef.current?.focus();
    }
  };

  const handleComplete = async () => {
    if (!order) return;
    setCompleting(true);
    try {
      await request.post(`/receiving-orders/${order.id}/complete`);
      message.success(`收货单 ${order.receivingNo} 已完成收货`);
      await Promise.all([loadOptions(), loadOrder(order.id)]);
    } catch {
      // request.ts interceptor surfaces errors
    } finally {
      setCompleting(false);
    }
  };

  const totalExpected = order?.items.reduce((s, i) => s + i.expectedQty, 0) ?? 0;
  const totalReceived = order?.items.reduce((s, i) => s + i.receivedQty, 0) ?? 0;
  const allReceived = !!order && order.items.length > 0 && order.items.every((i) => i.receivedQty >= i.expectedQty);

  const alertType: Record<string, 'success' | 'error' | 'warning'> = {
    ok: 'success', error: 'error', warn: 'warning', idle: 'success',
  };

  const columns = [
    { title: 'SKU', dataIndex: ['product', 'sku'], width: 150,
      render: (v: string) => <code className="text-xs bg-slate-100 px-1 rounded">{v}</code> },
    { title: '商品名称', dataIndex: ['product', 'name'], ellipsis: true },
    { title: '条码', dataIndex: ['product', 'barcode'], width: 140, render: (v?: string) => v || '—' },
    { title: '预期', dataIndex: 'expectedQty', width: 70 },
    { title: '已收', dataIndex: 'receivedQty', width: 70,
      render: (v: number) => <span style={{ fontWeight: 600 }}>{v}</span> },
    {
      title: '进度', width: 150,
      render: (_: any, r: ReceivingItem) => (
        <Progress
          percent={r.expectedQty ? Math.round((r.receivedQty / r.expectedQty) * 100) : 0}
          size="small"
          status={r.receivedQty >= r.expectedQty ? 'success' : 'active'}
        />
      ),
    },
    {
      title: '状态', width: 90,
      render: (_: any, r: ReceivingItem) =>
        r.receivedQty >= r.expectedQty
          ? <Tag color="success" icon={<CheckCircleOutlined />}>已收齐</Tag>
          : <Tag color="processing">待收</Tag>,
    },
  ];

  return (
    <PageContainer
      header={{
        title: '收货操作工作台',
        subTitle: '选择收货单后扫描商品条码 / SKU，逐件登记入库',
        extra: [
          <Button key="back" icon={<ArrowLeftOutlined />} onClick={() => navigate('/inbound/receiving')}>
            返回列表
          </Button>,
        ],
      }}
    >
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Card
            title={<Space><ScanOutlined style={{ color: token.colorPrimary }} /><span>扫码收货</span></Space>}
            className="shadow-sm"
            style={{ position: 'sticky', top: 80 }}
          >
            <div className="mb-3">
              <div className="text-xs text-slate-500 mb-1">收货单（仅验收中 / 收货中可扫描）</div>
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder={options.length ? '选择收货单' : '当前没有可扫描的收货单'}
                style={{ width: '100%' }}
                value={orderId}
                onChange={(v) => { setOrderId(v); setLastStatus('idle'); }}
                options={options.map((o) => ({
                  value: o.id,
                  label: `${o.receivingNo} · ${o.customer?.name ?? '—'} · ${o.status}`,
                }))}
              />
            </div>

            <Input
              ref={scanRef}
              size="large"
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              onPressEnter={() => handleScan(scanValue)}
              placeholder="扫描条码 / SKU 后按 Enter"
              prefix={<ScanOutlined className="text-gray-400" />}
              disabled={!order || busy || !canReceive}
              allowClear
              style={{ fontSize: 16 }}
            />
            {lastStatus !== 'idle' && (
              <Alert className="mt-3" type={alertType[lastStatus]} message={lastMsg} showIcon />
            )}

            <Divider />
            <Row gutter={16} className="text-center">
              <Col span={12}>
                <Statistic title="已收件数" value={totalReceived} valueStyle={{ color: token.colorPrimary, fontSize: 26 }} />
              </Col>
              <Col span={12}>
                <Statistic title="预期件数" value={totalExpected} valueStyle={{ fontSize: 26 }} />
              </Col>
            </Row>

            {order && (
              <div className="mt-3 text-center">
                <Tag color={order.status === 'RECEIVING' ? 'processing' : 'default'}>{order.status}</Tag>
              </div>
            )}

            <Button
              type="primary"
              block
              size="large"
              className="mt-4"
              icon={<SaveOutlined />}
              loading={completing}
              disabled={!order || !allReceived || !canReceive || order.status === 'COMPLETED'}
              onClick={handleComplete}
              style={{ height: 48 }}
            >
              完成收货
            </Button>
            {order && !allReceived && (
              <div className="mt-2 text-center text-xs text-slate-400">全部 SKU 收齐后方可完成</div>
            )}
            {!canReceive && (
              <div className="mt-2 text-center text-xs text-slate-400">当前角色无收货权限</div>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={16}>
          <Card
            title={
              <Space>
                <InboxOutlined style={{ color: token.colorPrimary }} />
                <span>{order ? `${order.receivingNo} 商品明细` : '商品明细'}</span>
                {order && <Tag>{order.items.length} SKU</Tag>}
              </Space>
            }
            className="shadow-sm"
          >
            {!order ? (
              <div className="py-16">
                <Empty description="请选择一张收货单开始扫码" />
              </div>
            ) : (
              <Table
                dataSource={order.items}
                columns={columns}
                size="small"
                rowKey="id"
                pagination={false}
                scroll={{ y: 520 }}
                rowClassName={(r) => (r.receivedQty >= r.expectedQty ? 'bg-green-50' : '')}
              />
            )}
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
};

export default ReceivingWorkbench;
