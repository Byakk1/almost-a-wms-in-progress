import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import {
  Card, Row, Col, Input, Button, Table, Tag, Alert, Space, Select,
  Divider, Descriptions, Badge, Result, Statistic, theme,
} from 'antd';
import {
  ScanOutlined, CheckCircleOutlined, BoxPlotOutlined,
  ArrowLeftOutlined, ScissorOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import request from '../../../utils/request';
import { useCan } from '../../../router/permissions';

interface PackItem {
  sku: string;
  productName: string;
  requiredQty: number;
  pickedQty: number;
  packedQty: number;
}

interface OrderSummary {
  id: string;
  orderNo: string;
  customerName: string;
  status: string;
  shipToCountry?: string | null;
  shipToCity?: string | null;
}

interface OrderDetail extends OrderSummary {
  items: PackItem[];
}

const PackingWorkbench: React.FC = () => {
  const navigate = useNavigate();
  const scanRef = useRef<any>(null);
  const { token } = theme.useToken();
  const canPack = useCan('outbound.pack'); // start-packing / pack / complete-packing — OPS

  const [queue, setQueue] = useState<OrderSummary[]>([]);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [scanValue, setScanValue] = useState('');
  const [lastStatus, setLastStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [lastMsg, setLastMsg] = useState('');
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [packing, setPacking] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  // Packable orders are PICKED (not yet started) plus PACKING (resume a session
  // someone left open). The list endpoint filters one status at a time.
  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    try {
      const [picked, inProgress] = await Promise.all([
        request.get('/outbound-orders', { params: { status: 'PICKED', pageSize: 100 } }),
        request.get('/outbound-orders', { params: { status: 'PACKING', pageSize: 100 } }),
      ]);
      setQueue([...((picked as any)?.data ?? []), ...((inProgress as any)?.data ?? [])]);
    } catch {
      // request.ts interceptor surfaces errors
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const selectOrder = async (id: string) => {
    const picked = queue.find((o) => o.id === id);
    if (!picked) return;
    try {
      // PICKED -> PACKING. An order already PACKING is resumed as-is, since
      // start-packing would be rejected by the state machine.
      if (picked.status === 'PICKED') {
        await request.post(`/outbound-orders/${id}/start-packing`);
      }
      const res: any = await request.get(`/outbound-orders/${id}`);
      setOrder(res?.data ?? null);
      setLastStatus('ok');
      setLastMsg(`✅ 已进入打包：${picked.orderNo}`);
      scanRef.current?.focus();
    } catch {
      // request.ts interceptor surfaces errors
    }
  };

  // Scanning matches the order's own SKUs: GET /products has no barcode filter,
  // so a barcode -> SKU lookup is not available server-side.
  const handleScan = async (val: string) => {
    const sku = val.trim();
    if (!sku || !order) return;

    const item = order.items.find((i) => i.sku === sku);
    if (!item) {
      setLastStatus('error');
      setLastMsg(`❌ 订单 ${order.orderNo} 中没有该 SKU：${sku}`);
      setScanValue('');
      return;
    }

    setPacking(true);
    try {
      // The server owns packedQty and rejects over-packing, so its response is
      // the source of truth rather than a local counter.
      const res: any = await request.post(`/outbound-orders/${order.id}/pack`, { sku, qty: 1 });
      const packedQty = res?.data?.packedQty ?? item.packedQty + 1;
      setOrder((prev) =>
        prev ? { ...prev, items: prev.items.map((i) => (i.sku === sku ? { ...i, packedQty } : i)) } : prev,
      );
      setLastStatus('ok');
      setLastMsg(`✅ ${sku} 已打包 ${packedQty}/${item.requiredQty}`);
    } catch {
      // interceptor surfaces the reason (e.g. 打包数量超出需求数量)
      setLastStatus('error');
      setLastMsg(`❌ ${sku} 打包失败`);
    } finally {
      setPacking(false);
      setScanValue('');
      scanRef.current?.focus();
    }
  };

  const allPacked = !!order && order.items.every((i) => i.packedQty >= i.requiredQty);

  const completePacking = async () => {
    if (!order) return;
    setCompleting(true);
    try {
      await request.post(`/outbound-orders/${order.id}/complete-packing`);
      setDone(order.orderNo);
      setOrder(null);
      loadQueue();
    } catch {
      // request.ts interceptor surfaces errors
    } finally {
      setCompleting(false);
    }
  };

  const totalRequired = order?.items.reduce((s, i) => s + i.requiredQty, 0) ?? 0;
  const totalPacked = order?.items.reduce((s, i) => s + i.packedQty, 0) ?? 0;

  const columns = [
    {
      title: 'SKU', dataIndex: 'sku', width: 160,
      render: (v: string) => <code className="text-xs bg-slate-100 px-1 rounded">{v}</code>,
    },
    { title: '商品名称', dataIndex: 'productName', ellipsis: true },
    { title: '需求', dataIndex: 'requiredQty', width: 80 },
    { title: '已拣', dataIndex: 'pickedQty', width: 80 },
    {
      title: '已打包', dataIndex: 'packedQty', width: 90,
      render: (v: number, r: PackItem) => (
        <span style={{ color: v >= r.requiredQty ? token.colorSuccess : token.colorWarning, fontWeight: 600 }}>{v}</span>
      ),
    },
    {
      title: '状态', width: 100,
      render: (_: any, r: PackItem) =>
        r.packedQty >= r.requiredQty
          ? <Tag color="success" icon={<CheckCircleOutlined />}>完成</Tag>
          : <Tag color="warning">待打包</Tag>,
    },
  ];

  if (done) {
    return (
      <PageContainer>
        <Result
          status="success"
          title={`${done} 打包完成`}
          subTitle="订单状态已更新为已打包（PACKED），可继续下一单"
          extra={[
            <Button key="next" type="primary" onClick={() => { setDone(null); setLastStatus('idle'); loadQueue(); }}>
              打包下一单
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
        title: '按单打包台',
        subTitle: '选择已拣货订单，逐 SKU 扫码打包',
        extra: [
          <Button key="back" icon={<ArrowLeftOutlined />} onClick={() => navigate('/outbound/picking')}>
            返回拣货列表
          </Button>,
        ],
      }}
    >
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={9}>
          <Card
            title={<Space><ScanOutlined style={{ color: token.colorPrimary }} /><span>选单 + 扫码</span></Space>}
            className="shadow-sm"
            style={{ position: 'sticky', top: 80 }}
          >
            <Select
              showSearch
              style={{ width: '100%' }}
              size="large"
              placeholder={loadingQueue ? '加载中…' : `选择待打包订单（${queue.length}）`}
              value={order?.id}
              onChange={selectOrder}
              loading={loadingQueue}
              optionFilterProp="label"
              options={queue.map((o) => ({
                value: o.id,
                label: `${o.orderNo} · ${o.customerName}${o.status === 'PACKING' ? '（打包中）' : ''}`,
              }))}
            />

            {order && (
              <>
                <Divider />
                <Input
                  ref={scanRef}
                  size="large"
                  value={scanValue}
                  onChange={(e) => setScanValue(e.target.value)}
                  onPressEnter={() => handleScan(scanValue)}
                  placeholder="扫描 / 输入 SKU 后回车"
                  prefix={<ScanOutlined className="text-gray-400" />}
                  disabled={!canPack || packing}
                  autoFocus
                  allowClear
                />
              </>
            )}

            {lastStatus !== 'idle' && (
              <Alert className="mt-3" type={lastStatus === 'ok' ? 'success' : 'error'} message={lastMsg} showIcon />
            )}

            {order && (
              <>
                <Divider />
                <Row gutter={12} className="text-center">
                  <Col span={12}>
                    <Statistic title="已打包" value={totalPacked} valueStyle={{ color: token.colorPrimary, fontSize: 24 }} />
                  </Col>
                  <Col span={12}>
                    <Statistic title="需求总数" value={totalRequired} valueStyle={{ fontSize: 24 }} />
                  </Col>
                </Row>
                <Button
                  className="mt-4"
                  type="primary"
                  block
                  size="large"
                  icon={<BoxPlotOutlined />}
                  loading={completing}
                  disabled={!allPacked || !canPack}
                  onClick={completePacking}
                  style={{ height: 46 }}
                >
                  {allPacked ? '完成打包' : `还差 ${totalRequired - totalPacked} 件`}
                </Button>
                {!canPack && <div className="mt-2 text-center text-xs text-slate-400">当前角色无打包权限</div>}
              </>
            )}

            {!order && (
              <div className="text-center py-10 text-gray-400">
                <ScissorOutlined style={{ fontSize: 40, opacity: 0.25 }} />
                <p className="mt-2 text-sm">
                  {queue.length === 0 ? '当前没有「已拣货」订单待打包' : '请先选择一个待打包订单'}
                </p>
              </div>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={15}>
          <Card
            title={
              <Space>
                <BoxPlotOutlined style={{ color: token.colorPrimary }} />
                <span>订单明细</span>
                {order && <Badge count={order.items.length} style={{ backgroundColor: token.colorPrimary }} />}
              </Space>
            }
            className="shadow-sm"
          >
            {!order ? (
              <div className="text-center py-16 text-gray-400">
                <BoxPlotOutlined style={{ fontSize: 48, opacity: 0.25 }} />
                <p className="mt-3">选择订单后在此显示明细</p>
              </div>
            ) : (
              <>
                <Descriptions size="small" column={2} bordered className="mb-4">
                  <Descriptions.Item label="订单号">{order.orderNo}</Descriptions.Item>
                  <Descriptions.Item label="客户">{order.customerName}</Descriptions.Item>
                  <Descriptions.Item label="状态"><Tag color="processing">{order.status}</Tag></Descriptions.Item>
                  <Descriptions.Item label="目的地">
                    {[order.shipToCity, order.shipToCountry].filter(Boolean).join(' · ') || '—'}
                  </Descriptions.Item>
                </Descriptions>
                <Table dataSource={order.items} columns={columns} size="small" rowKey="sku" pagination={false} />
              </>
            )}
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
};

export default PackingWorkbench;
