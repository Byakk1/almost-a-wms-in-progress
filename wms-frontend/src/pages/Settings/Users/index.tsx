import React, { useEffect, useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Tag, Typography, message,
} from 'antd';
import { PlusOutlined, CopyOutlined } from '@ant-design/icons';
import request from '../../../utils/request';
import { useCan } from '../../../router/permissions';
import { useAuthStore } from '../../../store/auth';
import { ROLE_LABEL, ROLE_COLOR, ROLE_OPTIONS } from './constants';

// Mirrors GET /users (SAFE_SELECT in users.service.ts) — passwordHash never arrives.
interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  warehouseId: string | null;
  warehouse: { id: string; code: string; name: string } | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface WarehouseOption { id: string; code: string; name: string }

/** The one place a temporary password is ever shown. Dismiss = gone. */
const TempPasswordModal: React.FC<{
  payload: { email: string; tempPassword: string; mode: 'create' | 'reset' } | null;
  onClose: () => void;
}> = ({ payload, onClose }) => (
  <Modal
    open={!!payload}
    title={payload?.mode === 'create' ? '用户已创建' : '密码已重置'}
    onOk={onClose}
    onCancel={onClose}
    okText="我已保存"
    cancelButtonProps={{ style: { display: 'none' } }}
    destroyOnHidden
  >
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 16 }}
      message="此临时密码仅显示一次"
      description="关闭后无法再次查看。请立即交给对方，并提醒其首次登录后修改密码。"
    />
    <div style={{ marginBottom: 8 }}>账号：<Typography.Text className="code">{payload?.email}</Typography.Text></div>
    <Space>
      <span>临时密码：</span>
      <Typography.Text className="code" strong style={{ fontSize: 16 }}>{payload?.tempPassword}</Typography.Text>
      <Button
        size="small"
        icon={<CopyOutlined />}
        onClick={() => {
          navigator.clipboard?.writeText(payload?.tempPassword ?? '');
          message.success('已复制');
        }}
      >
        复制
      </Button>
    </Space>
  </Modal>
);

