import React, { useRef, useState, useEffect } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Dropdown, Popconfirm, message, Drawer, Descriptions, Table, Spin, Empty, Button, Modal, Form, Select, InputNumber, Input, Space, Divider } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
import request from '../../utils/request';
import Authorized from '../../components/Authorized';

type OutboundStatus =
  | 'PENDING'
  | 'ALLOCATED'
  | 'WAVE_ASSIGNED'
  | 'PICKING'
  | 'PICKED'
  | 'PACKING'
  | 'PACKED'
  | 'SHIPPED'
  | 'SIGNED'
  | 'EXCEPTION'
  | 'CANCELLED';

interface OutboundOrderRow {
  id: string;
  orderNo: string;
  customerName: string;
  totalItems: number;
  status: OutboundStatus;
  createdAt: string;
  // Fulfillment fields surfaced as list columns (list() already returns all scalars via ...rest).
  recipientName?: string | null;
  carrier?: string | null;
  trackingNo?: string | null;
  fee?: string | null; // Prisma Decimal → string
}

// Mirrors backend OUTBOUND_TRANSITIONS — list-page actions only.
// `pack` (scan-based, requires {sku,qty,boxNo?}) belongs to the packing page.
// `EXCEPTION → PENDING` is allowed by the state machine but has no API endpoint,
// so only `cancel` is exposed from EXCEPTION rows.
const ACTIONS: Partial<Record<OutboundStatus, Array<{ key: string; label: string; endpoint: string; danger?: boolean }>>> = {
  PENDING: [
    { key: 'allocate', label: '分配库存', endpoint: 'allocate' },
    { key: 'cancel', label: '取消', endpoint: 'cancel', danger: true },
    { key: 'exception', label: '标记异常', endpoint: 'exception', danger: true },
  ],
  ALLOCATED: [
    { key: 'start-picking', label: '开始拣货', endpoint: 'start-picking' },
    { key: 'cancel', label: '取消', endpoint: 'cancel', danger: true },
    { key: 'exception', label: '标记异常', endpoint: 'exception', danger: true },
  ],
  WAVE_ASSIGNED: [
    { key: 'start-picking', label: '开始拣货', endpoint: 'start-picking' },
    { key: 'cancel', label: '取消', endpoint: 'cancel', danger: true },
    { key: 'exception', label: '标记异常', endpoint: 'exception', danger: true },
  ],
  PICKING: [
    { key: 'complete-picking', label: '完成拣货', endpoint: 'complete-picking' },
    { key: 'exception', label: '标记异常', endpoint: 'exception', danger: true },
  ],
  PICKED: [
    { key: 'start-packing', label: '开始打包', endpoint: 'start-packing' },
    { key: 'exception', label: '标记异常', endpoint: 'exception', danger: true },
  ],
  PACKING: [
    // Per-item scan (POST /pack with {sku,qty,boxNo?}) lives on the packing page.
    { key: 'complete-packing', label: '完成打包', endpoint: 'complete-packing' },
    { key: 'exception', label: '标记异常', endpoint: 'exception', danger: true },
  ],
  PACKED: [
    { key: 'ship', label: '签出发货', endpoint: 'ship' },
    { key: 'exception', label: '标记异常', endpoint: 'exception', danger: true },
  ],
  SHIPPED: [
    { key: 'sign', label: '物流确认', endpoint: 'sign' },
  ],
  EXCEPTION: [
    { key: 'cancel', label: '取消', endpoint: 'cancel', danger: true },
  ],
};

