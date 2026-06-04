import React, { useRef } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Button, Dropdown, Popconfirm, message } from 'antd';
import { PlusOutlined, ScanOutlined, MoreOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import request from '../../utils/request';

type ReceivingStatus =
  | 'PENDING'
  | 'ARRIVED'
  | 'CHECKING'
  | 'RECEIVING'
  | 'COMPLETED'
  | 'PUTAWAY_PENDING'
  | 'PUTAWAY_PARTIAL'
  | 'PUTAWAY_COMPLETED'
  | 'EXCEPTION'
  | 'EXCEPTION_CLOSED';

interface ReceivingItem {
  id: string;
  receivingNo: string;
  customerName: string;
  trackingNo: string;
  expectedQuantity: number;
  actualQuantity: number;
  status: ReceivingStatus;
  createdAt: string;
}

// Mirrors backend RECEIVING_TRANSITIONS — the subset of actions invokable from the list page.
// Putaway transitions are owned by the putaway page and intentionally excluded here.
const ACTIONS: Partial<Record<ReceivingStatus, Array<{ key: string; label: string; endpoint: string; danger?: boolean }>>> = {
  PENDING: [
    { key: 'arrive', label: '到货', endpoint: 'arrive' },
    { key: 'check', label: '直接验货', endpoint: 'check' },
    { key: 'exception', label: '标记异常', endpoint: 'exception', danger: true },
  ],
  ARRIVED: [
    { key: 'check', label: '开始验货', endpoint: 'check' },
    { key: 'exception', label: '标记异常', endpoint: 'exception', danger: true },
  ],
  CHECKING: [
    // Scanning (POST /receive with {sku,qty}) belongs to the scan page at /inbound/receiving/add.
    // From the list we only expose the exception escape.
    { key: 'exception', label: '标记异常', endpoint: 'exception', danger: true },
  ],
  RECEIVING: [
    { key: 'complete', label: '完成入库', endpoint: 'complete' },
    { key: 'exception', label: '标记异常', endpoint: 'exception', danger: true },
  ],
  EXCEPTION: [
    { key: 'check', label: '重新验货', endpoint: 'check' },
    { key: 'close-exception', label: '关闭异常', endpoint: 'close-exception' },
  ],
};

const ReceivingList: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const navigate = useNavigate();

  const fetchReceivings = async (params: any) => {
    const { current, pageSize, ...rest } = params || {};
    const res: any = await request.get('/receiving-orders', {
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
      const reason = window.prompt('请输入异常原因');
      if (!reason) return;
      body = { reason };
    }
    try {
      await request.post(`/receiving-orders/${id}/${endpoint}`, body);
      message.success('操作成功');
      actionRef.current?.reload();
    } catch {
      // request.ts interceptor already surfaces the error message
    }
  };

  const columns: ProColumns<ReceivingItem>[] = [
    {
      title: '收货单号',
      dataIndex: 'receivingNo',
      copyable: true,
      width: 150,
    },
    {
      title: '客户名称',
      dataIndex: 'customerName',
      ellipsis: true,
    },
    {
      title: '物流单号',
      dataIndex: 'trackingNo',
      width: 150,
    },
    {
      title: '预期数量',
      dataIndex: 'expectedQuantity',
      width: 100,
      search: false,
    },
    {
      title: '实收数量',
      dataIndex: 'actualQuantity',
      width: 100,
      search: false,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      valueEnum: {
        PENDING:           { text: '待到货',     status: 'Default' },
        ARRIVED:           { text: '已到货',     status: 'Default' },
        CHECKING:          { text: '验货中',     status: 'Processing' },
        RECEIVING:         { text: '收货中',     status: 'Processing' },
        COMPLETED:         { text: '收货完成',   status: 'Success' },
        PUTAWAY_PENDING:   { text: '待上架',     status: 'Warning' },
        PUTAWAY_PARTIAL:   { text: '部分上架',   status: 'Warning' },
        PUTAWAY_COMPLETED: { text: '上架完成',   status: 'Success' },
        EXCEPTION:         { text: '异常',       status: 'Error' },
        EXCEPTION_CLOSED:  { text: '异常已关闭', status: 'Default' },
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
      width: 220,
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
            menu={{
              items: [{ key: 'print', label: '打印条码' }],
            }}
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
        title: '收货管理',
        subTitle: '管理入库收货单据，执行扫描入库操作',
      }}
    >
      <ProTable<ReceivingItem>
        columns={columns}
        actionRef={actionRef}
        cardBordered
        request={fetchReceivings}
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
        headerTitle="收货单列表"
        toolBarRender={() => [
          <Button key="scan" icon={<ScanOutlined />} onClick={() => navigate('/inbound/receiving/add')} style={{ borderColor: '#D23148', color: '#D23148' }}>
            快速扫码收货
          </Button>,
          <Button key="button" icon={<PlusOutlined />} type="primary" onClick={() => message.info('新建收货单')}>
            新建收货单
          </Button>,
        ]}
      />
    </PageContainer>
  );
};

export default ReceivingList;