const UserManage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const canWrite = useCan('user.write');
  const myId = useAuthStore((s) => s.userInfo?.id);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tempPw, setTempPw] = useState<{ email: string; tempPassword: string; mode: 'create' | 'reset' } | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    request.get('/warehouses').then((res: any) => setWarehouses(res?.data ?? [])).catch(() => {});
  }, []);

  const fetchList = async (params: any) => {
    const res: any = await request.get('/users', {
      params: {
        page: params.current,
        pageSize: params.pageSize,
        keyword: params.keyword,
        role: params.role,
        isActive: params.isActive,
        warehouseId: params.warehouseId,
      },
    });
    return { data: res?.data ?? [], success: true, total: res?.pagination?.total ?? 0 };
  };

  const openCreate = () => {
    form.resetFields();
    setEditing(null);
    setCreateOpen(true);
  };

  const openEdit = (row: UserRow) => {
    form.setFieldsValue({
      email: row.email,
      name: row.name,
      role: row.role,
      warehouseId: row.warehouseId ?? undefined,
    });
    setEditing(row);
    setCreateOpen(true);
  };

  const submit = async () => {
    // Inside try: this is a plain Button onClick, not Modal onOk, so antd does not
    // swallow a validation rejection for us (same bug class as RateCard v4.36).
    try {
      const v = await form.validateFields();
      setSaving(true);
      if (editing) {
        await request.put(`/users/${editing.id}`, { ...v, warehouseId: v.warehouseId ?? null });
        message.success('用户已更新');
      } else {
        const res: any = await request.post('/users', { ...v, warehouseId: v.warehouseId ?? null });
        setTempPw({ email: res?.data?.user?.email, tempPassword: res?.data?.tempPassword, mode: 'create' });
      }
      setCreateOpen(false);
      form.resetFields();
      actionRef.current?.reload();
    } catch (e: any) {
      if (e?.errorFields) return; // validation — the form already shows it
      message.error(e?.response?.data?.message || e?.message || '操作失败');
    } finally {
      setSaving(false);
    }
  };

  const act = async (row: UserRow, action: 'deactivate' | 'reactivate' | 'reset-password') => {
    try {
      const res: any = await request.post(`/users/${row.id}/${action}`);
      if (action === 'reset-password') {
        setTempPw({ email: row.email, tempPassword: res?.data?.tempPassword, mode: 'reset' });
      } else {
        message.success(action === 'deactivate' ? '已停用' : '已启用');
      }
      actionRef.current?.reload();
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '操作失败');
    }
  };

  const columns: ProColumns<UserRow>[] = [
    {
      title: '关键字',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: '姓名 / 邮箱' },
    },
    { title: '姓名', dataIndex: 'name', width: 140, search: false },
    { title: '邮箱', dataIndex: 'email', width: 240, copyable: true, className: 'code', search: false },
    {
      title: '角色',
      dataIndex: 'role',
      width: 130,
      valueType: 'select',
      fieldProps: { options: ROLE_OPTIONS },
      render: (_, r) => <Tag color={ROLE_COLOR[r.role]}>{ROLE_LABEL[r.role] ?? r.role}</Tag>,
    },
    {
      title: '所属仓库',
      dataIndex: 'warehouseId',
      width: 160,
      valueType: 'select',
      fieldProps: { options: warehouses.map((w) => ({ label: `${w.code} ${w.name}`, value: w.id })), showSearch: true },
      render: (_, r) => (r.warehouse ? `${r.warehouse.code} ${r.warehouse.name}` : <span style={{ color: 'var(--color-ink-muted)' }}>全部</span>),
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      width: 90,
      valueType: 'select',
      fieldProps: { options: [{ label: '启用', value: 'true' }, { label: '停用', value: 'false' }] },
      render: (_, r) => (r.isActive ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>),
    },
    {
      title: '最近登录',
      dataIndex: 'lastLoginAt',
      width: 170,
      valueType: 'dateTime',
      search: false,
      render: (_, r) => (r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleString('zh-CN', { hour12: false }) : '从未'),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 220,
      fixed: 'right',
      render: (_, row) => {
        if (!canWrite) return null;
        const isSelf = row.id === myId;
        return [
          <a key="edit" className="console-primary-action" onClick={() => openEdit(row)}>编辑</a>,
          <Popconfirm
            key="reset"
            title="重置密码？"
            description="将生成新的临时密码，旧密码立即失效。"
            onConfirm={() => act(row, 'reset-password')}
            okText="重置"
            cancelText="取消"
          >
            <a className="console-primary-action">重置密码</a>
          </Popconfirm>,
          row.isActive ? (
            <Popconfirm
              key="deactivate"
              title="停用该账号？"
              description="对方将立即无法登录，已登录的会话也会失效。"
              onConfirm={() => act(row, 'deactivate')}
              okText="停用"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              disabled={isSelf}
            >
              <a className="console-danger-action" style={isSelf ? { opacity: 0.4, cursor: 'not-allowed' } : undefined} title={isSelf ? '不能停用自己' : undefined}>停用</a>
            </Popconfirm>
          ) : (
            <a key="reactivate" className="console-primary-action" onClick={() => act(row, 'reactivate')}>启用</a>
          ),
        ];
      },
    },
  ];

  return (
    <PageContainer
      header={{
        title: '用户管理',
        subTitle: '创建员工账号、分配角色与仓库、重置密码、停用离职账号',
      }}
    >
      <ProTable<UserRow>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        request={fetchList}
        cardBordered
        search={{ labelWidth: 'auto' }}
        scroll={{ x: 1100 }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        options={{ reload: true, density: false, setting: false }}
        toolBarRender={() => [
          canWrite && (
            <Button key="create" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建用户
            </Button>
          ),
        ]}
      />

      <Modal
        open={createOpen}
        title={editing ? `编辑用户 · ${editing.email}` : '新建用户'}
        onCancel={() => { setCreateOpen(false); form.resetFields(); }}
        footer={[
          <Button key="cancel" onClick={() => { setCreateOpen(false); form.resetFields(); }}>取消</Button>,
          <Button key="ok" type="primary" loading={saving} onClick={submit}>{editing ? '保存' : '创建并生成临时密码'}</Button>,
        ]}
        destroyOnHidden
      >
        {!editing && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="密码由系统生成"
            description="创建后将显示一次性临时密码，请当场交给对方。"
          />
        )}
        <Form form={form} layout="vertical" name="user_form">
          <Form.Item name="email" label="邮箱（登录账号）" rules={[{ required: true, message: '请输入邮箱' }, { type: 'email', message: '邮箱格式不正确' }]}>
            <Input placeholder="name@company.com" autoComplete="off" />
          </Form.Item>
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }, { max: 50 }]}>
            <Input placeholder="员工姓名" />
          </Form.Item>
          <Form.Item
            name="role"
            label="角色"
            rules={[{ required: true, message: '请选择角色' }]}
            extra={editing && editing.id === myId ? '不能修改自己的角色' : undefined}
          >
            <Select options={ROLE_OPTIONS} disabled={!!editing && editing.id === myId} />
          </Form.Item>
          <Form.Item name="warehouseId" label="所属仓库" extra="留空 = 不限定仓库（管理员、财务通常留空）">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={warehouses.map((w) => ({ label: `${w.code} ${w.name}`, value: w.id }))}
              placeholder="可选"
            />
          </Form.Item>
        </Form>
      </Modal>

      <TempPasswordModal payload={tempPw} onClose={() => setTempPw(null)} />
    </PageContainer>
  );
};

export default UserManage;
