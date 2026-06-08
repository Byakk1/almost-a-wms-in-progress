import React, { useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Drawer, Table, Popconfirm, Tag, message, Empty, Spin } from 'antd';
import request from '../../../utils/request';

type WaveStatus = 'PENDING' | 'RELEASED' | 'COMPLETED' | 'CANCELLED';

interface WaveRow {
  id: string;
  waveNo: string;
  strategy: 'PICK_AND_PASS' | 'BATCH_SOW';
  status: WaveStatus;
  orderCount: number;
  createdAt: string;
}

// Pick-list shapes returned by GET /waves/:id/pick-list (strategy-dependent).
interface PickLine { sku: string; productName: string; locationCode: string; qty: number }
interface SowEntry { orderNo: string; qty: number }
interface PickListData {
  waveNo: string;
  strategy: 'PICK_AND_PASS' | 'BATCH_SOW';
  orders?: Array<{ orderNo: string; lines: PickLine[] }>;            // 摘果
  lines?: Array<{ sku: string; productName: string; locationCode: string; totalQty: number; sow: SowEntry[] }>; // 播种
}

// Mirrors backend WAVE_TRANSITIONS — list-page actions only.
const ACTIONS: Partial<Record<WaveStatus, Array<{ key: string; label: string; endpoint: string; danger?: boolean }>>> = {
  PENDING: [
    { key: 'release', label: '发放拣货', endpoint: 'release' },
    { key: 'cancel', label: '取消', endpoint: 'cancel', danger: true },
  ],
  RELEASED: [
    { key: 'complete', label: '完成波次', endpoint: 'complete' },
  ],
};

const WaveList: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [pickLoading, setPickLoading] = useState(false);
  const [pickData, setPickData] = useState<PickListData | null>(null);

  const fetchWaves = async (params: any) => {
    const { current, pageSize, ...rest } = params || {};
    const res: any = await request.get('/waves', { params: { page: current, pageSize, ...rest } });
    return {
      data: res?.data ?? [],
      success: true,
      total: res?.pagination?.total ?? (res?.data?.length ?? 0),
    };
  };

  const runAction = async (id: string, endpoint: string) => {
    try {
      await request.post(`/waves/${id}/${endpoint}`);
      message.success('操作成功');
      actionRef.current?.reload();
    } catch {
      // request.ts interceptor already surfaces the error message
    }
  };

  const openPickList = async (id: string) => {
    setPickOpen(true);
    setPickLoading(true);
    setPickData(null);
    try {
      const res: any = await request.get(`/waves/${id}/pick-list`);
      setPickData(res?.data ?? null);
    } catch {
      setPickData(null);
    } finally {
      setPickLoading(false);
    }
  };

  const columns: ProColumns<WaveRow>[] = [
    { title: '波次号', dataIndex: 'waveNo', copyable: true, width: 180 },
    {
      title: '拣货策略',
      dataIndex: 'strategy',
      width: 120,
      valueEnum: {
        PICK_AND_PASS: { text: '摘果' },
        BATCH_SOW: { text: '播种' },
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      valueEnum: {
        PENDING:   { text: '待发放', status: 'Default' },
        RELEASED:  { text: '已发放', status: 'Processing' },
        COMPLETED: { text: '已完成', status: 'Success' },
        CANCELLED: { text: '已取消', status: 'Default' },
      },
    },
    { title: '订单数', dataIndex: 'orderCount', width: 90, search: false },
    { title: '创建时间', dataIndex: 'createdAt', valueType: 'dateTime', width: 160, search: false },
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
          <a key="pick" className="text-secondary hover:text-blue-400" onClick={() => openPickList(row.id)}>
            查看拣货单
          </a>,
        );
        return nodes;
      },
    },
  ];

  const renderPickList = () => {
    if (pickLoading) return <Spin />;
    if (!pickData) return <Empty description="暂无拣货数据" />;

    // 播种: aggregated by (sku, location), expand to see the per-order sow breakdown.
    if (pickData.strategy === 'BATCH_SOW') {
      return (
        <Table<{ sku: string; productName: string; locationCode: string; totalQty: number; sow: SowEntry[] }>
          rowKey={(r) => `${r.sku}@@${r.locationCode}`}
          dataSource={pickData.lines ?? []}
          pagination={false}
          size="small"
          columns={[
            { title: 'SKU', dataIndex: 'sku' },
            { title: '品名', dataIndex: 'productName' },
            { title: '库位', dataIndex: 'locationCode' },
            { title: '合计拣货', dataIndex: 'totalQty' },
          ]}
          expandable={{
            expandedRowRender: (record) => (
              <Table<SowEntry>
                rowKey="orderNo"
                dataSource={record.sow}
                pagination={false}
                size="small"
                columns={[
                  { title: '播种至订单', dataIndex: 'orderNo' },
                  { title: '数量', dataIndex: 'qty' },
                ]}
              />
            ),
          }}
        />
      );
    }

    // 摘果: one small table per order.
    return (
      <div className="flex flex-col gap-4">
        {(pickData.orders ?? []).map((g) => (
          <div key={g.orderNo}>
            <div className="font-medium mb-2">{g.orderNo}</div>
            <Table<PickLine>
              rowKey={(r) => `${r.sku}@@${r.locationCode}`}
              dataSource={g.lines}
              pagination={false}
              size="small"
              columns={[
                { title: 'SKU', dataIndex: 'sku' },
                { title: '品名', dataIndex: 'productName' },
                { title: '库位', dataIndex: 'locationCode' },
                { title: '数量', dataIndex: 'qty' },
              ]}
            />
          </div>
        ))}
      </div>
    );
  };

  return (
    <PageContainer header={{ title: '波次管理', subTitle: '将已分配出库单编入波次，发放批量拣货（摘果 / 播种）' }}>
      <ProTable<WaveRow>
        columns={columns}
        actionRef={actionRef}
        cardBordered
        request={fetchWaves}
        rowKey="id"
        search={{ labelWidth: 'auto', collapsed: false }}
        pagination={{ pageSize: 10, showSizeChanger: true }}
        dateFormatter="string"
        headerTitle="波次列表"
      />

      <Drawer
        title={pickData ? `拣货单 ${pickData.waveNo} · ${pickData.strategy === 'BATCH_SOW' ? '播种' : '摘果'}` : '拣货单'}
        width={680}
        open={pickOpen}
        onClose={() => setPickOpen(false)}
      >
        {pickData && (
          <Tag color="blue" className="mb-3">
            {pickData.strategy === 'BATCH_SOW' ? '播种：按 SKU+库位 合并拣货，再分播至各订单' : '摘果：按订单逐单拣货'}
          </Tag>
        )}
        {renderPickList()}
      </Drawer>
    </PageContainer>
  );
};

export default WaveList;
