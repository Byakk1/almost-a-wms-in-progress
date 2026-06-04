import React, { useState, useRef, useEffect } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import {
  Card, Row, Col, Input, Button, Table, Tag, Alert,
  Space, Statistic, Divider, message, Badge
} from 'antd';
import {
  ScanOutlined, CheckCircleOutlined, CloseCircleOutlined,
  WarningOutlined, DeleteOutlined, SaveOutlined, ArrowLeftOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

interface ScannedItem {
  key: string;
  barcode: string;
  sku: string;
  productName: string;
  qty: number;
  status: 'OK' | 'ERROR' | 'DUPLICATE';
  scannedAt: string;
}

// Mock barcode database
const MOCK_PRODUCTS: Record<string, { sku: string; productName: string }> = {
  'SF123456789': { sku: 'SKU-A001', productName: 'iPhone 15 Pro 手机壳' },
  'JD987654321': { sku: 'SKU-B002', productName: '无线蓝牙耳机 AirPods 兼容款' },
  'YT556677889': { sku: 'SKU-C003', productName: 'USB-C 快充线 1m' },
  'SF000111222': { sku: 'SKU-D004', productName: '手机支架 金属折叠款' },
  'EMS999888777': { sku: 'SKU-E005', productName: '硅胶保护套 iPad Pro' },
};

const ReceivingWorkbench: React.FC = () => {
  const navigate = useNavigate();
  const scanInputRef = useRef<any>(null);
  const [scanValue, setScanValue] = useState('');
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [lastScanStatus, setLastScanStatus] = useState<'idle' | 'ok' | 'error' | 'duplicate'>('idle');
  const [lastScanMsg, setLastScanMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Auto-focus scan input on mount
  useEffect(() => {
    scanInputRef.current?.focus();
  }, []);

  // Re-focus after status change
  useEffect(() => {
    if (lastScanStatus !== 'idle') {
      const timer = setTimeout(() => {
        scanInputRef.current?.focus();
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [lastScanStatus, scannedItems]);

  const handleScan = (barcode: string) => {
    const trimmed = barcode.trim();
    if (!trimmed) return;

    // Check duplicate
    const existingIndex = scannedItems.findIndex(
      (item) => item.barcode === trimmed
    );

    if (existingIndex !== -1) {
      // Increment qty on duplicate scan (common warehouse behavior)
      const updatedItems = [...scannedItems];
      updatedItems[existingIndex] = {
        ...updatedItems[existingIndex],
        qty: updatedItems[existingIndex].qty + 1,
        status: 'DUPLICATE',
      };
      setScannedItems(updatedItems);
      setLastScanStatus('duplicate');
      setLastScanMsg(`重复扫描！${trimmed} 数量已累加至 ${updatedItems[existingIndex].qty}`);
      message.warning(`重复扫描：${trimmed}，数量已累加`);
    } else {
      // Look up product
      const product = MOCK_PRODUCTS[trimmed];
      if (product) {
        const newItem: ScannedItem = {
          key: `${trimmed}-${Date.now()}`,
          barcode: trimmed,
          sku: product.sku,
          productName: product.productName,
          qty: 1,
          status: 'OK',
          scannedAt: new Date().toLocaleTimeString('zh-CN'),
        };
        setScannedItems((prev) => [newItem, ...prev]);
        setLastScanStatus('ok');
        setLastScanMsg(`✅ 扫描成功：${product.productName} (${product.sku})`);
      } else {
        // Unknown barcode
        setLastScanStatus('error');
        setLastScanMsg(`❌ 未知条码：${trimmed}，请核实商品信息`);
        message.error(`未识别的条码：${trimmed}`);
      }
    }

    setScanValue('');
  };

  const handleRemoveItem = (key: string) => {
    setScannedItems((prev) => prev.filter((item) => item.key !== key));
    scanInputRef.current?.focus();
  };

  const handleSubmit = async () => {
    if (scannedItems.length === 0) {
      message.warning('请先扫描商品条码');
      return;
    }
    setIsSubmitting(true);
    await new Promise((r) => setTimeout(r, 1200));
    setIsSubmitting(false);
    message.success(`收货完成！共 ${scannedItems.length} 个 SKU，${scannedItems.reduce((s, i) => s + i.qty, 0)} 件`);
    setScannedItems([]);
    setLastScanStatus('idle');
    scanInputRef.current?.focus();
  };

  const totalQty = scannedItems.reduce((sum, item) => sum + item.qty, 0);
  const errorCount = scannedItems.filter((i) => i.status === 'ERROR').length;

  const alertMap = {
    ok: { type: 'success' as const, message: lastScanMsg },
    error: { type: 'error' as const, message: lastScanMsg },
    duplicate: { type: 'warning' as const, message: lastScanMsg },
    idle: null,
  };
  const currentAlert = alertMap[lastScanStatus];

  const columns = [
    {
      title: '物流条码',
      dataIndex: 'barcode',
      width: 160,
      render: (v: string) => <code className="text-xs bg-gray-100 px-1 rounded">{v}</code>,
    },
    { title: 'SKU', dataIndex: 'sku', width: 120 },
    { title: '商品名称', dataIndex: 'productName', ellipsis: true },
    {
      title: '数量',
      dataIndex: 'qty',
      width: 70,
      render: (v: number) => <Badge count={v} style={{ backgroundColor: '#D23148' }} />,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => {
        if (v === 'OK') return <Tag color="success" icon={<CheckCircleOutlined />}>正常</Tag>;
        if (v === 'DUPLICATE') return <Tag color="warning" icon={<WarningOutlined />}>重复</Tag>;
        return <Tag color="error" icon={<CloseCircleOutlined />}>异常</Tag>;
      },
    },
    { title: '扫描时间', dataIndex: 'scannedAt', width: 90 },
    {
      title: '操作',
      width: 80,
      render: (_: any, record: ScannedItem) => (
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          size="small"
          onClick={() => handleRemoveItem(record.key)}
        />
      ),
    },
  ];

  return (
    <PageContainer
      header={{
        title: '收货操作工作台',
        subTitle: '扫描物流条码，快速登记入库货物',
        extra: [
          <Button key="back" icon={<ArrowLeftOutlined />} onClick={() => navigate('/inbound/receiving')}>
            返回列表
          </Button>,
        ],
      }}
    >
      <Row gutter={[16, 16]}>
        {/* Left: Scan Panel */}
        <Col xs={24} lg={8}>
          <Card
            title={
              <Space>
                <ScanOutlined style={{ color: '#D23148' }} />
                <span>扫码区</span>
              </Space>
            }
            className="shadow-sm"
            style={{ position: 'sticky', top: 80 }}
          >
            <div className="text-center mb-4">
              <div
                className="inline-flex items-center justify-center w-20 h-20 rounded-full mb-3"
                style={{ backgroundColor: '#D23148/10', background: 'rgba(210, 49, 72, 0.08)' }}
              >
                <ScanOutlined style={{ fontSize: 36, color: '#D23148' }} />
              </div>
              <p className="text-sm text-gray-400">请将条码对准扫码枪，或手动输入后按 Enter</p>
            </div>

            <Input
              ref={scanInputRef}
              size="large"
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              onPressEnter={() => handleScan(scanValue)}
              placeholder="扫描 / 输入条码后按 Enter"
              prefix={<ScanOutlined className="text-gray-400" />}
              autoFocus
              allowClear
              style={{ fontSize: 16 }}
            />

            {/* Feedback Alert */}
            {currentAlert && (
              <Alert
                className="mt-3 rounded-lg"
                type={currentAlert.type}
                message={currentAlert.message}
                showIcon
              />
            )}

            <Divider />

            {/* Stats */}
            <Row gutter={16} className="text-center">
              <Col span={12}>
                <Statistic
                  title="已扫 SKU"
                  value={scannedItems.length}
                  valueStyle={{ color: '#D23148', fontSize: 28 }}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title="总件数"
                  value={totalQty}
                  valueStyle={{ color: '#10b981', fontSize: 28 }}
                />
              </Col>
            </Row>
            {errorCount > 0 && (
              <Alert
                className="mt-3"
                type="error"
                message={`⚠️ 共 ${errorCount} 件异常，请确认后提交`}
                showIcon
              />
            )}

            <Button
              type="primary"
              size="large"
              block
              className="mt-4"
              icon={<SaveOutlined />}
              loading={isSubmitting}
              onClick={handleSubmit}
              style={{ backgroundColor: '#D23148', height: 48 }}
              disabled={scannedItems.length === 0}
            >
              提交收货 ({totalQty} 件)
            </Button>
          </Card>
        </Col>

        {/* Right: Scanned List */}
        <Col xs={24} lg={16}>
          <Card
            title={
              <Space>
                <CheckCircleOutlined style={{ color: '#10b981' }} />
                <span>已扫商品明细</span>
                <Tag color="red">{scannedItems.length} SKU</Tag>
              </Space>
            }
            extra={
              scannedItems.length > 0 && (
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => {
                    setScannedItems([]);
                    setLastScanStatus('idle');
                    scanInputRef.current?.focus();
                  }}
                >
                  清空列表
                </Button>
              )
            }
            className="shadow-sm"
          >
            {scannedItems.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <ScanOutlined style={{ fontSize: 48, opacity: 0.3 }} />
                <p className="mt-3">暂无扫描记录，请开始扫码收货</p>
              </div>
            ) : (
              <Table
                dataSource={scannedItems}
                columns={columns}
                size="small"
                rowKey="key"
                pagination={false}
                scroll={{ y: 520 }}
                rowClassName={(record) =>
                  record.status === 'ERROR' ? 'bg-red-50' : record.status === 'DUPLICATE' ? 'bg-yellow-50' : ''
                }
              />
            )}
          </Card>

          {/* Quick Hint */}
          <Card size="small" className="mt-3 bg-blue-50 border-blue-200">
            <Space wrap>
              <Tag color="blue">💡 操作提示</Tag>
              <span className="text-xs text-gray-500">• 支持扫码枪，扫后自动识别</span>
              <span className="text-xs text-gray-500">• 重复扫描同一条码，数量自动加一</span>
              <span className="text-xs text-gray-500">• 未识别条码会显示红色警告</span>
              <span className="text-xs text-gray-500">• 提交前请核对件数无误</span>
            </Space>
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
};

export default ReceivingWorkbench;