// Fulfillment field groups rendered in the detail drawer (mirrors the OutboundOrder schema sections).
const DETAIL_GROUPS: Array<{ title: string; fields: Array<{ key: string; label: string }> }> = [
  {
    title: '收件信息',
    fields: [
      { key: 'recipientName', label: '收件人' },
      { key: 'recipientCompany', label: '公司' },
      { key: 'recipientPhone', label: '电话' },
      { key: 'recipientEmail', label: '邮箱' },
      { key: 'recipientCountry', label: '国家' },
      { key: 'recipientProvince', label: '省/州' },
      { key: 'recipientCity', label: '城市' },
      { key: 'recipientDistrict', label: '区' },
      { key: 'recipientZip', label: '邮编' },
      { key: 'recipientAddress1', label: '地址1' },
      { key: 'recipientAddress2', label: '地址2' },
      { key: 'recipientAddress3', label: '地址3' },
      { key: 'shipToCode', label: '收货地址代码' },
      { key: 'addressType', label: '地址分类' },
      { key: 'remark', label: '备注' },
    ],
  },
  {
    title: '承运与跟踪',
    fields: [
      { key: 'carrier', label: '承运商' },
      { key: 'trackingNo', label: '跟踪号' },
      { key: 'trackingNo1', label: '跟踪号1' },
      { key: 'trackingTrace', label: '最新轨迹' },
      { key: 'trackingTrace1', label: '最新轨迹1' },
      { key: 'multiPackage', label: '一票多件' },
    ],
  },
  {
    title: '发货人与服务',
    fields: [
      { key: 'shipperNameZh', label: '发货人(中)' },
      { key: 'shipperNameEn', label: '发货人(英)' },
      { key: 'shipperId', label: '发货人ID' },
      { key: 'serviceName', label: '服务名称' },
      { key: 'serviceLocked', label: '锁定服务' },
      { key: 'serviceUpdated', label: '服务已更新' },
    ],
  },
  {
    title: '引用与来源',
    fields: [
      { key: 'customerRef', label: '客户参考号' },
      { key: 'platformRef', label: '平台参考号' },
      { key: 'platformCode', label: '平台代码' },
      { key: 'orderSource', label: '订单来源' },
      { key: 'creator', label: '创建人' },
      { key: 'inboundOrderNo', label: '所属入库单' },
      { key: 'inboundContainerNo', label: '入库柜号' },
    ],
  },
  {
    title: '费用',
    fields: [
      { key: 'transactionAmount', label: '交易金额' },
      { key: 'transactionCurrency', label: '交易币种' },
      { key: 'fee', label: '费用' },
    ],
  },
  {
    title: '重量 / 体积 / 包裹',
    fields: [
      { key: 'totalWeightKg', label: '总重量(KG)' },
      { key: 'totalVolumeCbm', label: '总体积(CBM)' },
      { key: 'packageLength', label: '长' },
      { key: 'packageWidth', label: '宽' },
      { key: 'packageHeight', label: '高' },
      { key: 'packageActualWeight', label: '实际重量' },
      { key: 'packageBillingWeight', label: '计费重量' },
      { key: 'packageActualVolume', label: '实际体积' },
    ],
  },
  {
    title: '生命周期',
    fields: [
      { key: 'pickingType', label: '拣货类型' },
      { key: 'submittedAt', label: '提交时间' },
      { key: 'shippedAt', label: '出库时间' },
      { key: 'cancelledAt', label: '取消时间' },
      { key: 'exceptionReason', label: '异常原因' },
      { key: 'cancelResult', label: '取消结果' },
    ],
  },
];

// Display a raw detail value: booleans → 是/否, *At datetimes → trimmed, empty → '-'.
const fmtDetail = (key: string, val: unknown): string => {
  if (val === null || val === undefined || val === '') return '-';
  if (typeof val === 'boolean') return val ? '是' : '否';
  if (/At$/.test(key) && typeof val === 'string') return val.replace('T', ' ').slice(0, 19);
  return String(val);
};

type OutboundDetail = Record<string, any> & {
  orderNo: string;
  customerName: string;
  status: string;
  warehouseCode: string | null;
  warehouseAddress: string | null;
  totalProductCount: number;
  items: Array<{ sku?: string; productName?: string; requiredQty: number; pickedQty: number; packedQty: number }>;
  exceptions: Array<{ id: string; exceptionNo?: string; type?: string; reason?: string; status?: string }>;
};

// Optional fulfillment fields offered in the create form (key subset of the 51; all @IsOptional in the DTO).
const FULFILLMENT_OPTIONAL_FIELDS: Array<{ name: string; label: string }> = [
  { name: 'recipientName', label: '收件人' },
  { name: 'recipientPhone', label: '电话' },
  { name: 'recipientCountry', label: '国家' },
  { name: 'recipientProvince', label: '省/州' },
  { name: 'recipientCity', label: '城市' },
  { name: 'recipientAddress1', label: '收件地址' },
  { name: 'carrier', label: '承运商' },
  { name: 'trackingNo', label: '跟踪号' },
  { name: 'remark', label: '备注' },
];

