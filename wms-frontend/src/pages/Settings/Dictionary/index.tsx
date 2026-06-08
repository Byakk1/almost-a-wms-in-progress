import React, { useEffect, useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Button, Select, Space, Modal, Form, Input, InputNumber, Switch, Popconfirm, message, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import request from '../../../utils/request';

interface DictItem {
  id: string;
  category: string;
  code: string;
  label: string;
  labelEn?: string | null;
  sortOrder: number;
  isActive: boolean;
  parentCode?: string | null;
  extra?: string | null;
}

const DictionaryManage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState<string>();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DictItem | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    request
      .get('/dictionaries/categories')
      .then((res: any) => {
        const list: string[] = (res?.data ?? [])
          .map((c: any) => (typeof c === 'string' ? c : c?.category))
          .filter(Boolean);
        setCategories(list);
        setCategory((prev) => prev ?? list[0]);
      })
      .catch(() => {});
  }, []);

  const fetchList = async () => {
    if (!category) return { data: [], success: true, total: 0 };
    const res: any = await request.get(`/dictionaries/by-category/${category}`);
    const rows = res?.data ?? [];
    return { data: rows, success: true, total: rows.length };
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ category, sortOrder: 0, isActive: true });
    setModalOpen(true);
  };

  const openEdit = (row: DictItem) => {
    setEditing(row);
    form.setFieldsValue(row);
    setModalOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    try {
      if (editing) {
        // category / code are the unique key — not editable; send only mutable fields.
        await request.put(`/dictionaries/${editing.id}`, {
          label: values.label,
          labelEn: values.labelEn,
          sortOrder: values.sortOrder,
          parentCode: values.parentCode,
          isActive: values.isActive,
        });
      } else {
        await request.post('/dictionaries', {
          category: values.category,
          code: values.code,
          label: values.label,
          labelEn: values.labelEn,
          sortOrder: values.sortOrder,
          parentCode: values.parentCode,
        });
      }
      message.success('保存成功');
      setModalOpen(false);
      if (!categories.includes(values.category)) setCategories((c) => [...c, values.category]);
      actionRef.current?.reload();
    } catch {
      // form validation error or request interceptor surfaces it
    }
  };

  const remove = async (row: DictItem) => {
    try {
      await request.delete(`/dictionaries/${row.id}`);
      message.success('已删除');
      actionRef.current?.reload();
    } catch {
      // interceptor surfaces error
    }
  };

  const columns: ProColumns<DictItem>[] = [
    { title: '编码', dataIndex: 'code', width: 180, copyable: true },
    { title: '名称', dataIndex: 'label', width: 200 },
    { title: '英文', dataIndex: 'labelEn', ellipsis: true, render: (_, r) => r.labelEn || '—' },
    { title: '排序', dataIndex: 'sortOrder', width: 80 },
    { title: '父级', dataIndex: 'parentCode', width: 140, render: (_, r) => r.parentCode || '—' },
    {
      title: '状态',
      dataIndex: 'isActive',
      width: 80,
      render: (_, r) => <Tag color={r.isActive ? 'green' : 'default'}>{r.isActive ? '启用' : '停用'}</Tag>,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 130,
      render: (_, row) => [
        <a key="edit" className="text-primary hover:text-primary-light font-medium" onClick={() => openEdit(row)}>
          编辑
        </a>,
        <Popconfirm key="del" title="确认删除该字典项？" onConfirm={() => remove(row)} okText="确认" cancelText="取消">
          <a className="text-red-500 hover:text-red-400 font-medium">删除</a>
        </Popconfirm>,
      ],
    },
  ];

  return (
    <PageContainer header={{ title: '数据字典', subTitle: '维护系统枚举字典（异常类型、单位、币种等）' }}>
      <ProTable<DictItem>
        columns={columns}
        actionRef={actionRef}
        cardBordered
        request={fetchList}
        params={{ category }}
        rowKey="id"
        search={false}
        pagination={false}
        dateFormatter="string"
        headerTitle={
          <Space>
            <span>字典分类</span>
            <Select
              placeholder="选择分类"
              style={{ width: 240 }}
              value={category}
              onChange={setCategory}
              showSearch
              options={categories.map((c) => ({ value: c, label: c }))}
            />
          </Space>
        }
        toolBarRender={() => [
          <Button key="add" type="primary" icon={<PlusOutlined />} onClick={openCreate} disabled={!category}>
            新建字典项
          </Button>,
        ]}
      />
      <Modal
        title={editing ? '编辑字典项' : '新建字典项'}
        open={modalOpen}
        onOk={submit}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="category" label="分类" rules={[{ required: true, message: '请输入分类' }]}>
            <Input disabled={!!editing} placeholder="如 EXCEPTION_TYPE" />
          </Form.Item>
          <Form.Item name="code" label="编码" rules={[{ required: true, message: '请输入编码' }]}>
            <Input disabled={!!editing} placeholder="如 DAMAGE" />
          </Form.Item>
          <Form.Item name="label" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如 货物破损" />
          </Form.Item>
          <Form.Item name="labelEn" label="英文名称">
            <Input placeholder="Damage" />
          </Form.Item>
          <Form.Item name="sortOrder" label="排序">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="parentCode" label="父级编码">
            <Input placeholder="可选" />
          </Form.Item>
          {editing && (
            <Form.Item name="isActive" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default DictionaryManage;
