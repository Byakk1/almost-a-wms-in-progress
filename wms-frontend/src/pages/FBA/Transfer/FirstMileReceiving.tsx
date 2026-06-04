import React, { useRef, useState, useEffect } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import { Card, Row, Col, Input, Button, Table, Alert, Space, Divider, message, Statistic, Tag } from 'antd';
import { ScanOutlined, ArrowLeftOutlined, DropboxOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

interface FbaRcvItem {
  key: string;
  fbaShipmentId: string;
  boxIdentifier: string;
  fnsku: string;
  qty: number;
  scannedAt: string;
}

const MOCK_EXPECTED: Record<string, Omit<FbaRcvItem, 'key' | 'scannedAt'>> = {
  'FBA15K2Y3GH-U001': { fbaShipmentId: 'FBA15K2Y3GH', boxIdentifier: 'U001', fnsku: 'X003A1BCD', qty: 50 },
  'FBA15K2Y3GH-U002': { fbaShipmentId: 'FBA15K2Y3GH', boxIdentifier: 'U002', fnsku: 'X003A1BCF', qty: 30 },
};

const FirstMileReceiving: React.FC = () => {
  const navigate = useNavigate();
  const scanRef = useRef<any>(null);
  const [scanValue, setScanValue] = useState('');
  const [items, setItems] = useState<FbaRcvItem[]>([]);
  const [lastMsg, setLastMsg] = useState('');
  const [lastStatus, setLastStatus] = useState<'idle' | 'ok' | 'error' | 'dup'>('idle');

  useEffect(() => { scanRef.current?.focus(); }, []);

  const handleScan = (val: string) => {
    const v = val.trim();
    if (!v) return;
    const expected = MOCK_EXPECTED[v];
    if (!expected) {
      setLastStatus('error');
      setLastMsg(`❌ 未知FBA标签或箱号：${v}`);
      setScanValue('');
      return;
    }
    if (items.find((i) => i.boxIdentifier === expected.boxIdentifier && i.fbaShipmentId === expected.fbaShipmentId)) {
      setLastStatus('dup');
      setLastMsg(`⚠️ 该外箱 ${v} 已扫码收货，请勿重复扫描`);
      setScanValue('');
      return;
    }
    const newItem: FbaRcvItem = { ...expected, key: v, scannedAt: new Date().toLocaleTimeString('zh-CN') };
    setItems((prev) => [newItem, ...prev]);
    setLastStatus('ok');
    setLastMsg(`✅ 成功收货：${expected.fbaShipmentId} - ${expected.boxIdentifier}（内含 FNSKU: ${expected.fnsku} × ${expected.qty}）`);
    setScanValue('');
  };

  const handleSubmit = () => {
    message.success(`FBA转运单收货完成！共收到 ${items.length} 箱`);
    setItems([]); setLastStatus('idle'); scanRef.current?.focus();
  };

  const alertType: Record<string, 'success' | 'error' | 'warning' | 'info'> = { ok: 'success', error: 'error', dup: 'warning', idle: 'info' };

  return (
    <PageContainer header={{ title: 'FBA头程收货', subTitle: '客户送仓或揽收进仓的FBA转运箱子扫码签收', extra: [<Button key="back" icon={<ArrowLeftOutlined />} onClick={() => navigate('/fba/orders')}>返回订单</Button>] }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Card title={<Space><ScanOutlined style={{ color: '#D23148' }} /><span>扫码入库</span></Space>} className="shadow-sm">
            <Input
              ref={scanRef} size="large" value={scanValue} onChange={(e) => setScanValue(e.target.value)} onPressEnter={() => handleScan(scanValue)}
              placeholder="扫描FBA外箱 / Shipment编号条形码" prefix={<ScanOutlined className="text-gray-400" />} autoFocus allowClear style={{ fontSize: 16 }}
            />
            {lastStatus !== 'idle' && <Alert className="mt-3" type={alertType[lastStatus]} message={lastMsg} showIcon />}
            
            <Divider />
            <Row gutter={12} className="text-center">
              <Col span={12}><Statistic title="已扫外箱数" value={items.length} valueStyle={{ color: '#D23148', fontSize: 26 }} /></Col>
              <Col span={12}><Statistic title="包含商品总件数" value={items.reduce((s, i) => s + i.qty, 0)} valueStyle={{ fontSize: 26 }} /></Col>
            </Row>
            <Divider />
            <Button type="primary" block size="large" onClick={handleSubmit} disabled={items.length === 0} style={{ backgroundColor: '#D23148' }}>完成收货并生成重测任务</Button>
            <div className="mt-4 text-xs text-gray-400 text-center">测试数据: FBA15K2Y3GH-U001 / FBA15K2Y3GH-U002</div>
          </Card>
        </Col>
        <Col xs={24} lg={16}>
          <Card className="shadow-sm" bodyStyle={{ padding: 0 }}>
            <Table
              dataSource={items} rowKey="key" pagination={false} scroll={{ y: 500 }}
              columns={[
                { title: 'FBA Shipment 号', dataIndex: 'fbaShipmentId', render: (v) => <Tag color="warning">{v}</Tag> },
                { title: '箱子标识', dataIndex: 'boxIdentifier', render: (v) => <code>{v}</code> },
                { title: 'FNSKU', dataIndex: 'fnsku' },
                { title: '数量(件)', dataIndex: 'qty' },
                { title: '扫描时间', dataIndex: 'scannedAt' },
              ]}
              locale={{ emptyText: <div className="py-16"><DropboxOutlined style={{ fontSize: 48, color: '#e2e8f0' }}/><p className="mt-2 text-slate-400">目前暂无收货记录向此加载</p></div> }}
            />
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
};

export default FirstMileReceiving;
