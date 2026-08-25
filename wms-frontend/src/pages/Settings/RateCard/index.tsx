import React, { useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  Button, Tag, Modal, Form, Input, Select, DatePicker, Switch, message, Alert,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import request from '../../../utils/request';
import { useCan } from '../../../router/permissions';
import RateCardDetail from './Detail';
import { STATUS_COLOR, STATUS_LABEL, TYPE_COLOR, TYPE_LABEL } from './constants';

interface RateCardRow {
  id: string;
  name: string;
  type: string;
  carrier: string | null;
  currency: string;
  isDefault: boolean;
  status: string;
  effectiveAt: string;
  expiredAt: string | null;
  itemCount: number;
  zoneCount: number;
  customerCount: number;
}

const RateCardManage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const canWrite = useCan('rateCard.write');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const type = Form.useWatch('type', form);

  const fetchList = async (params: any) => {
    const res: any = await request.get('/rate-cards', {
      params: {
        page: params.current, pageSize: params.pageSize,
        type: params.type, status: params.status, carrier: params.carrier,
      },
    });
    return { data: res?.data ?? [], success: true, total: res?.pagination?.total ?? 0 };
  };

  const submit = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const res: any = await request.post('/rate-cards', {
        ...v,
        effectiveAt: v.effectiveAt?.toISOString(),
        expiredAt: v.expiredAt ? v.expiredAt.toISOString() : undefined,
      });
      message.success('价卡已创建为草稿');
      setCreateOpen(false);
      form.resetFields();
      actionRef.current?.reload();
      setDetailId(res?.data?.id ?? null);
    } catch {
      // request.ts interceptor surfaces errors
    } finally {
      setSaving(false);
    }
  };

  const columns: ProColumns<RateCardRow>[] = [
    {
      title: '价卡名称', dataIndex: 'name', width: 220, ellipsis: true, search: false,
      render: (_, r) => (
        <a onClick={() => setDetailId(r.id)}>
          {r.name}
          {r.isDefault && <Tag color="cyan" className="ml-2">默认</Tag>}
        </a>
      ),
    },
    {
      title: '类型', dataIndex: 'type', width: 100, valueType: 'select',
      valueEnum: {
        STORAGE: { text: '仓储' }, FULFILLMENT: { text: '操作' },
        SHIPPING: { text: '运费' }, EXTRA: { text: '增值' },
      },
      render: (_, r) => <Tag color={TYPE_COLOR[r.type]}>{TYPE_LABEL[r.type] ?? r.type}</Tag>,
    },
    { title: '承运商', dataIndex: 'carrier', width: 130, render: (_, r) => r.carrier || '—' },
    {
      title: '状态', dataIndex: 'status', width: 100, valueType: 'select',
      valueEnum: { DRAFT: { text: '草稿' }, ACTIVE: { text: '已启用' }, ARCHIVED: { text: '已归档' } },
      render: (_, r) => <Tag color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status] ?? r.status}</Tag>,
    },
    { title: '币种', dataIndex: 'currency', width: 80, search: false },
    {
      title: '有效期', width: 200, search: false,
      render: (_, r) => (
        <span>
          {String(r.effectiveAt).slice(0, 10)}
          {' → '}
          {r.expiredAt ? String(r.expiredAt).slice(0, 10) : <span className="text-gray-400">长期</span>}
        </span>
      ),
    },
    { title: '明细', dataIndex: 'itemCount', width: 90, search: false, align: 'right' },
    {
      title: '分区', dataIndex: 'zoneCount', width: 90, search: false, align: 'right',
      render: (_, r) => (r.zoneCount ? r.zoneCount.toLocaleString() : '—'),
    },
    { title: '绑定客户', dataIndex: 'customerCount', width: 90, search: false, align: 'right' },
    {
      title: '操作', width: 80, search: false, fixed: 'right',
      render: (_, r) => <Button size="small" type="link" onClick={() => setDetailId(r.id)}>查看</Button>,
    },
  ];

  return (
    <PageContainer
      header={{ title: '价卡管理', subTitle: '仓储 / 操作 / 运费 / 增值服务的计费价目，按生效日期分版本' }}
    >
      <Alert
        type="info" showIcon className="mb-4"
        message="价格按版本管理，启用后即冻结"
        description="启用一张价卡会先校验其梯度是否连续、无重叠、顶档开口；通过后价格不可再改。调价请新建一张生效日期更晚的价卡，旧卡归档——这样历史账单仍能按当时的价格重算。"
      />

      <ProTable<RateCardRow>
        columns={columns}
        actionRef={actionRef}
        request={fetchList}
        rowKey="id"
        cardBordered
        scroll={{ x: 1200 }}
        search={{ labelWidth: 'auto' }}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        headerTitle="价卡列表"
        toolBarRender={() => [
          <Button key="r" icon={<ReloadOutlined />} onClick={() => actionRef.current?.reload()}>刷新</Button>,
          <Button key="a" type="primary" icon={<PlusOutlined />} disabled={!canWrite} onClick={() => setCreateOpen(true)}>
            新建价卡
          </Button>,
        ]}
      />

      <RateCardDetail
        cardId={detailId}
        onClose={() => setDetailId(null)}
        onChanged={() => actionRef.current?.reload()}
      />

      <Modal
        title="新建价卡"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={submit}
        confirmLoading={saving}
        destroyOnHidden
        okText="创建草稿"
      >
        <Alert
          type="info" showIcon className="mb-4"
          message="创建的是草稿"
          description="新卡以草稿状态建立，明细可随后补充；批量价目（尤其是运费的成千上万条）由导入脚本写入，不建议手工录入。"
        />
        <Form form={form} layout="vertical" initialValues={{ currency: 'CAD', isDefault: false }}>
          <Form.Item label="价卡名称" name="name" rules={[{ required: true, message: '请填写价卡名称' }]}>
            <Input placeholder="例如：加拿大邮政 Expedited 2026H2" />
          </Form.Item>
          <Form.Item label="类型" name="type" rules={[{ required: true, message: '请选择类型' }]}>
            <Select options={[
              { value: 'STORAGE', label: '仓储' },
              { value: 'FULFILLMENT', label: '操作' },
              { value: 'SHIPPING', label: '运费' },
              { value: 'EXTRA', label: '增值服务' },
            ]} />
          </Form.Item>
          {type === 'SHIPPING' && (
            <Form.Item label="承运商" name="carrier" rules={[{ required: true, message: '运费价卡必须指定承运商' }]}>
              <Input placeholder="例如 CANADAPOST" />
            </Form.Item>
          )}
          <Form.Item label="币种" name="currency" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="生效日期" name="effectiveAt" rules={[{ required: true, message: '请选择生效日期' }]}>
            <DatePicker style={{ width: '100%' }} showTime />
          </Form.Item>
          <Form.Item label="失效日期" name="expiredAt" extra="留空表示长期有效，直到有更晚生效的版本取代">
            <DatePicker style={{ width: '100%' }} showTime />
          </Form.Item>
          <Form.Item
            label="设为默认挂牌价" name="isDefault" valuePropName="checked"
            extra="未单独绑定价卡的客户按默认卡计费；默认卡不参与合同折扣，恒按标准价"
          >
            <Switch />
          </Form.Item>
          <Form.Item label="备注" name="note">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default RateCardManage;
