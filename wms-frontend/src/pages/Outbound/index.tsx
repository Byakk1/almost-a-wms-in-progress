import React, { useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Dropdown, Popconfirm, message, Drawer, Descriptions, Table, Spin, Empty } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
import request from '../../utils/request';

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

const OutboundList: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<OutboundDetail | null>(null);

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
    </PageContainer>
  );
};

export default OutboundList;
