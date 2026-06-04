import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import {
  Card, Row, Col, Input, Button, Table, Tag, Alert,
  Space, Select, Statistic, Divider, message, Badge, Progress
} from 'antd';
import {
  ScanOutlined, CheckCircleOutlined, ArrowUpOutlined,
  ArrowLeftOutlined, EnvironmentOutlined, SaveOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import request from '../../../utils/request';

const { Option } = Select;

interface BackendTask {
  id: string;
  taskNo: string;
  sku: string;
  productName: string;
  qty: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  receivingNo?: string;
  recommendedLocationId?: string | null;
  recommendedLocationCode?: string | null;
}

interface BackendLocation {
  id: string;
  code: string;
  status: 'EMPTY' | 'OCCUPIED' | 'RESERVED' | 'DISABLED';
}

interface PutawayItem {
  key: string;
  taskId: string;
  taskNo: string;
  barcode: string;
  sku: string;
  productName: string;
  qty: number;
  recommendedLocationId: string | null;
  recommendedLocationCode: string | null;
  actualLocationCode: string | null;
  actualLocationId: string | null;
  status: 'PENDING' | 'DONE';
  scannedAt: string;
}

const PutawayWorkbench: React.FC = () => {
  const navigate = useNavigate();
  const scanRef = useRef<any>(null);

  const [scanValue, setScanValue] = useState('');
  const [items, setItems] = useState<PutawayItem[]>([]);
  const [lastStatus, setLastStatus] = useState<'idle' | 'ok' | 'error' | 'dup'>('idle');
  const [lastMsg, setLastMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [quickMode, setQuickMode] = useState(false);

  // ─── Real backend data ──────────────────────────────────────────────
  const [pendingTasks, setPendingTasks] = useState<BackendTask[]>([]);
  const [locations, setLocations] = useState<BackendLocation[]>([]);

  const reload = useCallback(async () => {
    try {
      const [tasksRes, locsRes]: any[] = await Promise.all([
        request.get('/putaway-tasks', { params: { status: 'PENDING', pageSize: 100 } }),
        request.get('/locations', { params: { status: 'EMPTY' } }),
      ]);
      setPendingTasks(tasksRes?.data ?? []);
      setLocations(locsRes?.data ?? []);
    } catch {
      // request.ts interceptor surfaces errors
    }
  }, []);

  useEffect(() => {
    reload();
    scanRef.current?.focus();
  }, [reload]);

  const handleScan = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;

    // Match scanned value against task SKU. (Backend has product.barcode but
    // PutawayTask.list flattens to sku only — match by sku for now.)
    const task = pendingTasks.find((t) => t.sku === trimmed);
    if (!task) {
      setLastStatus('error');
      setLastMsg(`❌ 未找到 SKU 为 ${trimmed} 的待上架任务`);
      message.error(`未识别：${trimmed}`);
      setScanValue('');
      return;
    }

    // Already staged?
    const stagedIdx = items.findIndex((i) => i.taskId === task.id);
    if (stagedIdx !== -1) {
      setLastStatus('dup');
      setLastMsg(`⚠️ 任务 ${task.taskNo} 已在列表中`);
      setScanValue('');
      return;
    }

    const quickLoc =
      quickMode && selectedLocationId
        ? locations.find((l) => l.id === selectedLocationId)
        : null;

    // Without quick mode, fall back to the backend's recommended location — but
    // only if it is still EMPTY/available in the loaded locations list.
    const recLoc =
      !quickLoc && task.recommendedLocationId
        ? locations.find((l) => l.id === task.recommendedLocationId)
        : null;
    const assignedLoc = quickLoc ?? recLoc;

    const newItem: PutawayItem = {
      key: `${task.id}-${Date.now()}`,
      taskId: task.id,
      taskNo: task.taskNo,
      barcode: trimmed,
      sku: task.sku,
      productName: task.productName,
      qty: task.qty,
      recommendedLocationId: task.recommendedLocationId ?? null,
      recommendedLocationCode: task.recommendedLocationCode ?? null,
      actualLocationCode: assignedLoc?.code ?? null,
      actualLocationId: assignedLoc?.id ?? null,
      status: assignedLoc ? 'DONE' : 'PENDING',
      scannedAt: new Date().toLocaleTimeString('zh-CN'),
    };
    setItems((prev) => [newItem, ...prev]);
    setLastStatus('ok');
    setLastMsg(
      `✅ ${task.productName} × ${task.qty}${assignedLoc ? ` → ${assignedLoc.code}` : '（待分配库位）'}`
    );
    setScanValue('');
  };

  const handleAssignLocation = (itemKey: string, locationId: string) => {
    const loc = locations.find((l) => l.id === locationId);
    if (!loc) return;
    setItems((prev) =>
      prev.map((i) =>
        i.key === itemKey
          ? { ...i, actualLocationId: loc.id, actualLocationCode: loc.code, status: 'DONE' }
          : i,
      ),
    );
  };

  const handleSubmit = async () => {
    const pending = items.filter((i) => i.status === 'PENDING');
    if (pending.length > 0) {
      message.warning(`还有 ${pending.length} 件商品未分配库位`);
      return;
    }
    setIsSubmitting(true);
    let okCount = 0;
    let errCount = 0;
    for (const it of items) {
      if (!it.actualLocationId) continue;
      try {
        await request.put(`/putaway-tasks/${it.taskId}/putaway`, {
          locationId: it.actualLocationId,
          qty: it.qty,
        });
        okCount += 1;
      } catch {
        errCount += 1;
      }
    }
    setIsSubmitting(false);
    if (errCount === 0) {
      message.success(`上架完成！共 ${okCount} 个任务已归位`);
    } else {
      message.warning(`完成 ${okCount} / ${items.length}，失败 ${errCount}`);
    }
    setItems([]);
    setLastStatus('idle');
    await reload();
    scanRef.current?.focus();
  };

  const doneCount = items.filter((i) => i.status === 'DONE').length;
  const progress = items.length === 0 ? 0 : Math.round((doneCount / items.length) * 100);

  const alertMap: Record<string, 'success' | 'error' | 'warning' | 'info'> = {
    ok: 'success', error: 'error', dup: 'warning', idle: 'info',
  };

  const columns = [
    {
      title: '任务号',
      dataIndex: 'taskNo',
      width: 140,
      render: (v: string) => <code className="text-xs bg-gray-100 px-1 rounded">{v}</code>,
    },
    { title: 'SKU', dataIndex: 'sku', width: 110 },
    { title: '商品名称', dataIndex: 'productName', ellipsis: true },
    { title: '数量', dataIndex: 'qty', width: 60 },
    {
      title: '建议库位',
      dataIndex: 'recommendedLocationCode',
      width: 150,
      render: (v: string | null, record: PutawayItem) => {
        if (!v) return <span className="text-gray-300">—</span>;
        const stillEmpty = locations.some((l) => l.id === record.recommendedLocationId);
        const adopted = record.actualLocationId === record.recommendedLocationId;
        return (
          <Space size={4}>
            <Tag color="blue">{v}</Tag>
            {!adopted && stillEmpty && (
              <Button
                type="link"
                size="small"
                style={{ padding: 0 }}
                onClick={() => handleAssignLocation(record.key, record.recommendedLocationId!)}
              >
                采用
              </Button>
            )}
          </Space>
        );
      },
    },
    {
      title: '实际库位',
      dataIndex: 'actualLocationCode',
      width: 180,
      render: (v: string | null, record: PutawayItem) =>
        v ? (
          <Tag color="success" icon={<CheckCircleOutlined />}>{v}</Tag>
        ) : (
          <Select
            size="small"
            style={{ width: 160 }}
            placeholder="选择库位"
            onChange={(loc) => handleAssignLocation(record.key, loc)}
            showSearch
            optionFilterProp="children"
          >
            {locations.map((l) => (
              <Option key={l.id} value={l.id}>{l.code}</Option>
            ))}
          </Select>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: string) =>
        v === 'DONE'
          ? <Tag color="success">已分配</Tag>
          : <Tag color="warning">待分配</Tag>,
    },
    { title: '扫描时间', dataIndex: 'scannedAt', width: 85 },
  ];

  return (
    <PageContainer
      header={{
        title: '上架管理工作台',
        subTitle: `扫描入库商品 SKU，分配仓库库位完成上架（当前 ${pendingTasks.length} 个待上架任务，${locations.length} 个空库位）`,
        extra: [
          <Button key="back" icon={<ArrowLeftOutlined />} onClick={() => navigate('/inbound/receiving')}>
            返回收货列表
          </Button>,
        ],
      }}
    >
      <Row gutter={[16, 16]}>
        {/* Left: Scan + Config */}
        <Col xs={24} lg={8}>
          <Card
            title={<Space><ScanOutlined style={{ color: '#D23148' }} /><span>扫码上架</span></Space>}
            className="shadow-sm"
            style={{ position: 'sticky', top: 80 }}
          >
            <div className="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-700">快捷上架模式</span>
                <Button
                  size="small"
                  type={quickMode ? 'primary' : 'default'}
                  onClick={() => setQuickMode(!quickMode)}
                  style={quickMode ? { backgroundColor: '#D23148' } : {}}
                >
                  {quickMode ? '已开启' : '开启'}
                </Button>
              </div>
              {quickMode && (
                <Select
                  style={{ width: '100%' }}
                  placeholder="选择目标库位"
                  onChange={setSelectedLocationId}
                  value={selectedLocationId}
                  showSearch
                  optionFilterProp="children"
                >
                  {locations.map((l) => (
                    <Option key={l.id} value={l.id}>
                      <EnvironmentOutlined className="mr-1" />{l.code}
                    </Option>
                  ))}
                </Select>
              )}
              <p className="text-xs text-slate-400 mt-2">
                {quickMode ? '扫码后将自动分配到所选库位' : '开启后可批量分配同一库位'}
              </p>
            </div>

            <Input
              ref={scanRef}
              size="large"
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              onPressEnter={() => handleScan(scanValue)}
              placeholder="扫描商品 SKU / Enter 确认"
              prefix={<ScanOutlined className="text-gray-400" />}
              autoFocus
              allowClear
              style={{ fontSize: 16 }}
            />

            {lastStatus !== 'idle' && (
              <Alert
                className="mt-3 rounded-lg"
                type={alertMap[lastStatus]}
                message={lastMsg}
                showIcon
              />
            )}

            <Divider />

            <Row gutter={16} className="text-center mb-4">
              <Col span={12}>
                <Statistic title="已扫任务" value={items.length} valueStyle={{ color: '#D23148', fontSize: 26 }} />
              </Col>
              <Col span={12}>
                <Statistic title="已分配" value={doneCount} valueStyle={{ color: '#10b981', fontSize: 26 }} />
              </Col>
            </Row>

            {items.length > 0 && (
              <Progress
                percent={progress}
                strokeColor={{ '0%': '#D23148', '100%': '#10b981' }}
                className="mb-4"
              />
            )}

            <Button
              type="primary"
              size="large"
              block
              icon={<SaveOutlined />}
              loading={isSubmitting}
              onClick={handleSubmit}
              disabled={items.length === 0 || doneCount < items.length}
              style={{ backgroundColor: '#D23148', height: 48 }}
            >
              {doneCount < items.length && items.length > 0
                ? `还有 ${items.length - doneCount} 件待分配`
                : `提交上架 (${doneCount} 件)`}
            </Button>
          </Card>
        </Col>

        {/* Right: Item List */}
        <Col xs={24} lg={16}>
          <Card
            title={
              <Space>
                <ArrowUpOutlined style={{ color: '#D23148' }} />
                <span>待上架商品</span>
                <Badge count={items.filter((i) => i.status === 'PENDING').length} style={{ backgroundColor: '#f97316' }} />
              </Space>
            }
            extra={
              items.length > 0 && (
                <Button type="text" danger size="small" onClick={() => { setItems([]); setLastStatus('idle'); }}>
                  清空
                </Button>
              )
            }
            className="shadow-sm"
          >
            {items.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <ArrowUpOutlined style={{ fontSize: 48, opacity: 0.3 }} />
                <p className="mt-3">
                  {pendingTasks.length === 0
                    ? '当前无待上架任务，请先完成入库收货'
                    : `请扫描 SKU 开始上架（${pendingTasks.length} 个待上架）`}
                </p>
              </div>
            ) : (
              <Table
                dataSource={items}
                columns={columns}
                size="small"
                rowKey="key"
                pagination={false}
                scroll={{ y: 520 }}
                rowClassName={(r) => (r.status === 'DONE' ? 'bg-green-50' : 'bg-orange-50')}
              />
            )}
          </Card>

          <Card size="small" className="mt-3 bg-blue-50 border-blue-200">
            <Space wrap>
              <Tag color="blue">💡 操作提示</Tag>
              <span className="text-xs text-gray-500">• 仅 EMPTY 状态库位会出现在选择列表</span>
              <span className="text-xs text-gray-500">• 蓝色"建议库位"由上架策略自动推荐，扫码后自动预填，可点"采用"快速分配</span>
              <span className="text-xs text-gray-500">• 开启快捷模式可批量上架到同一库位</span>
              <span className="text-xs text-gray-500">• 所有商品分配库位后方可提交</span>
            </Space>
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
};

export default PutawayWorkbench;
