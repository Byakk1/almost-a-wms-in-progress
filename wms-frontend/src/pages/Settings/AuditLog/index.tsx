import React from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { Tag } from 'antd';
import request from '../../../utils/request';

interface OperationLog {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  beforeData?: unknown;
  afterData?: unknown;
  description?: string | null;
  operatorId?: string | null;
  operatorName?: string | null;
  createdAt: string;
}

const AuditLog: React.FC = () => {
  const fetchList = async (params: any) => {
    const { current, pageSize } = params || {};
    const res: any = await request.get('/audit/operations', {
      params: { page: current, pageSize },
    });
    return {
      data: res?.data ?? [],
      success: true,
      total: res?.pagination?.total ?? (res?.data?.length ?? 0),
    };
  };

  const columns: ProColumns<OperationLog>[] = [
    { title: '时间', dataIndex: 'createdAt', valueType: 'dateTime', width: 170 },
    { title: '实体类型', dataIndex: 'entityType', width: 170 },
    { title: '动作', dataIndex: 'action', width: 150, render: (_, r) => <Tag color="geekblue">{r.action}</Tag> },
    { title: '描述', dataIndex: 'description', ellipsis: true, render: (_, r) => r.description || '—' },
    {
      title: '操作人',
      dataIndex: 'operatorName',
      width: 130,
      render: (_, r) => r.operatorName || r.operatorId || '系统',
    },
  ];

  return (
    <PageContainer header={{ title: '操作日志', subTitle: '全局操作审计时间线（按时间倒序）；展开行查看变更前后快照' }}>
      <ProTable<OperationLog>
        columns={columns}
        cardBordered
        request={fetchList}
        rowKey="id"
        search={false}
        options={{ reload: true, density: false, setting: false }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        dateFormatter="string"
        headerTitle="操作记录"
        expandable={{
          expandedRowRender: (record) => (
            <div className="text-xs">
              <div className="mb-1 font-medium text-text-muted">变更前</div>
              <pre className="bg-slate-50 p-2 rounded overflow-auto max-h-40">
                {record.beforeData ? JSON.stringify(record.beforeData, null, 2) : '—'}
              </pre>
              <div className="mb-1 mt-2 font-medium text-text-muted">变更后</div>
              <pre className="bg-slate-50 p-2 rounded overflow-auto max-h-40">
                {record.afterData ? JSON.stringify(record.afterData, null, 2) : '—'}
              </pre>
            </div>
          ),
        }}
      />
    </PageContainer>
  );
};

export default AuditLog;
