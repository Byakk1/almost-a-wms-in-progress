import React, { useRef, useState, useEffect } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import { Card, Row, Col, Input, Button, Table, Alert, Space, Divider, message, Statistic, Tag, Select } from 'antd';
import { ScanOutlined, ArrowLeftOutlined, DropboxOutlined, SendOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const { Option } = Select;

interface FbaSignoutItem {
  key: string;
  fbaShipmentId: string;
  boxIdentifier: string;
  actualWeight: number;
  scannedAt: string;
}

const MOCK_INVENTORY: Record<string, Omit<FbaSignoutItem, 'key' | 'scannedAt'>> = {
  'FBA15K2Y3GH-U001': { fbaShipmentId: 'FBA15K2Y3GH', boxIdentifier: 'U001', actualWeight: 15.5 },
  'FBA15K2Y3GH-U002': { fbaShipmentId: 'FBA15K2Y3GH', boxIdentifier: 'U002', actualWeight: 14.2 },
  'FBA99XXXXXX-U009': { fbaShipmentId: 'FBA99XXXXXX', boxIdentifier: 'U009', actualWeight: 22.0 },
};

const FirstMileSignout: React.FC = () => {
  const navigate = useNavigate();
  const scanRef = useRef<any>(null);
  const [scanValue, setScanValue] = useState('');
  const [items, setItems] = useState<FbaSignoutItem[]>([]);
  const [lastMsg, setLastMsg] = useState('');
  const [lastStatus, setLastStatus] = useState<'idle' | 'ok' | 'error' | 'dup'>('idle');
  const [carrier, setCarrier] = useState('');
  const [trackingNo, setTrackingNo] = useState('');

  useEffect(() => { scanRef.current?.focus(); }, []);

  const handleScan = (val: string) => {
    const v = val.trim();
    if (!v) return;
    const inv = MOCK_INVENTORY[v];
    if (!inv) {
      setLastStatus('error');
      setLastMsg(`❌ 库存中未找到或未完成前置测量：${v}`);
      setScanValue('');
      return;
    }
    if (items.find((i) => i.boxIdentifier === inv.boxIdentifier && i.fbaShipmentId === inv.fbaShipmentId)) {
      setLastStatus('dup');
      setLastMsg(`⚠️ 该外箱 ${v} 已在本次签出列表内`);
      setScanValue('');
      return;
    }
    const newItem: FbaSignoutItem = { ...inv, key: v, scannedAt: new Date().toLocaleTimeString('zh-CN') };
    setItems((prev) => [newItem, ...prev]);
    setLastStatus('ok');
    setLastMsg(`✅ 成功添加至签出：${inv.fbaShipmentId} - ${inv.boxIdentifier}（${inv.actualWeight}kg）`);
    setScanValue('');
  };

  const handleSubmit = () => {
    if (!carrier || !trackingNo) {
      message.error('请选择头程承运商并填写物流单号');
      return;
    }
    message.success(`FBA头程出库完成！共 ${items.length} 箱转交物流：${carrier} ${trackingNo}`);
    setItems([]); setLastStatus('idle'); setCarrier(''); setTrackingNo('');
    scanRef.current?.focus();
  };

  const alertType: Record<string, 'success' | 'error' | 'warning' | 'info'> = { ok: 'success', error: 'error', dup: 'warning', idle: 'info' };

  return (
    <PageContainer header={{ title: 'FBA头程签出', subTitle: '扫码确认FBA外箱出库，绑定头程物流服务商单号', extra: [<Button key="back" icon={<ArrowLeftOutlined />} onClick={() => navigate('/fba/orders')}>返回订单</Button>] }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Card title={<Space><ScanOutlined style={{ color: '#D23148' }} /><span>扫码出库</span></Space>} className="shadow-sm">
            <Input
              ref={scanRef} size="large" value={scanValue} onChange={(e) => setScanValue(e.target.value)} onPressEnter={() => handleScan(scanValue)}
              placeholder="扫描FBA外箱 / Shipment编号条形码" prefix={<ScanOutlined className="text-gray-400" />} autoFocus allowClear style={{ fontSize: 16 }}
            />
            {lastStatus !== 'idle' && <Alert className="mt-3" type={alertType[lastStatus]} message={lastMsg} showIcon />}
            
            <Divider>头程物流信息</Divider>
            <div className="space-y-3 mb-4">
              <Select style={{ width: '100%' }} placeholder="选择合作头程承运商" value={carrier || undefined} onChange={setCarrier}>
                {['UPS', 'FedEx', 'DHL', 'Matson 海派', 'ZIM 海派'].map((c) => <Option key={c} value={c}>{c}</Option>)}
              </Select>
              <Input placeholder="输入追踪/提单号" value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} />
            </div>

            <Row gutter={12} className="text-center">
              <Col span={12}><Statistic title="签出箱数" value={items.length} valueStyle={{ color: '#D23148', fontSize: 26 }} /></Col>
              <Col span={12}><Statistic title="总重量(kg)" value={items.reduce((s, i) => s + i.actualWeight, 0).toFixed(1)} valueStyle={{ fontSize: 26 }} /></Col>
            </Row>
            <Divider />
            <Button type="primary" block size="large" onClick={handleSubmit} disabled={items.length === 0} icon={<SendOutlined />} style={{ backgroundColor: '#D23148' }}>确认签出并扣库</Button>
            <div className="mt-4 text-xs text-gray-400 text-center">测试数据: FBA15K2Y3GH-U001 / FBA15K2Y3GH-U002</div>
          </Card>
        </Col>
        <Col xs={24} lg={16}>
          <Card className="shadow-sm" bodyStyle={{ padding: 0 }}>
            <Table
              dataSource={items} rowKey="key" pagination={false} scroll={{ y: 560 }}
              columns={[
                { title: 'FBA Shipment 号', dataIndex: 'fbaShipmentId', render: (v) => <Tag color="warning">{v}</Tag> },
                { title: '箱子标识', dataIndex: 'boxIdentifier', render: (v) => <code>{v}</code> },
                { title: '复核重量(kg)', dataIndex: 'actualWeight' },
                { title: '扫描出库时间', dataIndex: 'scannedAt' },
              ]}
              locale={{ emptyText: <div className="py-16"><DropboxOutlined style={{ fontSize: 48, color: '#e2e8f0' }}/><p className="mt-2 text-slate-400">目前暂无待签出记录向此加载</p></div> }}
            />
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
};

export default FirstMileSignout;
