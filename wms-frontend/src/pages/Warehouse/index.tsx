import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  Button, Tag, Space, Progress, Tooltip, Row, Col, Card, Statistic,
  Modal, Form, InputNumber, Input, message, theme,
} from 'antd';
import {
  SearchOutlined, ExportOutlined, EnvironmentOutlined,
  WarningOutlined, EditOutlined,
} from '@ant-design/icons';
import request from '../../utils/request';
import { useCan } from '../../router/permissions';

// Mirrors the flattened row returned by InventoryService.toRow().
interface InventoryItem {
  id: string;
  sku: string;
  productName: string;
  warehouseCode: string;
  locationCode: string;
  batchNo: string;
  availableQty: number;
  frozenQty: number;
  totalQty: number;
  safetyStock: number;
  unit: string;
  lastUpdated: string;
}

// GET /inventory/summary
interface InventorySummary {
  totalSkus: number;
  totalQty: number;
  availableQty: number;
  frozenQty: number;
  lowStockCount: number;
}

const InventoryQuery: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const { token } = theme.useToken();
  const canAdjust = useCan('inventory.adjust'); // POST /inventory/adjust — OPS roles only

  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [adjustRow, setAdjustRow] = useState<InventoryItem | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [form] = Form.useForm();

  const loadSummary = useCallback(async () => {
    try {
      const res: any = await request.get('/inventory/summary');
      setSummary(res?.data ?? null);
    } catch {
      // request.ts interceptor surfaces errors
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // Only sku / locationCode / customerName are supported server-side; sending
  // anything else would be silently ignored and make the search bar lie.
  const fetchInventory = async (params: any) => {
    const { current, pageSize, sku, locationCode, customerName } = params || {};
    const res: any = await request.get('/inventory', {
      params: { page: current, pageSize, sku, locationCode, customerName },
    });
    return {
      data: res?.data ?? [],
      success: true,
      total: res?.pagination?.total ?? (res?.data?.length ?? 0),
    };
  };

  const openAdjust = (row: InventoryItem) => {
    setAdjustRow(row);
    form.resetFields();
  };

  const submitAdjust = () => {
    form.validateFields().then(async (vals) => {
      if (!adjustRow) return;
      setAdjusting(true);
      try {
        const res: any = await request.post('/inventory/adjust', {
          sku: adjustRow.sku,
          locationCode: adjustRow.locationCode,
          deltaQty: vals.deltaQty,
          reason: vals.reason || undefined,
        });
        // adjust() returns `false` (not a 404) when no row matches sku+locationCode.
        if (res?.data === false) {
          message.warning('未找到匹配的库存记录，未做任何调整');
          return;
        }
        message.success(`${adjustRow.sku} 调整完成，可用库存 ${res?.data?.availableQty}`);
        setAdjustRow(null);
        form.resetFields();
        actionRef.current?.reload();
        loadSummary();
      } catch {
        // Negative-stock guard etc. are surfaced by the interceptor
      } finally {
        setAdjusting(false);
      }
    });
  };

  const columns: ProColumns<InventoryItem>[] = [
    {
      title: 'SKU',
      dataIndex: 'sku',
      copyable: true,
      width: 120,
      fixed: 'left',
    },
    {
      title: '商品名称',
      dataIndex: 'productName',
      ellipsis: true,
      width: 200,
      search: false, // no productName filter server-side
    },
    {
      // Search-only: the list response doesn't carry customerName, but the
      // backend does filter on it (Inventory.customer relation).
      title: '客户',
      dataIndex: 'customerName',
      hideInTable: true,
    },
    {
      title: '仓库',
      dataIndex: 'warehouseCode',
      width: 110,
      search: false,
    },
    {
      title: '库位',
      dataIndex: 'locationCode',
      width: 110,
      render: (v) => (
        <Tag icon={<EnvironmentOutlined />} color="geekblue">{v as string}</Tag>
      ),
    },
    {
      title: '批次号',
      dataIndex: 'batchNo',
      width: 170,
      search: false,
      ellipsis: true,
      render: (_, r) => r.batchNo || '—',
    },
    {
      title: '可用库存',
      dataIndex: 'availableQty',
      width: 100,
      search: false,
      render: (v, record) => {
        const low = record.safetyStock > 0 && (v as number) < record.safetyStock;
        return (
          <Space>
            <span
              className="font-bold text-base"
              style={{ color: low ? token.colorError : token.colorSuccess }}
            >
              {v as number}
            </span>
            {low && (
              <Tooltip title={`低于安全库存 ${record.safetyStock} ${record.unit}`}>
                <WarningOutlined style={{ color: token.colorError }} />
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: '冻结库存',
      dataIndex: 'frozenQty',
      width: 90,
      search: false,
      render: (v) => <span style={{ color: token.colorWarning }}>{v as number}</span>,
    },
    {
      title: '总库存',
      dataIndex: 'totalQty',
      width: 90,
      search: false,
    },
    {
      title: '库存水位',
      dataIndex: 'availableQty',
      key: 'stockLevel',
      width: 130,
      search: false,
      render: (_, record) => {
        // safetyStock 0 means "not configured" — show a full bar rather than
        // implying the row is in trouble.
        const percent = record.safetyStock > 0
          ? Math.min(100, Math.round((record.availableQty / (record.safetyStock * 2)) * 100))
          : 100;
        const color = record.availableQty === 0
          ? token.colorError
          : record.safetyStock > 0 && record.availableQty < record.safetyStock
          ? token.colorWarning
          : token.colorSuccess;
        return (
          <Tooltip
            title={record.safetyStock > 0
              ? `安全库存: ${record.safetyStock} ${record.unit}`
              : '未设置安全库存'}
          >
            <Progress percent={percent} size="small" strokeColor={color} showInfo={false} />
          </Tooltip>
        );
      },
    },
    {
      title: '单位',
      dataIndex: 'unit',
      width: 60,
      search: false,
    },
    {
      title: '最后更新',
      dataIndex: 'lastUpdated',
      width: 160,
      search: false,
      valueType: 'dateTime',
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      search: false,
      fixed: 'right',
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          icon={<EditOutlined />}
          disabled={!canAdjust}
          onClick={() => openAdjust(record)}
        >
          调整
        </Button>
      ),
    },
  ];

  return (
    <PageContainer
      header={{
        title: '实时库存查询',
        subTitle: '查询各仓库 SKU 的当前可用库存、冻结量与库位信息',
      }}
    >
      <Row gutter={[16, 16]} className="mb-4">
        <Col xs={12} md={6} lg={5}>
          <Card size="small">
            <Statistic title="SKU 种类" value={summary?.totalSkus ?? '-'} />
          </Card>
        </Col>
        <Col xs={12} md={6} lg={5}>
          <Card size="small">
            <Statistic title="总库存" value={summary?.totalQty ?? '-'} />
          </Card>
        </Col>
        <Col xs={12} md={6} lg={5}>
          <Card size="small">
            <Statistic
              title="可用库存"
              value={summary?.availableQty ?? '-'}
              valueStyle={{ color: token.colorSuccess }}
            />
          </Card>
        </Col>
        <Col xs={12} md={6} lg={5}>
          <Card size="small">
            <Statistic
              title="冻结库存"
              value={summary?.frozenQty ?? '-'}
              valueStyle={{ color: token.colorWarning }}
            />
          </Card>
        </Col>
        <Col xs={24} md={24} lg={4}>
          <Card size="small">
            <Statistic
              title="低于安全库存"
              value={summary?.lowStockCount ?? '-'}
              valueStyle={{
                color: summary?.lowStockCount ? token.colorError : undefined,
              }}
            />
          </Card>
        </Col>
      </Row>

      <ProTable<InventoryItem>
        columns={columns}
        actionRef={actionRef}
        cardBordered
        request={fetchInventory}
        rowKey="id"
        scroll={{ x: 1400 }}
        search={{
          labelWidth: 'auto',
          collapsed: false,
        }}
        pagination={{
          pageSize: 15,
          showSizeChanger: true,
        }}
        dateFormatter="string"
        headerTitle={
          <Space>
            <SearchOutlined style={{ color: token.colorPrimary }} />
            <span>库存明细</span>
          </Space>
        }
        toolBarRender={() => [
          <Button key="export" icon={<ExportOutlined />}>
            导出 Excel
          </Button>,
        ]}
        rowClassName={(record) =>
          record.availableQty === 0
            ? 'bg-red-50'
            : record.safetyStock > 0 && record.availableQty < record.safetyStock
            ? 'bg-orange-50'
            : ''
        }
        summary={(pageData) => {
          const totalAvail = pageData.reduce((sum, r) => sum + r.availableQty, 0);
          const totalFrozen = pageData.reduce((sum, r) => sum + r.frozenQty, 0);
          const totalAll = pageData.reduce((sum, r) => sum + r.totalQty, 0);
          return (
            <tr className="bg-slate-50 font-bold">
              <td colSpan={5} className="px-4 py-2 text-right text-slate-600">本页合计：</td>
              <td className="px-4 py-2" style={{ color: token.colorSuccess }}>{totalAvail}</td>
              <td className="px-4 py-2" style={{ color: token.colorWarning }}>{totalFrozen}</td>
              <td className="px-4 py-2">{totalAll}</td>
              <td colSpan={4} />
            </tr>
          );
        }}
      />

      <Modal
        title={adjustRow ? `调整库存 · ${adjustRow.sku}` : '调整库存'}
        open={!!adjustRow}
        onCancel={() => setAdjustRow(null)}
        onOk={submitAdjust}
        confirmLoading={adjusting}
        okText="提交调整"
        cancelText="取消"
        destroyOnHidden
      >
        {adjustRow && (
          <>
            <div className="mb-4 text-sm text-slate-500">
              <div>商品：{adjustRow.productName}</div>
              <div>库位：{adjustRow.locationCode}（仓库 {adjustRow.warehouseCode}）</div>
              <div>
                当前：可用 {adjustRow.availableQty} / 冻结 {adjustRow.frozenQty} / 总量{' '}
                {adjustRow.totalQty} {adjustRow.unit}
              </div>
            </div>
            <Form form={form} layout="vertical">
              <Form.Item
                label="调整数量（可为负）"
                name="deltaQty"
                rules={[
                  { required: true, message: '请输入调整数量' },
                  {
                    type: 'integer',
                    message: '调整数量必须为整数',
                  },
                ]}
                extra="正数增加、负数减少；调整后可用库存与总量不得为负"
              >
                <InputNumber style={{ width: '100%' }} precision={0} placeholder="例如 10 或 -5" />
              </Form.Item>
              <Form.Item label="调整原因" name="reason">
                <Input.TextArea rows={2} placeholder="选填，例如：盘点差异修正" />
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>
    </PageContainer>
  );
};

export default InventoryQuery;
