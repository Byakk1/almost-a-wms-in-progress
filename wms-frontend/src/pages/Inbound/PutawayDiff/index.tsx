import React, { useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Space, Tag, Modal, Input, message } from 'antd';
import { ExceptionOutlined, EditOutlined, CheckCircleOutlined } from '@ant-design/icons';

interface DiffItem {
  id: string;
  receiptNo: string;
  sku: string;
  expectedQty: number;
  actualPutawayQty: number;
  diffQty: number;
  reason: string;
  status: 'PENDING' | 'RESOLVED';
  createdAt: string;
}

const PutawayDiff: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [resolveModal, setResolveModal] = useState<DiffItem | null>(null);
  const [remark, setRemark] = useState('');
  
  const [data, setData] = useState<DiffItem[]>([
    { id: '1', receiptNo: 'RCV-260305-001', sku: 'SKU-A001', expectedQty: 500, actualPutawayQty: 495, diffQty: -5, reason: '上架过程发现破损/短少', status: 'PENDING', createdAt: '2026-03-05 09:30' },
    { id: '2', receiptNo: 'RCV-260304-002', sku: 'SKU-B099', expectedQty: 100, actualPutawayQty: 102, diffQty: 2, reason: '客户多寄件', status: 'PENDING', createdAt: '2026-03-04 15:00' },
    { id: '3', receiptNo: 'RCV-260302-005', sku: 'SKU-C112', expectedQty: 200, actualPutawayQty: 198, diffQty: -2, reason: '找不到货物', status: 'RESOLVED', createdAt: '2026-03-02 11:20' },
  ]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const fetchDiffs = async (_p: any) => {
    await new Promise((r) => setTimeout(r, 400));
    return { data, success: true, total: data.length };
  };

  const handleResolve = () => {
    setData((prev) => prev.map((item) =>
      item.id === resolveModal!.id ? { ...item, status: 'RESOLVED' } : item
    ));
    message.success('差异已解决并同步库存');
    setResolveModal(null);
    setRemark('');
  };

  const columns: ProColumns<DiffItem>[] = [
    { title: '收货单号', dataIndex: 'receiptNo', copyable: true, width: 160 },
    { title: 'SKU', dataIndex: 'sku', copyable: true, width: 140 },
    { title: '应上架数量', dataIndex: 'expectedQty', width: 100, search: false },
    { title: '实际上架数量', dataIndex: 'actualPutawayQty', width: 110, search: false },
    {
      title: '差异', dataIndex: 'diffQty', width: 90, search: false,
      render: (v) => {
        const n = v as number;
        return <span className={n > 0 ? 'text-blue-500 font-bold' : 'text-red-500 font-bold'}>{n > 0 ? `+${n}` : n}</span>;
      },
    },
    { title: '系统判定原因', dataIndex: 'reason', ellipsis: true, search: false },
    {
      title: '状态', dataIndex: 'status', width: 100,
      valueEnum: {
        PENDING: { text: '待处理', status: 'Error' },
        RESOLVED: { text: '已平账', status: 'Success' },
      },
    },
    { title: '发生时间', dataIndex: 'createdAt', width: 150, search: false },
    {
      title: '操作', valueType: 'option', width: 110,
      render: (_, record) => record.status === 'PENDING' && [
        <a key="solve" className="text-primary" onClick={() => setResolveModal(record)}>
          <EditOutlined className="mr-1" />平账处理
        </a>,
      ],
    },
  ];

  return (
    <PageContainer header={{ title: '上架差异处理', subTitle: '管理按收货单应上架与实际上架操作之间的数量差异，进行盘盈盘亏平账' }}>
      <ProTable<DiffItem>
        columns={columns} actionRef={actionRef} cardBordered request={fetchDiffs}
        rowKey="id" search={{ labelWidth: 'auto', collapsed: false }} pagination={{ pageSize: 15 }}
        headerTitle={<Space><ExceptionOutlined style={{ color: '#ef4444' }} /><span>异常明细</span></Space>}
        rowClassName={(r) => r.status === 'PENDING' ? 'bg-red-50' : ''}
      />

      <Modal title="差异平账处理" open={!!resolveModal} onOk={handleResolve} onCancel={() => { setResolveModal(null); setRemark(''); }} okText="确认盘盈并平账" okButtonProps={{ icon: <CheckCircleOutlined /> }}>
        {resolveModal && (
          <div className="mt-4">
            <p className="mb-3">正在处理单号 <strong>{resolveModal.receiptNo}</strong> 下 SKU <strong>{resolveModal.sku}</strong> 的数量差异。</p>
            <p className="mb-4">
              差异数量：
              <Tag color={resolveModal.diffQty > 0 ? 'blue' : 'red'} className="text-base py-1">
                {resolveModal.diffQty > 0 ? `盘盈 +${resolveModal.diffQty}` : `盘亏 ${resolveModal.diffQty}`}
              </Tag>
            </p>
            <Input.TextArea
              rows={3} value={remark} onChange={(e) => setRemark(e.target.value)}
              placeholder="请输入经手人核实结果及平账备注..."
            />
          </div>
        )}
      </Modal>
    </PageContainer>
  );
};

export default PutawayDiff;
