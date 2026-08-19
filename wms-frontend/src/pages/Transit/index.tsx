import React, { useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  Button, Space, Steps, Card, Tooltip, Drawer, Descriptions, Table, Tag,
  Modal, Form, InputNumber, Input, message, theme, Spin,
} from 'antd';
import {
  PlusOutlined, ExportOutlined, EyeOutlined, SwapOutlined,
  InboxOutlined, SendOutlined,
} from '@ant-design/icons';
import request from '../../utils/request';
import { useCan } from '../../router/permissions';

type TransitStatus = 'PENDING' | 'RECEIVED' | 'SHIPPED';

interface TransitOrderRow {
  id: string;
  orderNo: string;
  customerName: string;
  totalItems: number;
  status: TransitStatus;
  trackingNo: string | null;
  createdAt: string;
}

// GET /transit-orders/:id — includes customer and items (each with product).
interface TransitItem {
  id: string;
  productId: string;
  expectedQty: number;
  actualQty: number;
  product?: { sku: string; name: string } | null;
}
interface TransitDetail {
  id: string;
  orderNo: string;
  status: TransitStatus;
  trackingNo: string | null;
  createdAt: string;
  customer?: { name: string; code: string } | null;
  items: TransitItem[];
}

const STATUS_STEPS: TransitStatus[] = ['PENDING', 'RECEIVED', 'SHIPPED'];
const STATUS_LABELS: Record<TransitStatus, string> = {
  PENDING: '待收货',
  RECEIVED: '已收货',
  SHIPPED: '已发出',
};

