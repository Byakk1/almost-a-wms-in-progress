import React, { useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Space, Button, Modal, Form, InputNumber, Input, message } from 'antd';
import { ProfileOutlined, PlusOutlined, CalculatorOutlined } from '@ant-design/icons';

interface InventoryCheck {
  id: string;
  checkNo: string;
  locationRange: string;
  planQty: number;
  actualQty?: number;
  diffQty?: number;
  status: 'PENDING' | 'COUNTING' | 'DONE';
  creator: string;
  createdAt: string;
}

const InventoryCheckPage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [inputModal, setInputModal] = useState<InventoryCheck | null>(null);
  const [form] = Form.useForm();
  
  const [data, setData] = useState<InventoryCheck[]>([
    { id: '1', checkNo: 'CHK-260305-001', locationRange: 'A01-01 至 A05-10', planQty: 1250, actualQty: 1248, diffQty: -2, status: 'DONE', creator: '主管王', createdAt: '2026-03-05 08:00' },
    { id: '2', checkNo: 'CHK-260304-002', locationRange: 'B01-01 至 B02-20', planQty: 800, status: 'COUNTING', creator: '系统', createdAt: '2026-03-04 15:30' },
    { id: '3', checkNo: 'CHK-260303-005', locationRange: 'FBA-Return-Area', planQty: 156, status: 'PENDING', creator: '主管王', createdAt: '2026-03-03 11:00' },
  ]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const fetchChecks = async (_p: any) => {
    await new Promise((r) => setTimeout(r, 400));
    return { data, success: true, total: data.length };
  };

  const handleCreatePlan = () => {
    form.validateFields().then((vals) => {
      setData([{
        id: Date.now().toString(),
        checkNo: `CHK-260305-${Math.floor(Math.random() * 1000)}`,
        locationRange: vals.locationRange,
        planQty: vals.planQty || 0,
        status: 'PENDING',
        creator: '当前用户',
        createdAt: new Date().toLocaleTimeString('zh-CN'),
      }, ...data]);
      message.success('已下发盘点任务指派');
      setModalOpen(false);
      form.resetFields();
    });
  };

  const handleFinalize = (actual: number) => {
    if (!inputModal) return;
    const diff = actual - inputModal.planQty;
    setData(data.map(d => d.id === inputModal.id ? { ...d, actualQty: actual, diffQty: diff, status: 'DONE' } : d));
    message.success(diff === 0 ? '盘点无差异！已归档。' : `盘点存在差异：${diff > 0 ? '+' : ''}${diff}`);
    setInputModal(null);
  };

  const columns: ProColumns<InventoryCheck>[] = [
    { title: '盘点单号', dataIndex: 'checkNo', copyable: true, width: 160 },
    { title: '盘点范围(库位)', dataIndex: 'locationRange', ellipsis: true },
    { title: '系统账单数', dataIndex: 'planQty', width: 110, search: false },
    { title: '实盘数量', dataIndex: 'actualQty', width: 110, search: false, render: (v) => v ?? '-' },
    {
      title: '差异量', dataIndex: 'diffQty', width: 100, search: false,
      render: (v) => {
        if (v === undefined) return '-';
        const n = v as number;
        return <span className={n === 0 ? 'text-green-500' : 'text-red-500 font-bold'}>{n > 0 ? `+${n}` : n}</span>;
      },
    },
    {
      title: '状态', dataIndex: 'status', width: 100,
      valueEnum: {
        PENDING: { text: '待盘点', status: 'Warning' },
        COUNTING: { text: '盘点中', status: 'Processing' },
        DONE: { text: '已完毕', status: 'Success' },
      },
    },
    { title: '发起人', dataIndex: 'creator', width: 100, search: false },
    { title: '创建时间', dataIndex: 'createdAt', width: 150, search: false },
    {
      title: '操作', valueType: 'option', width: 130,
      render: (_, record) => record.status !== 'DONE' && [
        <a key="input" className="text-primary" onClick={() => setInputModal(record)}>
          <CalculatorOutlined className="mr-1" />{record.status === 'PENDING' ? '开始盘点' : '录入差异'}
        </a>,
      ],
    },
  ];

  return (
    <PageContainer header={{ title: '盘点作业台', subTitle: '管理日常仓库动盘与全盘任务，记录系统数与实盘数差异' }}>
      <ProTable<InventoryCheck>
        columns={columns} actionRef={actionRef} cardBordered request={fetchChecks}
        rowKey="id" search={{ labelWidth: 'auto', collapsed: false }} pagination={{ pageSize: 15 }}
        headerTitle={<Space><ProfileOutlined style={{ color: '#D23148' }} /><span>盘点任务板</span></Space>}
        toolBarRender={() => [
          <Button key="add" type="primary" icon={<PlusOutlined />} style={{ backgroundColor: '#D23148' }} onClick={() => setModalOpen(true)}>创建盘点计划</Button>
        ]}
      />

      <Modal title="创建盘点计划" open={modalOpen} onOk={handleCreatePlan} onCancel={() => { setModalOpen(false); form.resetFields(); }} okButtonProps={{ style: { backgroundColor: '#D23148' } }}>
        <Form form={form} layout="vertical" className="mt-4">
          <Form.Item label="盘点范围 (库位/区域)" name="locationRange" rules={[{ required: true }]}><Input placeholder="示例：A01货架全体 或 B区退件区" /></Form.Item>
          <Form.Item label="系统预计快照数 (大致参考)" name="planQty"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="录入盘点结果" open={!!inputModal} onOk={() => {
        const val = (document.getElementById('actualQtyInput') as HTMLInputElement).value;
        if (val) handleFinalize(Number(val));
      }} onCancel={() => setInputModal(null)}>
        {inputModal && (
          <div className="mt-4">
            <p>正在盘点：<strong>{inputModal.locationRange}</strong></p>
            <p className="mb-4 text-slate-500">系统现存数量：{inputModal.planQty}</p>
            <label className="block mb-2 font-bold">最终实盘总数：</label>
            <InputNumber id="actualQtyInput" min={0} size="large" style={{ width: '100%' }} autoFocus placeholder="输入员工实际清点的最终数量..." />
          </div>
        )}
      </Modal>
    </PageContainer>
  );
};

export default InventoryCheckPage;
