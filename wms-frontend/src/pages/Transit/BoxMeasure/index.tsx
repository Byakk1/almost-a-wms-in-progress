import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import {
  Card, Row, Col, Input, Button, Table, Tag, Alert,
  Space, Statistic, Divider, message, InputNumber, Form
} from 'antd';
import { ScanOutlined, SaveOutlined, ScissorOutlined, CalculatorOutlined } from '@ant-design/icons';
import request from '../../../utils/request';
import { useCan } from '../../../router/permissions';

interface BoxMeasure {
  key: string;
  boxNo: string;
  orderNo: string;
  length?: number;
  width?: number;
  height?: number;
  actualWeight?: number;
  volWeight?: number;
  chargeWeight?: number;
  status: 'PENDING' | 'DONE';
  measuredAt?: string;
}

// Subset of the Box returned by GET /boxes and PUT /boxes/:boxNo/measure.
interface BackendBox {
  boxNo: string;
  orderNo: string;
  volWeight?: number;
  chargeWeight?: number;
  measuredAt?: string;
}

const BoxMeasurePage: React.FC = () => {
  const scanRef = useRef<any>(null);
  const canMeasure = useCan('box.measure'); // PUT /boxes/:boxNo/measure — OPS roles only
  const [scanValue, setScanValue] = useState('');
  const [current, setCurrent] = useState<BoxMeasure | null>(null);
  const [boxes, setBoxes] = useState<BoxMeasure[]>([]);
  const [lastMsg, setLastMsg] = useState('');
  const [lastStatus, setLastStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [pendingTotal, setPendingTotal] = useState(0);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  // 待测量 count comes from the server (pageSize=1 — only the total is used).
  const loadPendingTotal = useCallback(async () => {
    try {
      const res: any = await request.get('/boxes', { params: { status: 'PENDING', pageSize: 1 } });
      setPendingTotal(res?.pagination?.total ?? 0);
    } catch {
      // request.ts interceptor surfaces errors
    }
  }, []);

  useEffect(() => {
    loadPendingTotal();
    scanRef.current?.focus();
  }, [loadPendingTotal]);

  const calcVolWeight = (l?: number, w?: number, h?: number) =>
    l && w && h ? parseFloat(((l * w * h) / 5000).toFixed(3)) : undefined;

  const handleScan = async (val: string) => {
    const v = val.trim();
    if (!v) return;
    // Local check first: a box saved in this session is no longer PENDING server-side.
    if (boxes.find((b) => b.boxNo === v)) {
      setLastMsg(`⚠️ ${v} 已测量`);
      setLastStatus('ok');
      setScanValue('');
      return;
    }
    try {
      const res: any = await request.get('/boxes', { params: { boxNo: v, status: 'PENDING' } });
      const box: BackendBox | undefined = res?.data?.[0];
      if (!box) {
        setLastStatus('error');
        setLastMsg(`❌ 未知箱号：${v}`);
        setScanValue('');
        return;
      }
      setCurrent({ key: v, boxNo: box.boxNo, orderNo: box.orderNo, status: 'PENDING' });
      setLastStatus('ok');
      setLastMsg(`✅ 已加载箱子 ${v}（${box.orderNo}），请填写尺寸和重量`);
      setScanValue('');
      form.resetFields();
    } catch {
      // request.ts interceptor surfaces errors
    }
  };

  const handleSave = () => {
    form.validateFields().then(async (vals) => {
      if (!current) return;
      setSaving(true);
      try {
        const res: any = await request.put(`/boxes/${current.boxNo}/measure`, {
          length: vals.length,
          width: vals.width,
          height: vals.height,
          actualWeight: vals.actualWeight,
        });
        // Server computes 泡重/计费重 — it is the source of truth.
        const saved: BackendBox = res?.data ?? {};
        const done: BoxMeasure = {
          ...current,
          ...vals,
          volWeight: saved.volWeight,
          chargeWeight: saved.chargeWeight,
          status: 'DONE',
          measuredAt: new Date(saved.measuredAt ?? Date.now()).toLocaleTimeString('zh-CN'),
        };
        setBoxes((prev) => [done, ...prev]);
        message.success(`${current.boxNo} 测量完成，计费重：${saved.chargeWeight} kg`);
        setCurrent(null);
        form.resetFields();
        loadPendingTotal();
        scanRef.current?.focus();
      } catch {
        // request.ts interceptor surfaces errors
      } finally {
        setSaving(false);
      }
    });
  };

  const alertType: Record<string, 'success' | 'error' | 'warning'> = { ok: 'success', error: 'error', idle: 'success' };

  const columns = [
    { title: '箱号', dataIndex: 'boxNo', width: 150, render: (v: string) => <code className="text-xs bg-slate-100 px-1 rounded">{v}</code> },
    { title: '订单', dataIndex: 'orderNo', width: 130 },
    { title: '尺寸(cm)', width: 130, render: (_: any, r: BoxMeasure) => r.length ? `${r.length}×${r.width}×${r.height}` : '-' },
    { title: '实重(kg)', dataIndex: 'actualWeight', width: 90 },
    { title: '泡重(kg)', dataIndex: 'volWeight', width: 90, render: (v?: number) => v ?? '-' },
    {
      title: '计费重(kg)', dataIndex: 'chargeWeight', width: 100,
      render: (v?: number) => <span className="font-bold text-primary">{v ?? '-'}</span>,
    },
    { title: '测量时间', dataIndex: 'measuredAt', width: 85 },
    { title: '状态', dataIndex: 'status', width: 80, render: () => <Tag color="success">已测量</Tag> },
  ];

  return (
    <PageContainer header={{ title: '箱子测量工作台', subTitle: '扫描中转箱，录入实测尺寸和重量，系统自动计算体积重与计费重' }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={9}>
          <Card title={<Space><ScanOutlined style={{ color: '#D23148' }} /><span>扫码 + 录入</span></Space>} className="shadow-sm" style={{ position: 'sticky', top: 80 }}>
            <Input
              ref={scanRef} size="large" value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              onPressEnter={() => handleScan(scanValue)}
              placeholder="扫描箱子条码 / Enter"
              prefix={<ScanOutlined className="text-gray-400" />}
              autoFocus allowClear style={{ fontSize: 15 }}
            />
            {lastStatus !== 'idle' && <Alert className="mt-3" type={alertType[lastStatus]} message={lastMsg} showIcon />}

            {current && (
              <>
                <Divider>
                  <Tag color="blue">{current.boxNo}</Tag>
                  <span className="text-xs text-slate-400 ml-2">{current.orderNo}</span>
                </Divider>
                <Form form={form} layout="vertical" size="large">
                  <Row gutter={8}>
                    <Col span={8}><Form.Item label="长(cm)" name="length" rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} placeholder="L" /></Form.Item></Col>
                    <Col span={8}><Form.Item label="宽(cm)" name="width" rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} placeholder="W" /></Form.Item></Col>
                    <Col span={8}><Form.Item label="高(cm)" name="height" rules={[{ required: true }]}><InputNumber min={1} style={{ width: '100%' }} placeholder="H" /></Form.Item></Col>
                  </Row>
                  <Form.Item label="实重(kg)" name="actualWeight" rules={[{ required: true }]}>
                    <InputNumber min={0.001} step={0.001} style={{ width: '100%' }} placeholder="0.000" />
                  </Form.Item>

                  {/* Live preview of vol weight */}
                  <Form.Item noStyle shouldUpdate>
                    {() => {
                      const vals = form.getFieldsValue();
                      const vw = calcVolWeight(vals.length, vals.width, vals.height);
                      const aw = vals.actualWeight;
                      if (!vw && !aw) return null;
                      const cw = vw && aw ? Math.max(vw, aw) : (aw || vw);
                      return (
                        <div className="mb-4 p-3 bg-slate-50 rounded-lg">
                          <Row gutter={12}>
                            <Col span={12}><Statistic title="体积重(kg)" value={vw ?? '-'} valueStyle={{ fontSize: 18 }} /></Col>
                            <Col span={12}><Statistic title="计费重(kg)" value={cw ?? '-'} valueStyle={{ color: '#D23148', fontSize: 18 }} /></Col>
                          </Row>
                        </div>
                      );
                    }}
                  </Form.Item>

                  <Button type="primary" block size="large" icon={<SaveOutlined />} loading={saving} disabled={!canMeasure} onClick={handleSave} style={{ backgroundColor: '#D23148', height: 48 }}>
                    保存测量结果
                  </Button>
                </Form>
              </>
            )}

            {!current && (
              <div className="text-center py-8 text-gray-400">
                <ScissorOutlined style={{ fontSize: 40, opacity: 0.25 }} />
                <p className="mt-2 text-sm">扫描箱号后在此录入尺寸和重量</p>
              </div>
            )}

            <Divider />
            <Row gutter={12} className="text-center">
              <Col span={12}><Statistic title="今日已测量" value={boxes.length} valueStyle={{ color: '#10b981', fontSize: 22 }} /></Col>
              <Col span={12}><Statistic title="待测量" value={pendingTotal} valueStyle={{ color: '#f97316', fontSize: 22 }} /></Col>
            </Row>
          </Card>
        </Col>

        <Col xs={24} lg={15}>
          <Card title={<Space><CalculatorOutlined style={{ color: '#D23148' }} /><span>已测量记录</span></Space>} className="shadow-sm">
            {boxes.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <CalculatorOutlined style={{ fontSize: 48, opacity: 0.25 }} />
                <p className="mt-3">暂无已测量记录</p>
              </div>
            ) : (
              <Table dataSource={boxes} columns={columns} size="small" rowKey="key" pagination={false} scroll={{ y: 520 }} />
            )}
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
};

export default BoxMeasurePage;