const TransitList: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const { token } = theme.useToken();
  const canReceive = useCan('transit.receive'); // PUT /:id/receive — OPS only
  const canShip = useCan('transit.ship');       // PUT /:id/ship — OPS only

  const [detail, setDetail] = useState<TransitDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [receiveFor, setReceiveFor] = useState<TransitDetail | null>(null);
  const [shipFor, setShipFor] = useState<TransitOrderRow | TransitDetail | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [receiveForm] = Form.useForm();
  const [shipForm] = Form.useForm();

  const fetchTransit = async (params: any) => {
    const { current, pageSize, ...rest } = params || {};
    // Transit controller wraps {data, pagination} inside ok(), so the envelope is res.data.{data, pagination}.
    // (Inbound/Outbound use ok(rows, pagination) which flattens; transit is the odd one out.)
    const res: any = await request.get('/transit-orders', {
      params: { page: current, pageSize, ...rest },
    });
    return {
      data: res?.data?.data ?? [],
      success: true,
      total: res?.data?.pagination?.total ?? 0,
    };
  };

  const loadDetail = async (id: string): Promise<TransitDetail | null> => {
    setDetailLoading(true);
    try {
      const res: any = await request.get(`/transit-orders/${id}`);
      return res?.data ?? null;
    } catch {
      return null; // request.ts interceptor surfaces errors
    } finally {
      setDetailLoading(false);
    }
  };

  const openDetail = async (row: TransitOrderRow) => {
    setDetail({ id: row.id, orderNo: row.orderNo, status: row.status, trackingNo: row.trackingNo, createdAt: row.createdAt, items: [] });
    const d = await loadDetail(row.id);
    if (d) setDetail(d);
  };

  const openReceive = async (row: TransitOrderRow) => {
    const d = await loadDetail(row.id);
    if (!d) return;
    setReceiveFor(d);
    // Default each line to its outstanding quantity so the common case is one click.
    receiveForm.setFieldsValue({
      qty: Object.fromEntries(d.items.map((i) => [i.productId, Math.max(0, i.expectedQty - i.actualQty)])),
    });
  };

  const submitReceive = () => {
    receiveForm.validateFields().then(async (vals) => {
      if (!receiveFor) return;
      const items = Object.entries(vals.qty ?? {})
        .map(([productId, qty]) => ({ productId, qty: Number(qty) }))
        .filter((i) => i.qty > 0);
      if (!items.length) {
        message.warning('请至少填写一项收货数量');
        return;
      }
      setSubmitting(true);
      try {
        await request.put(`/transit-orders/${receiveFor.id}/receive`, { items });
        message.success(`${receiveFor.orderNo} 已收货`);
        setReceiveFor(null);
        receiveForm.resetFields();
        actionRef.current?.reload();
      } catch {
        // interceptor surfaces the backend status guard
      } finally {
        setSubmitting(false);
      }
    });
  };

  const submitShip = () => {
    shipForm.validateFields().then(async (vals) => {
      if (!shipFor) return;
      setSubmitting(true);
      try {
        await request.put(`/transit-orders/${shipFor.id}/ship`, { trackingNo: vals.trackingNo });
        message.success(`${shipFor.orderNo} 已发出，物流单号 ${vals.trackingNo}`);
        setShipFor(null);
        shipForm.resetFields();
        actionRef.current?.reload();
      } catch {
        // interceptor surfaces the backend status guard
      } finally {
        setSubmitting(false);
      }
    });
  };

  const columns: ProColumns<TransitOrderRow>[] = [
    {
      title: '中转单号',
      dataIndex: 'orderNo',
      copyable: true,
      width: 180,
      render: (v) => <span className="font-mono text-sm">{v as string}</span>,
    },
    { title: '客户名称', dataIndex: 'customerName', ellipsis: true },
    {
      title: 'SKU件数',
      dataIndex: 'totalItems',
      width: 100,
      search: false,
    },
    {
      title: '物流单号',
      dataIndex: 'trackingNo',
      width: 160,
      render: (v) => (v ? <span className="font-mono text-sm">{v as string}</span> : <span className="text-text-muted">—</span>),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      valueEnum: {
        PENDING:  { text: '待收货', status: 'Default' },
        RECEIVED: { text: '已收货', status: 'Processing' },
        SHIPPED:  { text: '已发出', status: 'Success' },
      },
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
      width: 200,
      render: (_, record) => [
        <a key="view" onClick={() => openDetail(record)}>
          <EyeOutlined className="mr-1" />详情
        </a>,
        // The backend only allows PENDING→RECEIVED→SHIPPED, so each action is
        // offered on exactly the status that accepts it.
        record.status === 'PENDING' && canReceive && (
          <a key="receive" onClick={() => openReceive(record)}>
            <InboxOutlined className="mr-1" />收货
          </a>
        ),
        record.status === 'RECEIVED' && canShip && (
          <a key="ship" onClick={() => { setShipFor(record); shipForm.resetFields(); }}>
            <SendOutlined className="mr-1" />发货
          </a>
        ),
      ],
    },
  ];

  const itemColumns = [
    { title: 'SKU', dataIndex: ['product', 'sku'], render: (_: any, r: TransitItem) => r.product?.sku ?? '—' },
    { title: '商品名称', dataIndex: ['product', 'name'], ellipsis: true, render: (_: any, r: TransitItem) => r.product?.name ?? '—' },
    { title: '预期数量', dataIndex: 'expectedQty', width: 100 },
    {
      title: '实收数量', dataIndex: 'actualQty', width: 100,
      render: (v: number, r: TransitItem) => (
        <span style={{ color: v >= r.expectedQty ? token.colorSuccess : token.colorWarning }}>{v}</span>
      ),
    },
  ];

  return (
    <PageContainer
      header={{
        title: '中转管理',
        subTitle: '管理中转单据：到货 → 收货 → 出库发运',
      }}
    >
      <Card size="small" className="mb-4 shadow-sm">
        <Steps
          size="small"
          current={STATUS_STEPS.length - 1}
          items={STATUS_STEPS.map((s) => ({ title: STATUS_LABELS[s] }))}
        />
      </Card>

      <ProTable<TransitOrderRow>
        columns={columns}
        actionRef={actionRef}
        cardBordered
        request={fetchTransit}
        rowKey="id"
        scroll={{ x: 1160 }}
        search={{ labelWidth: 'auto', collapsed: false }}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        dateFormatter="string"
        headerTitle={<Space><SwapOutlined style={{ color: token.colorPrimary }} /><span>中转单列表</span></Space>}
        toolBarRender={() => [
          <Button key="export" icon={<ExportOutlined />} disabled>导出</Button>,
          <Tooltip key="add" title="待后端 POST /transit-orders 端点上线">
            <Button icon={<PlusOutlined />} disabled>新建中转单</Button>
          </Tooltip>,
        ]}
      />

      <Drawer
        title={detail ? `中转单 ${detail.orderNo}` : '中转单详情'}
        width={720}
        open={!!detail}
        onClose={() => setDetail(null)}
        destroyOnHidden
      >
        <Spin spinning={detailLoading}>
          {detail && (
            <>
              <Descriptions column={2} size="small" bordered className="mb-4">
                <Descriptions.Item label="中转单号" span={2}>{detail.orderNo}</Descriptions.Item>
                <Descriptions.Item label="客户">
                  {detail.customer?.name ?? '—'}
                </Descriptions.Item>
                <Descriptions.Item label="状态">
                  <Tag color={detail.status === 'SHIPPED' ? 'success' : detail.status === 'RECEIVED' ? 'processing' : 'default'}>
                    {STATUS_LABELS[detail.status]}
                  </Tag>
                </Descriptions.Item>
                <Descriptions.Item label="物流单号" span={2}>
                  {detail.trackingNo || '—'}
                </Descriptions.Item>
              </Descriptions>
              <Table
                size="small"
                rowKey="id"
                dataSource={detail.items}
                columns={itemColumns as any}
                pagination={false}
                locale={{ emptyText: '无明细' }}
              />
            </>
          )}
        </Spin>
      </Drawer>

      <Modal
        title={receiveFor ? `收货 · ${receiveFor.orderNo}` : '收货'}
        open={!!receiveFor}
        onCancel={() => setReceiveFor(null)}
        onOk={submitReceive}
        confirmLoading={submitting}
        okText="确认收货"
        cancelText="取消"
        destroyOnHidden
        width={620}
      >
        {receiveFor && (
          <Form form={receiveForm} layout="vertical">
            <div className="mb-3 text-sm text-slate-500">
              录入本次实收数量，提交后单据将变为「已收货」。
            </div>
            {receiveFor.items.map((it) => (
              <Form.Item
                key={it.productId}
                label={`${it.product?.sku ?? it.productId}${it.product?.name ? ` · ${it.product.name}` : ''}（预期 ${it.expectedQty} / 已收 ${it.actualQty}）`}
                name={['qty', it.productId]}
                rules={[{ type: 'integer', min: 0, message: '收货数量须为非负整数' }]}
              >
                <InputNumber style={{ width: '100%' }} min={0} precision={0} />
              </Form.Item>
            ))}
          </Form>
        )}
      </Modal>

      <Modal
        title={shipFor ? `发货 · ${shipFor.orderNo}` : '发货'}
        open={!!shipFor}
        onCancel={() => setShipFor(null)}
        onOk={submitShip}
        confirmLoading={submitting}
        okText="确认发货"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={shipForm} layout="vertical">
          <Form.Item
            label="物流单号"
            name="trackingNo"
            rules={[{ required: true, message: '请输入物流单号' }]}
          >
            <Input placeholder="例如 SF1234567890" />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default TransitList;
