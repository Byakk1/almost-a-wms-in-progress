import React, { useRef } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Dropdown, Popconfirm, message } from 'antd';
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

const OutboundList: React.FC = () => {
  const actionRef = useRef<ActionType>(null);

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
          <a key="view" className="text-secondary hover:text-blue-400">详情</a>,
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
    </PageContainer>
  );
};

export default OutboundList;
