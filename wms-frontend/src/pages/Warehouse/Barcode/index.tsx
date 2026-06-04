import React, { useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Space, Button, Modal, Form, InputNumber, Input, message, Tag, Select } from 'antd';
import { BarcodeOutlined, PrinterOutlined, PlusOutlined } from '@ant-design/icons';

interface BarcodeTask {
  id: string;
  taskNo: string;
  prefix: string;
  qty: number;
  type: 'BOX' | 'LOCATION' | 'PALLET';
  creator: string;
  createdAt: string;
  status: 'GENERATED' | 'PRINTED';
}

const BarcodeGenerator: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  
  const [data, setData] = useState<BarcodeTask[]>([
    { id: '1', taskNo: 'BCT-260305-001', prefix: 'BOX-260305', qty: 500, type: 'BOX', creator: '仓管李', createdAt: '2026-03-05 09:00', status: 'PRINTED' },
    { id: '2', taskNo: 'BCT-260304-002', prefix: 'LOC-A1-', qty: 100, type: 'LOCATION', creator: '系统', createdAt: '2026-03-04 14:30', status: 'GENERATED' },
    { id: '3', taskNo: 'BCT-260303-001', prefix: 'PLT-US-', qty: 50, type: 'PALLET', creator: '仓管李', createdAt: '2026-03-03 10:15', status: 'PRINTED' },
  ]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const fetchTasks = async (_p: any) => {
    await new Promise((r) => setTimeout(r, 400));
    return { data, success: true, total: data.length };
  };

  const handleGenerate = () => {
    form.validateFields().then((vals) => {
      const newTask: BarcodeTask = {
        id: Date.now().toString(),
        taskNo: `BCT-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-xxx`,
        ...vals,
        creator: '当前用户',
        createdAt: new Date().toLocaleTimeString('zh-CN'),
        status: 'GENERATED',
      };
      setData([newTask, ...data]);
      message.success(`成功生成 ${vals.qty} 个条形码`);
      setModalOpen(false);
      form.resetFields();
    });
  };

  const columns: ProColumns<BarcodeTask>[] = [
    { title: '任务编号', dataIndex: 'taskNo', copyable: true, width: 160 },
    {
      title: '条码类型', dataIndex: 'type', width: 120,
      valueEnum: {
        BOX: { text: '箱子条码', status: 'Default' },
        LOCATION: { text: '库位条码', status: 'Processing' },
        PALLET: { text: '托盘条码', status: 'Warning' },
      },
    },
    { title: '前缀规则', dataIndex: 'prefix', width: 150, render: (v) => <code>{v as string}</code> },
    { title: '生成数量', dataIndex: 'qty', width: 100, search: false },
    { title: '操作人', dataIndex: 'creator', width: 100, search: false },
    { title: '生成时间', dataIndex: 'createdAt', width: 150, search: false },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (v) => <Tag color={v === 'PRINTED' ? 'success' : 'blue'}>{v === 'PRINTED' ? '已打印' : '待打印'}</Tag>,
    },
    {
      title: '操作', valueType: 'option', width: 130,
      render: (_, record) => [
        <a key="print" className="text-primary" onClick={() => {
          message.success(`已下发打印指令：${record.taskNo}`);
          setData((prev) => prev.map(r => r.id === record.id ? { ...r, status: 'PRINTED' } : r));
        }}><PrinterOutlined className="mr-1" />连接打印机</a>,
      ],
    },
  ];

  return (
    <PageContainer header={{ title: '箱体条码生成', subTitle: '批量生成并打印箱子、托盘、库位等唯一识别条码' }}>
      <ProTable<BarcodeTask>
        columns={columns} actionRef={actionRef} cardBordered request={fetchTasks}
        rowKey="id" search={{ labelWidth: 'auto', collapsed: false }} pagination={{ pageSize: 15 }}
        headerTitle={<Space><BarcodeOutlined style={{ color: '#D23148' }} /><span>条码生成批次记录</span></Space>}
        toolBarRender={() => [
          <Button key="add" type="primary" icon={<PlusOutlined />} style={{ backgroundColor: '#D23148' }} onClick={() => setModalOpen(true)}>新建生成任务</Button>
        ]}
      />

      <Modal title="新建条码生成任务" open={modalOpen} onOk={handleGenerate} onCancel={() => { setModalOpen(false); form.resetFields(); }} okButtonProps={{ style: { backgroundColor: '#D23148' } }}>
        <Form form={form} layout="vertical" className="mt-4" initialValues={{ type: 'BOX', qty: 100 }}>
          <Form.Item label="条码归属类型" name="type" rules={[{ required: true }]}>
            <Form.Item noStyle name="type"><Input hidden/></Form.Item>
            <Select>
              <Select.Option value="BOX">外箱流转条码</Select.Option>
              <Select.Option value="LOCATION">库位条码</Select.Option>
              <Select.Option value="PALLET">托盘条码</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="条码号前缀 (留空则系统自动分配)" name="prefix">
            <Input placeholder="例如: BOX-WH1-" />
          </Form.Item>
          <Form.Item label="生成数量 (个)" name="qty" rules={[{ required: true }]}>
            <InputNumber min={1} max={5000} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default BarcodeGenerator;