// Create a single outbound order. Selectors populate from /customers, /warehouses, /products on open.
const CreateOrderModal: React.FC<{ open: boolean; onClose: () => void; onSuccess: () => void }> = ({
  open,
  onClose,
  onSuccess,
}) => {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [customers, setCustomers] = useState<Array<{ label: string; value: string }>>([]);
  const [warehouses, setWarehouses] = useState<Array<{ label: string; value: string }>>([]);
  const [products, setProducts] = useState<Array<{ label: string; value: string }>>([]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const [c, w, p]: any[] = await Promise.all([
          request.get('/customers', { params: { pageSize: 200 } }),
          request.get('/warehouses'),
          request.get('/products', { params: { pageSize: 500 } }),
        ]);
        setCustomers((c?.data ?? []).map((x: any) => ({ value: x.id, label: `${x.name}${x.customerCode ? ` (${x.customerCode})` : ''}` })));
        setWarehouses((w?.data ?? []).map((x: any) => ({ value: x.id, label: `${x.code}${x.name ? ` · ${x.name}` : ''}` })));
        setProducts((p?.data ?? []).map((x: any) => ({ value: x.id, label: `${x.sku}${x.name ? ` · ${x.name}` : ''}` })));
      } catch {
        // request interceptor surfaces the error
      }
    })();
  }, [open]);

  const handleOk = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await request.post('/outbound-orders', values);
      message.success('出库单已创建');
      form.resetFields();
      onSuccess();
      onClose();
    } catch {
      // request interceptor surfaces the error
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="新建出库单" open={open} onOk={handleOk} confirmLoading={submitting} onCancel={onClose} width={720} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ items: [{}] }}>
        <Form.Item name="customerId" label="客户" rules={[{ required: true, message: '请选择客户' }]}>
          <Select showSearch optionFilterProp="label" options={customers} placeholder="选择客户" />
        </Form.Item>
        <Form.Item name="warehouseId" label="海外仓" rules={[{ required: true, message: '请选择仓库' }]}>
          <Select showSearch optionFilterProp="label" options={warehouses} placeholder="选择仓库" />
        </Form.Item>

        <div className="font-medium mb-2">商品明细</div>
        <Form.List name="items">
          {(fields, { add, remove }) => (
            <div className="flex flex-col gap-2 mb-2">
              {fields.map(({ key, name }) => (
                <Space key={key} align="baseline">
                  <Form.Item name={[name, 'productId']} rules={[{ required: true, message: '选择商品' }]} className="mb-0">
                    <Select showSearch optionFilterProp="label" options={products} placeholder="商品 SKU" style={{ width: 380 }} />
                  </Form.Item>
                  <Form.Item name={[name, 'requiredQty']} rules={[{ required: true, message: '数量' }]} className="mb-0">
                    <InputNumber min={1} placeholder="数量" />
                  </Form.Item>
                  {fields.length > 1 && (
                    <a className="text-red-500" onClick={() => remove(name)}>
                      删除
                    </a>
                  )}
                </Space>
              ))}
              <a onClick={() => add()}>+ 添加明细行</a>
            </div>
          )}
        </Form.List>

        <Divider orientation="left" plain>
          履约信息（选填）
        </Divider>
        <div className="grid grid-cols-2 gap-x-4">
          {FULFILLMENT_OPTIONAL_FIELDS.map((f) => (
            <Form.Item key={f.name} name={f.name} label={f.label}>
              <Input />
            </Form.Item>
          ))}
        </div>
      </Form>
    </Modal>
  );
};

