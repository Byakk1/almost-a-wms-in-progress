import React, { useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  Alert, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Switch, Tag, message, theme,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import request from '../../../utils/request';
import { useCan } from '../../../router/permissions';

// Mirrors the GET /surcharges serializer (model Surcharge, schema.prisma ~494).
interface SurchargeRow {
  id: string;
  code: string;
  name: string;
  calcType: 'FLAT' | 'PERCENT_OF_BASE' | 'PASS_THROUGH' | string;
  value: string | number | null;
  taxable: boolean;
  carrier: string | null;
  appliesTo: 'SHIPPING' | 'HANDLING' | 'ALL' | string;
  note: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
}

const CALC_LABEL: Record<string, string> = {
  FLAT: '固定',
  PERCENT_OF_BASE: '按基础运费百分比',
  PASS_THROUGH: '实报实销',
};
const CALC_COLOR: Record<string, string> = {
  FLAT: 'blue', PERCENT_OF_BASE: 'geekblue', PASS_THROUGH: 'gold',
};
const CALC_OPTIONS = Object.entries(CALC_LABEL).map(([value, label]) => ({ value, label }));

const APPLIES_LABEL: Record<string, string> = {
  SHIPPING: '运费',
  HANDLING: '操作费',
  ALL: '全部',
};
const APPLIES_OPTIONS = Object.entries(APPLIES_LABEL).map(([value, label]) => ({ value, label }));

/** PASS_THROUGH is priced by the carrier's bill, not here — render the word, not a number. */
const fmtValue = (r: SurchargeRow): string => {
  if (r.calcType === 'PASS_THROUGH' || r.value === null || r.value === undefined) return '实报实销';
  const n = Number(r.value);
  if (!Number.isFinite(n)) return '实报实销';
  return r.calcType === 'PERCENT_OF_BASE' ? `${n.toLocaleString('en-CA', { maximumFractionDigits: 4 })} %` : n.toLocaleString('en-CA', { maximumFractionDigits: 4 });
};
const fmtDay = (v: string | null): string => (v ? String(v).slice(0, 10) : '—');

const SurchargeManage: React.FC = () => {
  const { token } = theme.useToken();
  const actionRef = useRef<ActionType>(null);
  const canWrite = useCan('billing.config'); // writes SUPER_ADMIN-only; FINANCE reads
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SurchargeRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const calcType = Form.useWatch('calcType', form);
  const isPassThrough = calcType === 'PASS_THROUGH';

  const fetchList = async (params: any) => {
    const res: any = await request.get('/surcharges', {
      params: {
        page: params.current,
        pageSize: params.pageSize,
        code: params.code,
        calcType: params.calcType,
        isActive: params.isActive,
        carrier: params.carrier,
      },
    });
    return { data: res?.data ?? [], success: true, total: res?.pagination?.total ?? 0 };
  };

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({ taxable: true, appliesTo: 'ALL' });
    setEditing(null);
    setOpen(true);
  };

  // Edit cannot touch code / calcType — a different shape is a new surcharge.
  const openEdit = (row: SurchargeRow) => {
    form.resetFields();
    form.setFieldsValue({
      code: row.code,
      calcType: row.calcType,
      name: row.name,
      // PASS_THROUGH has no value by design; leave the field empty.
      value: row.calcType === 'PASS_THROUGH' || row.value === null ? undefined : Number(row.value),
      taxable: row.taxable,
      carrier: row.carrier ?? undefined,
      appliesTo: row.appliesTo,
      effectiveTo: row.effectiveTo ? dayjs(row.effectiveTo) : undefined,
      note: row.note ?? undefined,
      isActive: row.isActive,
    });
    setEditing(row);
    setOpen(true);
  };

  const submit = async () => {
    // Plain Button onClick, not Modal onOk: antd would swallow the validation
    // rejection here (same bug class as RateCard v4.36 / Users).
    try {
      const v = await form.validateFields();
      setSaving(true);
      // PASS_THROUGH never carries a value — send null explicitly on create.
      const value = v.calcType === 'PASS_THROUGH' ? null : v.value;
      // Dates are DAYS, not instants — send the literal YYYY-MM-DD (see the same
      // note in TaxRates/index.tsx; .toISOString() shifts the picked day in UTC+8).
      const day = (d: any) => (d ? d.format('YYYY-MM-DD') : undefined);
      if (editing) {
        await request.put(`/surcharges/${editing.id}`, {
          name: v.name,
          value,
          taxable: v.taxable,
          carrier: v.carrier ?? null,
          appliesTo: v.appliesTo,
          effectiveTo: v.effectiveTo ? day(v.effectiveTo) : null,
          note: v.note ?? null,
          isActive: v.isActive,
        });
        message.success('附加费已更新');
      } else {
        await request.post('/surcharges', {
          code: v.code,
          name: v.name,
          calcType: v.calcType,
          value,
          taxable: v.taxable,
          carrier: v.carrier ?? undefined,
          appliesTo: v.appliesTo,
          effectiveFrom: day(v.effectiveFrom),
          effectiveTo: day(v.effectiveTo),
          note: v.note ?? undefined,
        });
        message.success('附加费已创建');
      }
      setOpen(false);
      form.resetFields();
      actionRef.current?.reload();
    } catch (e: any) {
      if (e?.errorFields) return; // validation — the form already shows it
      message.error(e?.response?.data?.message || e?.message || '操作失败');
    } finally {
      setSaving(false);
    }
  };

  const columns: ProColumns<SurchargeRow>[] = [
    { title: '代码', dataIndex: 'code', width: 130, copyable: true, className: 'code' },
    { title: '名称', dataIndex: 'name', width: 160, ellipsis: true, search: false },
    {
      title: '计算方式',
      dataIndex: 'calcType',
      width: 150,
      valueType: 'select',
      fieldProps: { options: CALC_OPTIONS },
      render: (_, r) => <Tag color={CALC_COLOR[r.calcType] ?? 'default'}>{CALC_LABEL[r.calcType] ?? r.calcType}</Tag>,
    },
    {
      title: '数值',
      dataIndex: 'value',
      width: 120,
      align: 'right',
      search: false,
      render: (_, r) => (
        r.calcType === 'PASS_THROUGH'
          ? <span style={{ color: token.colorTextTertiary }}>实报实销</span>
          : <span className="num">{fmtValue(r)}</span>
      ),
    },
    {
      title: '计税',
      dataIndex: 'taxable',
      width: 80,
      search: false,
      render: (_, r) => (r.taxable ? <Tag color="success">计税</Tag> : <Tag>不计税</Tag>),
    },
    {
      title: '承运商',
      dataIndex: 'carrier',
      width: 130,
      render: (_, r) => (r.carrier
        ? <span className="code">{r.carrier}</span>
        : <span style={{ color: token.colorTextTertiary }}>全部</span>),
    },
    {
      title: '适用',
      dataIndex: 'appliesTo',
      width: 100,
      valueType: 'select',
      fieldProps: { options: APPLIES_OPTIONS },
      render: (_, r) => APPLIES_LABEL[r.appliesTo] ?? r.appliesTo,
    },
    {
      title: '生效起',
      dataIndex: 'effectiveFrom',
      width: 120,
      search: false,
      render: (_, r) => <span className="num">{fmtDay(r.effectiveFrom)}</span>,
    },
    {
      title: '生效止',
      dataIndex: 'effectiveTo',
      width: 120,
      search: false,
      render: (_, r) => (r.effectiveTo
        ? <span className="num">{fmtDay(r.effectiveTo)}</span>
        : <span style={{ color: token.colorTextTertiary }}>—</span>),
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
      title: '操作',
      valueType: 'option',
      width: 80,
      fixed: 'right',
      render: (_, row) => {
        if (!canWrite) return null;
        return [<a key="edit" className="console-primary-action" onClick={() => openEdit(row)}>编辑</a>];
      },
    },
  ];

  return (
    <PageContainer
      header={{
        title: '附加费管理',
        subTitle: '定义固定 / 按基础运费百分比 / 实报实销的附加费，按承运商与适用环节生效',
      }}
    >
      <Alert
        type="info"
        showIcon
        className="mb-4"
        message="实报实销的金额以承运商账单为准"
        description="PASS_THROUGH（如燃油附加费）不在此录入金额：账单在 finalize 时补录实际金额并重算税额。固定值 / 百分比请在下方维护。"
      />

      <ProTable<SurchargeRow>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        request={fetchList}
        cardBordered
        search={{ labelWidth: 'auto' }}
        scroll={{ x: 1400 }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        options={{ reload: true, density: false, setting: false }}
        toolBarRender={() => [
          canWrite && (
            <Button key="create" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增附加费
            </Button>
          ),
        ]}
      />

      <Modal
        open={open}
        title={editing ? `编辑附加费 · ${editing.code}` : '新增附加费'}
        onCancel={() => { setOpen(false); form.resetFields(); }}
        footer={[
          <Button key="cancel" onClick={() => { setOpen(false); form.resetFields(); }}>取消</Button>,
          <Button key="ok" type="primary" loading={saving} onClick={submit}>{editing ? '保存' : '创建'}</Button>,
        ]}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" name="surcharge_form" initialValues={{ taxable: true, appliesTo: 'ALL' }}>
          <Form.Item
            name="code"
            label="代码"
            rules={[{ required: true, message: '请输入代码' }, { pattern: /^[A-Z0-9_]+$/, message: '仅大写字母、数字与下划线，如 FUEL' }]}
            extra={editing ? '代码创建后不可修改' : '唯一标识，创建后不可修改，如 FUEL / PEAK'}
          >
            <Input placeholder="FUEL" disabled={!!editing} onChange={(e) => form.setFieldValue('code', e.target.value.toUpperCase())} />
          </Form.Item>
          <Form.Item
            name="calcType"
            label="计算方式"
            rules={[{ required: true, message: '请选择计算方式' }]}
            extra={editing ? '计算方式创建后不可修改' : undefined}
          >
            <Select
              options={CALC_OPTIONS}
              disabled={!!editing}
              // PASS_THROUGH carries no value; clear it so a stale number can't
              // ride along in the payload (the server rejects it anyway).
              onChange={(v) => { if (v === 'PASS_THROUGH') form.setFieldValue('value', undefined); }}
            />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }, { max: 50 }]}>
            <Input placeholder="燃油附加费" />
          </Form.Item>
          <Form.Item
            name="value"
            label="数值"
            dependencies={['calcType']}
            extra={isPassThrough ? '金额以承运商账单为准，在账单 finalize 时录入' : (calcType === 'PERCENT_OF_BASE' ? '按基础运费百分比，0–1000' : '固定金额')}
            rules={isPassThrough
              ? []
              : [{ required: true, message: '请输入数值' }, { type: 'number', min: 0, message: '不能为负' }]}
          >
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              max={calcType === 'PERCENT_OF_BASE' ? 1000 : undefined}
              step={0.0001}
              precision={4}
              disabled={isPassThrough}
              placeholder={isPassThrough ? '实报实销，无需填写' : '0.00'}
            />
          </Form.Item>
          <Form.Item name="taxable" label="计税" valuePropName="checked" extra="计税的附加费计入税额基础">
            <Switch />
          </Form.Item>
          <Form.Item name="carrier" label="承运商" extra="留空 = 适用全部承运商">
            <Input placeholder="CANADAPOST / 留空 = 全部" />
          </Form.Item>
          <Form.Item name="appliesTo" label="适用环节" rules={[{ required: true, message: '请选择适用环节' }]}>
            <Select options={APPLIES_OPTIONS} />
          </Form.Item>
          {!editing && (
            <Form.Item name="effectiveFrom" label="生效起" rules={[{ required: true, message: '请选择生效日期' }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          )}
          <Form.Item
            name="effectiveTo"
            label="生效止"
            dependencies={['effectiveFrom']}
            extra="留空表示长期有效"
            rules={[
              // Mirrors the server check: effectiveTo must be after effectiveFrom.
              ({ getFieldValue }) => ({
                validator: (_, value) => {
                  if (!value) return Promise.resolve();
                  const from = editing ? dayjs(editing.effectiveFrom) : getFieldValue('effectiveFrom');
                  if (from && !dayjs(value).isAfter(dayjs(from), 'day')) {
                    return Promise.reject(new Error('生效止必须晚于生效起'));
                  }
                  return Promise.resolve();
                },
              }),
            ]}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          {editing && (
            <Form.Item name="isActive" label="启用" valuePropName="checked" extra="停用后账单不再计算此附加费">
              <Switch />
            </Form.Item>
          )}
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default SurchargeManage;
