import React, { useState, useRef, useEffect } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import {
  Card, Row, Col, Input, Button, Table, Tag, Alert,
  Space, Statistic, Divider, message, Badge, Select
} from 'antd';
import { ScanOutlined, SendOutlined, CheckCircleOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import request from '../../../utils/request';
import { useCan } from '../../../router/permissions';

const { Option } = Select;

interface SignoutBox {
  key: string;
  boxNo: string;
  orderNo: string;
  customerName: string;
  pieces: number;
  weight: number;
  destination: string;
  courier: string;
  scannedAt: string;
}

// Subset of the Box returned by GET /boxes (orderNo/customerName are flattened by the backend).
interface BackendBox {
  boxNo: string;
  orderNo: string;
  customerName: string;
  pieces: number;
  actualWeight?: number;
  chargeWeight?: number;
  destination: string;
  courier?: string;
}

const TransitSignout: React.FC = () => {
  const navigate = useNavigate();
  const scanRef = useRef<any>(null);
  const canSignOut = useCan('box.signOut'); // POST /boxes/sign-out — OPS roles only
  const [scanValue, setScanValue] = useState('');
  const [boxes, setBoxes] = useState<SignoutBox[]>([]);
  const [lastStatus, setLastStatus] = useState<'idle' | 'ok' | 'error' | 'dup'>('idle');
  const [lastMsg, setLastMsg] = useState('');
  const [logisticsNo, setLogisticsNo] = useState('');
  const [courier, setCourier] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { scanRef.current?.focus(); }, []);

  const handleScan = async (val: string) => {
    const v = val.trim();
    if (!v) return;
    try {
      const res: any = await request.get('/boxes', { params: { boxNo: v, status: 'MEASURED' } });
      const box: BackendBox | undefined = res?.data?.[0];
      if (!box) {
        setLastStatus('error');
        setLastMsg(`❌ 未知箱号：${v}`);
        setScanValue('');
        return;
      }
      if (boxes.find((b) => b.boxNo === v)) {
        setLastStatus('dup');
        setLastMsg(`⚠️ 重复扫描：${v}`);
        setScanValue('');
        return;
      }
      const row: SignoutBox = {
        key: `${v}-${Date.now()}`,
        boxNo: box.boxNo,
        orderNo: box.orderNo,
        customerName: box.customerName,
        pieces: box.pieces,
        weight: box.chargeWeight ?? box.actualWeight ?? 0, // 计费重优先
        destination: box.destination,
        courier: box.courier ?? '',
        scannedAt: new Date().toLocaleTimeString('zh-CN'),
      };
      setBoxes((prev) => [row, ...prev]);
      setLastStatus('ok');
      setLastMsg(`✅ ${v} — ${row.orderNo} — ${row.destination} → ${row.courier}`);
      setScanValue('');
    } catch {
      // request.ts interceptor surfaces errors
    }
  };

  const handleSubmit = async () => {
    if (boxes.length === 0) { message.warning('请先扫描箱子'); return; }
    if (!logisticsNo) { message.warning('请填写物流单号'); return; }
    setSubmitting(true);
    try {
      const res: any = await request.post('/boxes/sign-out', {
        boxNos: boxes.map((b) => b.boxNo),
        courier: courier || undefined,
        trackingNo: logisticsNo,
      });
      message.success(`中转签出完成！${res?.data?.count ?? boxes.length} 箱，物流单号：${logisticsNo}`);
      setBoxes([]); setLogisticsNo(''); setCourier(''); setLastStatus('idle');
      scanRef.current?.focus();
    } catch {
      // request.ts interceptor surfaces errors
    } finally {
      setSubmitting(false);
    }
  };

  const alertType: Record<string, 'success' | 'error' | 'warning' | 'info'> = { ok: 'success', error: 'error', dup: 'warning', idle: 'info' };
  const totalPcs = boxes.reduce((s, b) => s + b.pieces, 0);
  const totalWt = boxes.reduce((s, b) => s + b.weight, 0);

  const columns = [
    { title: '箱号', dataIndex: 'boxNo', width: 150, render: (v: string) => <code className="text-xs bg-slate-100 px-1 rounded">{v}</code> },
    { title: '关联订单', dataIndex: 'orderNo', width: 140 },
    { title: '客户', dataIndex: 'customerName', ellipsis: true },
    { title: '件数', dataIndex: 'pieces', width: 65 },
    { title: '重量(kg)', dataIndex: 'weight', width: 90 },
    { title: '目的地', dataIndex: 'destination', width: 80, render: (v: string) => <Tag color="blue">{v}</Tag> },
    { title: '扫描时间', dataIndex: 'scannedAt', width: 85 },
    { title: '状态', width: 80, render: () => <Tag color="success" icon={<CheckCircleOutlined />}>已签出</Tag> },
  ];

  return (
    <PageContainer header={{ title: '中转按单签出', subTitle: '扫描中转箱，绑定物流单号，确认签出', extra: [<Button key="back" icon={<ArrowLeftOutlined />} onClick={() => navigate('/transit/list')}>返回列表</Button>] }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Card title={<Space><ScanOutlined style={{ color: '#D23148' }} /><span>扫码签出</span></Space>} className="shadow-sm" style={{ position: 'sticky', top: 80 }}>
            <Input
              ref={scanRef} size="large" value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              onPressEnter={() => handleScan(scanValue)}
              placeholder="扫描箱子条码 / Enter 确认"
              prefix={<ScanOutlined className="text-gray-400" />}
              autoFocus allowClear style={{ fontSize: 15 }}
            />
            {lastStatus !== 'idle' && <Alert className="mt-3" type={alertType[lastStatus]} message={lastMsg} showIcon />}
            <Divider>物流信息</Divider>
            <div className="space-y-3">
              <Select style={{ width: '100%' }} placeholder="选择物流渠道" value={courier || undefined} onChange={setCourier}>
                {['FedEx', 'DHL', 'UPS', 'EMS', 'YTO'].map((c) => <Option key={c} value={c}>{c}</Option>)}
              </Select>
              <Input placeholder="物流单号（必填）" value={logisticsNo} onChange={(e) => setLogisticsNo(e.target.value)} size="large" />
            </div>
            <Divider />
            <Row gutter={12} className="text-center mb-4">
              <Col span={8}><Statistic title="箱数" value={boxes.length} valueStyle={{ color: '#D23148', fontSize: 22 }} /></Col>
              <Col span={8}><Statistic title="件数" value={totalPcs} valueStyle={{ fontSize: 22 }} /></Col>
              <Col span={8}><Statistic title="kg" value={totalWt.toFixed(1)} valueStyle={{ fontSize: 22 }} /></Col>
            </Row>
            <Button type="primary" block size="large" icon={<SendOutlined />} loading={submitting} disabled={boxes.length === 0 || !canSignOut} onClick={handleSubmit} style={{ backgroundColor: '#D23148', height: 48 }}>
              确认签出 ({boxes.length} 箱)
            </Button>
          </Card>
        </Col>
        <Col xs={24} lg={16}>
          <Card title={<Space><span>本批签出箱子</span><Badge count={boxes.length} style={{ backgroundColor: '#10b981' }} /></Space>} extra={boxes.length > 0 && <Button type="text" danger size="small" onClick={() => { setBoxes([]); setLastStatus('idle'); }}>清空</Button>} className="shadow-sm">
            {boxes.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <SendOutlined style={{ fontSize: 48, opacity: 0.25 }} />
                <p className="mt-3">请扫描箱子条码</p>
              </div>
            ) : (
              <Table dataSource={boxes} columns={columns} size="small" rowKey="key" pagination={false} scroll={{ y: 480 }} />
            )}
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
};

export default TransitSignout;
