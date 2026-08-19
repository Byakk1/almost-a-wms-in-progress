import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Button, Tag, Space, Alert, theme } from 'antd';
import { ExportOutlined, WarningOutlined } from '@ant-design/icons';
import request from '../../../utils/request';

// Mirrors the projection returned by OutboundOrdersService.exceptions().
// NOTE: `type` is a free-form String column (the schema comment suggests
// SHORT_PICK / DAMAGE / OTHER but real rows contain Chinese free text), so it
// is rendered verbatim rather than through a valueEnum that would blank out
// anything unexpected.
interface ExceptionItem {
  id: string;
  exceptionNo: string;
  orderNo: string | null;
  type: string | null;
  reason: string | null;
  status: string;
  createdAt: string;
}

const OutboundException: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const { token } = theme.useToken();
  const [openCount, setOpenCount] = useState(0);

  // GET /outbound-exceptions returns the full set — no pagination, no filters.
  // So the list is fetched whole and narrowed client-side; the search bar is
  // honest about what it does because the result set is small by nature.
  const allRef = useRef<ExceptionItem[]>([]);

  const load = useCallback(async () => {
    const res: any = await request.get('/outbound-exceptions');
    const rows: ExceptionItem[] = res?.data ?? [];
    allRef.current = rows;
    setOpenCount(rows.filter((r) => r.status === 'OPEN').length);
    return rows;
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const fetchExceptions = async (params: any) => {
    const rows = await load();
    const { current = 1, pageSize = 10, exceptionNo, orderNo, status } = params || {};
    const match = (hay: string | null | undefined, needle?: string) =>
      !needle || (hay ?? '').toLowerCase().includes(String(needle).toLowerCase());

    const filtered = rows.filter(
      (r) => match(r.exceptionNo, exceptionNo) && match(r.orderNo, orderNo) && (!status || r.status === status),
    );
    const start = (current - 1) * pageSize;
    return { data: filtered.slice(start, start + pageSize), success: true, total: filtered.length };
  };

  const columns: ProColumns<ExceptionItem>[] = [
    {
      title: '异常单号',
      dataIndex: 'exceptionNo',
      copyable: true,
      width: 170,
      render: (v) => <span className="font-mono text-sm">{v as string}</span>,
    },
    {
      title: '关联订单',
      dataIndex: 'orderNo',
      copyable: true,
      width: 190,
      render: (_, r) => <span className="font-mono text-sm">{r.orderNo || '—'}</span>,
    },
    {
      title: '异常类型',
      dataIndex: 'type',
      width: 140,
      render: (_, r) =>
        r.type ? (
          <Tag color="warning" icon={<WarningOutlined />}>{r.type}</Tag>
        ) : (
          '—'
        ),
    },
    {
      title: '异常原因',
      dataIndex: 'reason',
      ellipsis: true,
      search: false,
      render: (_, r) => r.reason || '—',
    },
    {
      title: '处理状态',
      dataIndex: 'status',
      width: 110,
      valueEnum: {
        OPEN: { text: '待处理', status: 'Error' },
        RESOLVED: { text: '已解决', status: 'Success' },
      },
    },
    {
      title: '报告时间',
      dataIndex: 'createdAt',
      width: 180,
      search: false,
      valueType: 'dateTime',
    },
  ];

  return (
    <PageContainer
      header={{
        title: '出货异常处理',
        subTitle: '出库过程中登记的问题件（由出库单 exception 操作产生）',
      }}
    >
      {openCount > 0 && (
        <Alert
          className="mb-4"
          type="error"
          icon={<WarningOutlined />}
          showIcon
          message={`当前有 ${openCount} 件待处理的异常问题件，请及时跟进！`}
        />
      )}

      <ProTable<ExceptionItem>
        columns={columns}
        actionRef={actionRef}
        cardBordered
        request={fetchExceptions}
        rowKey="id"
        scroll={{ x: 1000 }}
        search={{ labelWidth: 'auto', collapsed: false }}
        pagination={{ pageSize: 10 }}
        dateFormatter="string"
        headerTitle={
          <Space>
            <WarningOutlined style={{ color: token.colorError }} />
            <span>问题件列表</span>
          </Space>
        }
        toolBarRender={() => [
          <Button key="export" icon={<ExportOutlined />}>导出报告</Button>,
        ]}
        rowClassName={(r) => (r.status === 'OPEN' ? 'bg-red-50' : '')}
      />
    </PageContainer>
  );
};

export default OutboundException;