// Bulk-import outbound orders from pasted JSON (POST /outbound-orders/bulk-import).
const BulkImportModal: React.FC<{ open: boolean; onClose: () => void; onSuccess: () => void }> = ({
  open,
  onClose,
  onSuccess,
}) => {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ created: number; total: number; orderNos: string[]; errors: string[] } | null>(null);

  const close = () => {
    setText('');
    setResult(null);
    onClose();
  };

  const handleOk = async () => {
    let payload: { orders: unknown[] };
    try {
      const parsed = JSON.parse(text);
      payload = Array.isArray(parsed) ? { orders: parsed } : parsed;
    } catch {
      message.error('JSON 解析失败，请检查格式');
      return;
    }
    if (!payload?.orders || !Array.isArray(payload.orders) || payload.orders.length === 0) {
      message.error('需提供 orders 数组（至少 1 单）');
      return;
    }
    setSubmitting(true);
    try {
      const res: any = await request.post('/outbound-orders/bulk-import', payload);
      setResult(res?.data ?? null);
      if ((res?.data?.created ?? 0) > 0) onSuccess();
    } catch {
      // request interceptor surfaces the error
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="批量导入出库单 (JSON)" open={open} onOk={handleOk} confirmLoading={submitting} onCancel={close} width={680} okText="导入" destroyOnHidden>
      <div className="text-sm mb-2" style={{ color: '#888' }}>
        粘贴出库单 JSON：数组 [&#123;...&#125;] 或 &#123;"orders":[...]&#125;。每单需含 customerId / warehouseId / items[]（productId + requiredQty）。
      </div>
      <Input.TextArea
        rows={10}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'[{"customerId":"...","warehouseId":"...","items":[{"productId":"...","requiredQty":1}]}]'}
      />
      {result && (
        <div className="mt-3">
          <div>
            成功 {result.created} / {result.total}；单号：{result.orderNos?.join(', ') || '-'}
          </div>
          {result.errors?.length > 0 && (
            <ul className="mt-1" style={{ color: '#cf1322' }}>
              {result.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
};

const OutboundList: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<OutboundDetail | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const openDetail = async (id: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailData(null);
    try {
      const res: any = await request.get(`/outbound-orders/${id}`);
      // request interceptor returns the full envelope { code, message, data }; the order is at .data.
      setDetailData(res?.data ?? null);
    } catch {
      setDetailData(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const fetchOutbound = async (params: any) => {
    const { current, pageSize, ...rest } = params || {};
    const res: any = await request.get('/outbound-orders', {
      params: { page: current, pageSize, ...rest },
    });
    return {
      data: res?.data ?? [],
      success: true,
      total: res?.pagination?.total ?? (res?.data?.length ?? 0),
    };
  };

  const runAction = async (id: string, endpoint: string) => {
    let body: Record<string, unknown> | undefined;
    if (endpoint === 'exception') {
      // Backend requires {type, reason?}. Sprint 6 exception center page will replace with proper Modal.
      const type = window.prompt('请输入异常类型 (如：缺货/破损/地址错误)');
      if (!type) return;
      const reason = window.prompt('请输入异常说明 (可留空)') || undefined;
      body = { type, reason };
    }
    try {
      await request.post(`/outbound-orders/${id}/${endpoint}`, body);
      message.success('操作成功');
      actionRef.current?.reload();
    } catch {
      // request.ts interceptor already surfaces the error message
    }
  };

  const columns: ProColumns<OutboundOrderRow>[] = [
    {
      title: '出库单号',
      dataIndex: 'orderNo',
      copyable: true,
      width: 180,
    },
    {
      title: '客户名称',
      dataIndex: 'customerName',
      ellipsis: true,
    },
    {
      title: 'SKU件数',
      dataIndex: 'totalItems',
      width: 100,
      search: false,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      valueEnum: {
        PENDING:       { text: '待分配',   status: 'Default' },
        ALLOCATED:     { text: '已分配',   status: 'Processing' },
        WAVE_ASSIGNED: { text: '已加波次', status: 'Processing' },
        PICKING:       { text: '拣货中',   status: 'Processing' },
        PICKED:        { text: '拣货完成', status: 'Success' },
        PACKING:       { text: '打包中',   status: 'Processing' },
        PACKED:        { text: '已打包',   status: 'Success' },
        SHIPPED:       { text: '已发货',   status: 'Success' },
        SIGNED:        { text: '已签收',   status: 'Success' },
        EXCEPTION:     { text: '异常',     status: 'Error' },
        CANCELLED:     { text: '已取消',   status: 'Default' },
      },
    },
    {
      title: '收件人',
      dataIndex: 'recipientName',
      width: 120,
      ellipsis: true,
      search: false,
      render: (_, r) => r.recipientName || '-',
    },
    {
      title: '承运商',
      dataIndex: 'carrier',
      width: 110,
      search: false,
      render: (_, r) => r.carrier || '-',
    },
    {
      title: '跟踪号',
      dataIndex: 'trackingNo',
      width: 160,
      ellipsis: true,
      search: false,
      render: (_, r) => r.trackingNo || '-',
    },
    {
      title: '费用',
      dataIndex: 'fee',
      width: 90,
      search: false,
      render: (_, r) => r.fee ?? '-',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 160,
      search: false,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 260,
      render: (_, row) => {
        const actions = ACTIONS[row.status] ?? [];
        const nodes = actions.map((a) => (
          <Popconfirm
            key={a.key}
            title={`确认执行「${a.label}」？`}
            onConfirm={() => runAction(row.id, a.endpoint)}
            okText="确认"
            cancelText="取消"
          >
            <a className={a.danger ? 'text-red-500 hover:text-red-400 font-medium' : 'text-primary hover:text-primary-light font-medium'}>
              {a.label}
            </a>
          </Popconfirm>
        ));
        nodes.push(
          <a key="view" className="text-secondary hover:text-blue-400" onClick={() => openDetail(row.id)}>详情</a>,
          <Dropdown
            key="more"
            menu={{ items: [{ key: 'print', label: '打印拣货单' }] }}
          >
            <a onClick={(e) => e.preventDefault()} className="text-text-muted hover:text-text-primary">
              <MoreOutlined />
            </a>
          </Dropdown>,
        );
        return nodes;
      },
    },
  ];

  return (
    <PageContainer
      header={{
        title: '出库订单管理',
        subTitle: '管理出库单据全流程：分配 → 拣货 → 打包 → 发货',
      }}
    >
      <ProTable<OutboundOrderRow>
        columns={columns}
        actionRef={actionRef}
        cardBordered
        request={fetchOutbound}
        rowKey="id"
        search={{
          labelWidth: 'auto',
          collapsed: false,
        }}
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
        }}
        dateFormatter="string"
        headerTitle="出库单列表"
        toolBarRender={() => [
          <Authorized key="create" action="outbound.create">
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              新建出库单
            </Button>
          </Authorized>,
          <Authorized key="import" action="outbound.bulkImport">
            <Button onClick={() => setImportOpen(true)}>
              批量导入
            </Button>
          </Authorized>,
        ]}
      />

      <Drawer
        title={detailData ? `出库单 ${detailData.orderNo}` : '出库单详情'}
        width={760}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      >
        {detailLoading ? (
          <Spin />
        ) : !detailData ? (
          <Empty description="暂无数据" />
        ) : (
          <div className="flex flex-col gap-4">
            <Descriptions size="small" column={2} bordered title="基本信息">
              <Descriptions.Item label="出库单号">{detailData.orderNo}</Descriptions.Item>
              <Descriptions.Item label="客户">{detailData.customerName}</Descriptions.Item>
              <Descriptions.Item label="状态">{detailData.status}</Descriptions.Item>
              <Descriptions.Item label="海外仓">{fmtDetail('warehouseCode', detailData.warehouseCode)}</Descriptions.Item>
              <Descriptions.Item label="仓库地址">{fmtDetail('warehouseAddress', detailData.warehouseAddress)}</Descriptions.Item>
              <Descriptions.Item label="产品总数">{detailData.totalProductCount}</Descriptions.Item>
            </Descriptions>

            {DETAIL_GROUPS.map((g) => (
              <Descriptions key={g.title} size="small" column={2} bordered title={g.title}>
                {g.fields.map((f) => (
                  <Descriptions.Item key={f.key} label={f.label}>
                    {fmtDetail(f.key, detailData[f.key])}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            ))}

            <div>
              <div className="font-medium mb-2">商品明细</div>
              <Table
                rowKey="sku"
                dataSource={detailData.items ?? []}
                pagination={false}
                size="small"
                columns={[
                  { title: 'SKU', dataIndex: 'sku' },
                  { title: '品名', dataIndex: 'productName' },
                  { title: '需求', dataIndex: 'requiredQty', width: 70 },
                  { title: '已拣', dataIndex: 'pickedQty', width: 70 },
                  { title: '已打包', dataIndex: 'packedQty', width: 70 },
                ]}
              />
            </div>

            {(detailData.exceptions?.length ?? 0) > 0 && (
              <div>
                <div className="font-medium mb-2">异常记录</div>
                <Table
                  rowKey="id"
                  dataSource={detailData.exceptions}
                  pagination={false}
                  size="small"
                  columns={[
                    { title: '异常号', dataIndex: 'exceptionNo' },
                    { title: '类型', dataIndex: 'type' },
                    { title: '原因', dataIndex: 'reason' },
                    { title: '状态', dataIndex: 'status' },
                  ]}
                />
              </div>
            )}
          </div>
        )}
      </Drawer>

      <CreateOrderModal open={createOpen} onClose={() => setCreateOpen(false)} onSuccess={() => actionRef.current?.reload()} />
      <BulkImportModal open={importOpen} onClose={() => setImportOpen(false)} onSuccess={() => actionRef.current?.reload()} />
    </PageContainer>
  );
};

export default OutboundList;
