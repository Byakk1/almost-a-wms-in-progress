import React, { useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Space, Button, Tag, Modal, Form, Input, InputNumber, message, Select } from 'antd';
import { PlusOutlined, ExportOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';

const { Option } = Select;

interface Packaging {
  id: string;
  code: string;
  name: string;
  type: 'CARTON' | 'BAG' | 'PALLET' | 'BUBBLE_WRAP';
  length?: number;
  width?: number;
  height?: number;
  weight: number;
  cost: number;
  stock: number;
}

const MaterialPackaging: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  
  const [data, setData] = useState<Packaging[]>([
    { id: '1', code: 'BOX-S', name: '小号加厚纸箱', type: 'CARTON', length: 30, width: 20, height: 15, weight: 0.15, cost: 1.5, stock: 5000 },
    { id: '2', code: 'BOX-M', name: '中号标准纸箱', type: 'CARTON', length: 40, width: 30, height: 20, weight: 0.35, cost: 2.8, stock: 3200 },
    { id: '3', code: 'BOX-L', name: '大号承重纸箱', type: 'CARTON', length: 60, width: 40, height: 40, weight: 0.75, cost: 5.5, stock: 800 },
    { id: '4', code: 'BAG-A4', name: 'A4防伪快递袋', type: 'BAG', length: 30, width: 20, weight: 0.02, cost: 0.3, stock: 12000 },
    { id: '5', code: 'PALLET-US', name: '美标托盘', type: 'PALLET', length: 120, width: 100, height: 15, weight: 15.0, cost: 45.0, stock: 150 },
  ]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const fetchMaterials = async (_params: any) => {
    await new Promise((r) => setTimeout(r, 400));
    return { data, success: true, total: data.length };
  };

  const handleSave = () => {
    form.validateFields().then((vals) => {
      message.success('保存成功');
      setData([{ ...vals, id: Date.now().toString(), stock: vals.stock || 0 }, ...data]);
      setModalOpen(false);
      form.resetFields();
    });
  };

  const TYPE_LABELS: Record<string, string> = {
    CARTON: '纸箱', BAG: '快递袋', PALLET: '托盘', BUBBLE_WRAP: '气泡缓冲物'
  };

  const columns: ProColumns<Packaging>[] = [
    { title: '包材代码', dataIndex: 'code', copyable: true, width: 120 },
    { title: '名称', dataIndex: 'name', ellipsis: true },
    {
      title: '类型', dataIndex: 'type', width: 100,
      render: (v) => <Tag color="blue">{TYPE_LABELS[v as string]}</Tag>,
      valueEnum: { CARTON: '纸箱', BAG: '快递袋', PALLET: '托盘', BUBBLE_WRAP: '缓冲物' },
    },
    { 
      title: '尺寸(cm)', width: 120, search: false,
      render: (_, r: Packaging) => r.length && r.width ? `${r.length}×${r.width}${r.height ? '×' + r.height : ''}` : '-' 
    },
    { title: '自身重量(kg)', dataIndex: 'weight', width: 100, search: false },
    { title: '单件成本(¥)', dataIndex: 'cost', width: 100, search: false, render: (v) => <span className="text-orange-600 font-bold">¥{v as number}</span> },
    { 
      title: '当前库存', dataIndex: 'stock', width: 100, search: false,
      render: (v) => {
        const n = v as number;
        return <span className={n < 1000 ? 'text-red-500 font-bold' : ''}>{n}</span>;
      }
    },
    {
      title: '操作', valueType: 'option', width: 120,
      render: () => [
        <a key="edit" className="text-primary"><EditOutlined /></a>,
        <a key="del" className="text-red-500"><DeleteOutlined /></a>,
      ],
    },
  ];

  return (
    <PageContainer header={{ title: '包材管理', subTitle: '维护仓库耗材纸箱、快递袋、托盘等，用于打包操作时选用' }}>
      <ProTable<Packaging>
        columns={columns} actionRef={actionRef} cardBordered request={fetchMaterials}
        rowKey="id" search={{ labelWidth: 'auto', collapsed: false }} pagination={{ pageSize: 15 }}
        headerTitle={<Space><span>包材耗材列表</span></Space>}
        toolBarRender={() => [
          <Button key="export" icon={<ExportOutlined />}>导出</Button>,
          <Button key="add" type="primary" icon={<PlusOutlined />} style={{ backgroundColor: '#D23148' }} onClick={() => setModalOpen(true)}>新增包材</Button>
        ]}
      />

      <Modal title="新增包材" open={modalOpen} onOk={handleSave} onCancel={() => { setModalOpen(false); form.resetFields(); }} okButtonProps={{ style: { backgroundColor: '#D23148' } }}>
        <Form form={form} layout="vertical" className="mt-4">
          <Form.Item label="包材代码" name="code" rules={[{ required: true }]}><Input placeholder="唯一编码，如 BOX-XL" /></Form.Item>
          <Form.Item label="包材名称" name="name" rules={[{ required: true }]}><Input placeholder="全称显示，如 特大号加厚纸箱" /></Form.Item>
          <Form.Item label="类型" name="type" initialValue="CARTON" rules={[{ required: true }]}>
            <Select>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <Option key={k} value={k}>{v}</Option>)}
            </Select>
          </Form.Item>
          <Space>
            <Form.Item label="长(cm)" name="length"><InputNumber min={0} /></Form.Item>
            <Form.Item label="宽(cm)" name="width"><InputNumber min={0} /></Form.Item>
            <Form.Item label="高(cm)" name="height"><InputNumber min={0} /></Form.Item>
          </Space>
          <Space>
            <Form.Item label="空箱重量(kg)" name="weight" rules={[{ required: true }]}><InputNumber min={0} step={0.01} /></Form.Item>
            <Form.Item label="单件成本(¥)" name="cost" rules={[{ required: true }]}><InputNumber min={0} step={0.1} /></Form.Item>
          </Space>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default MaterialPackaging;
