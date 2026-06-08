import React, { useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Popconfirm, message, Drawer, Descriptions, Tag } from 'antd';
import request from '../../utils/request';

type ExceptionStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'CANCELLED';

interface ExceptionCase {
  id: string;
  caseNo: string;
  entityType: string;
  entityId: string;
  entityNo?: string | null;
  type: string;
  severity: string;
  title: string;
  description?: string | null;
  status: ExceptionStatus;
  resolution?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  warehouseId?: string | null;
  customerId?: string | null;
  productId?: string | null;
  locationId?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

// Actions available per status — mirrors the ExceptionCaseService state guards:
// OPEN → start/resolve/cancel; IN_PROGRESS → resolve/cancel; RESOLVED → close/cancel.
// CLOSED / CANCELLED are terminal (no actions).
const ACTIONS: Partial<
  Record<ExceptionStatus, Array<{ key: string; label: string; danger?: boolean; needsResolution?: boolean }>>
> = {
  OPEN: [
    { key: 'start', label: '开始处理' },
    { key: 'resolve', label: '解决', needsResolution: true },
    { key: 'cancel', label: '取消', danger: true },
  ],
  IN_PROGRESS: [
    { key: 'resolve', label: '解决', needsResolution: true },
    { key: 'cancel', label: '取消', danger: true },
  ],
  RESOLVED: [
    { key: 'close', label: '关闭' },
    { key: 'cancel', label: '取消', danger: true },
  ],
};

const SEVERITY_COLOR: Record<string, string> = {
  LOW: 'default',
  MEDIUM: 'blue',
  HIGH: 'orange',
  CRITICAL: 'red',
};

const ExceptionCenter: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [detail, setDetail] = useState<ExceptionCase | null>(null);

  const fetchList = async (params: any) => {
    const { current, pageSize, ...rest } = params || {};
    const res: any = await request.get('/exceptions', {
      params: { page: current, pageSize, ...rest },
    });
    return {
      data: res?.data ?? [],
      success: true,
      total: res?.pagination?.total ?? (res?.data?.length ?? 0),
    };
  };

  const runAction = async (row: ExceptionCase, key: string, needsResolution?: boolean) => {
    let body: Record<string, unknown> | undefined;
    if (needsResolution) {
      const resolution = window.prompt('请输入解决方案 / 处理结果');
      if (!resolution) return;
      body = { resolution };
    }
    try {
      await request.post(`/exceptions/${row.id}/${key}`, body);
      message.success('操作成功');
      actionRef.current?.reload();
    } catch {
      // request.ts interceptor already surfaces the error message
    }
  };

  const columns: ProColumns<ExceptionCase>[] = [
    { title: '工单号', dataIndex: 'caseNo', copyable: true, width: 160, search: false },
    { title: '类型', dataIndex: 'type', width: 140 },
    {
      title: '严重度',
      dataIndex: 'severity',
      width: 90,
      search: false,
      render: (_, r) => <Tag color={SEVERITY_COLOR[r.severity] ?? 'default'}>{r.severity}</Tag>,
    },
    { title: '标题', dataIndex: 'title', ellipsis: true, search: false },
    {
      title: '关联单据',
      dataIndex: 'entityType',
      width: 170,
      render: (_, r) => (
        <span>
          {r.entityType}
          {r.entityNo ? ` / ${r.entityNo}` : ''}
        </span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      valueEnum: {
        OPEN: { text: '待处理', status: 'Error' },
        IN_PROGRESS: { text: '处理中', status: 'Processing' },
        RESOLVED: { text: '已解决', status: 'Success' },
        CLOSED: { text: '已关闭', status: 'Default' },
        CANCELLED: { text: '已取消', status: 'Default' },
      },
    },
    { title: '创建时间', dataIndex: 'createdAt', valueType: 'dateTime', width: 160, search: false },
    {
      title: '操作',
      valueType: 'option',
      width: 200,
      render: (_, row) => {
        const acts = ACTIONS[row.status] ?? [];
        const nodes = acts.map((a) => (
          <Popconfirm
            key={a.key}
            title={`确认执行「${a.label}」？`}
            onConfirm={() => runAction(row, a.key, a.needsResolution)}
            okText="确认"
            cancelText="取消"
          >
            <a
              className={
                a.danger
                  ? 'text-red-500 hover:text-red-400 font-medium'
                  : 'text-primary hover:text-primary-light font-medium'
              }
            >
              {a.label}
            </a>
          </Popconfirm>
        ));
        nodes.push(
          <a key="detail" className="text-secondary hover:text-blue-400" onClick={() => setDetail(row)}>
            详情
          </a>,
        );
        return nodes;
      },
    },
  ];

  return (
    <PageContainer header={{ title: '异常中心', subTitle: '跨单据的统一异常工单：登记、处理、解决与关闭' }}>
      <ProTable<ExceptionCase>
        columns={columns}
        actionRef={actionRef}
        cardBordered
        request={fetchList}
        rowKey="id"
        search={{ labelWidth: 'auto', collapsed: false }}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        dateFormatter="string"
        headerTitle="异常工单列表"
      />
      <Drawer width={540} open={!!detail} onClose={() => setDetail(null)} title={detail?.caseNo}>
        {detail && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="标题">{detail.title}</Descriptions.Item>
            <Descriptions.Item label="类型">{detail.type}</Descriptions.Item>
            <Descriptions.Item label="严重度">
              <Tag color={SEVERITY_COLOR[detail.severity] ?? 'default'}>{detail.severity}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="状态">{detail.status}</Descriptions.Item>
            <Descriptions.Item label="关联单据">
              {detail.entityType}
              {detail.entityNo ? ` / ${detail.entityNo}` : ''}
            </Descriptions.Item>
            <Descriptions.Item label="描述">{detail.description || '—'}</Descriptions.Item>
            <Descriptions.Item label="解决方案">{detail.resolution || '—'}</Descriptions.Item>
            <Descriptions.Item label="处理人">{detail.resolvedBy || '—'}</Descriptions.Item>
            <Descriptions.Item label="解决时间">{detail.resolvedAt || '—'}</Descriptions.Item>
            <Descriptions.Item label="创建人">{detail.createdBy || '—'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{detail.createdAt}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </PageContainer>
  );
};

export default ExceptionCenter;
