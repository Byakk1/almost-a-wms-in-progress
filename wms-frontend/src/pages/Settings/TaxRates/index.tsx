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

// Mirrors the GET /tax-rates serializer (models TaxRate, schema.prisma ~474).
// ratePercent arrives as a Prisma Decimal → string over the wire; Number() it.
interface TaxRateRow {
  id: string;
  countryCode: string;
  jurisdiction: string;
  taxType: 'GST' | 'HST' | 'PST' | 'QST' | 'EXPORT' | string;
  ratePercent: string | number;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

const TAX_TYPE_LABEL: Record<string, string> = {
  GST: 'GST', HST: 'HST', PST: 'PST', QST: 'QST', EXPORT: '出口零税率',
};
const TAX_TYPE_COLOR: Record<string, string> = {
  GST: 'blue', HST: 'geekblue', PST: 'purple', QST: 'magenta', EXPORT: 'green',
};
const TAX_TYPE_OPTIONS = Object.entries(TAX_TYPE_LABEL).map(([value, label]) => ({ value, label }));

/** 9.975 must not round to 9.98 — keep up to 3 dp, drop trailing zeros. */
const fmtRate = (v: string | number): string => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-CA', { maximumFractionDigits: 3 }) : '—';
};
const fmtDay = (v: string | null): string => (v ? String(v).slice(0, 10) : '—');

const TaxRateManage: React.FC = () => {
  const { token } = theme.useToken();
  const actionRef = useRef<ActionType>(null);
  const canWrite = useCan('billing.config'); // writes SUPER_ADMIN-only; FINANCE reads
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TaxRateRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const fetchList = async (params: any) => {
    const res: any = await request.get('/tax-rates', {
      params: {
        page: params.current,
        pageSize: params.pageSize,
        countryCode: params.countryCode,
        jurisdiction: params.jurisdiction,
        taxType: params.taxType,
        isActive: params.isActive,
      },
    });
    return { data: res?.data ?? [], success: true, total: res?.pagination?.total ?? 0 };
  };

  const openCreate = () => {
    form.resetFields();
    setEditing(null);
    setOpen(true);
  };

  // Edit exposes ONLY the mutable fields — a rate is history, not a value you overwrite.
  const openEdit = (row: TaxRateRow) => {
    form.resetFields();
    form.setFieldsValue({
      ratePercent: Number(row.ratePercent),
      effectiveTo: row.effectiveTo ? dayjs(row.effectiveTo) : undefined,
      isActive: row.isActive,
      note: row.note ?? undefined,
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
      // Dates are DAYS, not instants: serialise as the literal YYYY-MM-DD the user
      // picked. .toISOString() would shift a local-midnight day back to the previous
      // day 16:00Z in UTC+8, making a rate start (or end) 8 hours off — the same
      // boundary class as the NS 15→14 % seed bug (E4 adversarial audit). The
      // server parses YYYY-MM-DD as UTC midnight, matching the half-open windows.
      const day = (d: any) => (d ? d.format('YYYY-MM-DD') : undefined);
      if (editing) {
        await request.put(`/tax-rates/${editing.id}`, {
          ratePercent: v.ratePercent,
          effectiveTo: v.effectiveTo ? day(v.effectiveTo) : null,
          isActive: v.isActive,
          note: v.note ?? null,
        });
        message.success('税率已更新');
      } else {
        await request.post('/tax-rates', {
          countryCode: String(v.countryCode).toUpperCase(),
          jurisdiction: v.jurisdiction,
          taxType: v.taxType,
          ratePercent: v.ratePercent,
          effectiveFrom: day(v.effectiveFrom),
          effectiveTo: day(v.effectiveTo),
          note: v.note ?? undefined,
        });
        message.success('税率已新增');
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

  const columns: ProColumns<TaxRateRow>[] = [
    { title: '国家', dataIndex: 'countryCode', width: 90, className: 'code' },
    { title: '辖区', dataIndex: 'jurisdiction', width: 100, className: 'code' },
    {
      title: '税种',
      dataIndex: 'taxType',
      width: 130,
      valueType: 'select',
      fieldProps: { options: TAX_TYPE_OPTIONS },
      render: (_, r) => <Tag color={TAX_TYPE_COLOR[r.taxType] ?? 'default'}>{TAX_TYPE_LABEL[r.taxType] ?? r.taxType}</Tag>,
    },
    {
      title: '税率 %',
      dataIndex: 'ratePercent',
      width: 100,
      align: 'right',
      search: false,
      render: (_, r) => <span className="num">{fmtRate(r.ratePercent)}</span>,
    },
    {
      title: '生效起',
      dataIndex: 'effectiveFrom',
      width: 130,
      search: false,
      render: (_, r) => <span className="num">{fmtDay(r.effectiveFrom)}</span>,
    },
    {
      title: '生效止',
      dataIndex: 'effectiveTo',
      width: 130,
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
      title: '备注',
      dataIndex: 'note',
      ellipsis: true,
      search: false,
      render: (_, r) => r.note || <span style={{ color: token.colorTextTertiary }}>—</span>,
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
        title: '税率管理',
        subTitle: '按目的地国家 / 辖区维护 GST / HST / PST / QST 及出口零税率',
      }}
    >
      <Alert
        type="info"
        showIcon
        className="mb-4"
        message="税率为公法数据；账单在账期末解析适用税率。"
        description="税率按 (国家, 辖区, 税种, 生效窗口) 唯一。历史账单永久保留其当时的税率——调价请结束当前行并新增一行，不要原地修改历史。"
      />

      <ProTable<TaxRateRow>
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
              新增税率
            </Button>
          ),
        ]}
      />

      <Modal
        open={open}
        title={editing ? `编辑税率 · ${editing.countryCode}/${editing.jurisdiction} ${editing.taxType}` : '新增税率'}
        onCancel={() => { setOpen(false); form.resetFields(); }}
        footer={[
          <Button key="cancel" onClick={() => { setOpen(false); form.resetFields(); }}>取消</Button>,
          <Button key="ok" type="primary" loading={saving} onClick={submit}>{editing ? '保存' : '创建'}</Button>,
        ]}
        destroyOnHidden
      >
        {editing && (
          <Alert
            type="warning"
            showIcon
            className="mb-4"
            message="调整税率请结束当前行并新增一行，以保留历史"
            description="生效起、国家、辖区、税种、税率均不可原地修改；这里只能结束有效期、停用或改备注。"
          />
        )}
        <Form form={form} layout="vertical" name="tax_rate_form" initialValues={{ isActive: true }}>
          {!editing && (
            <>
              <Form.Item
                name="countryCode"
                label="国家代码"
                rules={[
                  { required: true, message: '请输入国家代码' },
                  { pattern: /^[A-Z]{2}$/, message: '需为 2 位大写字母，如 CA' },
                ]}
              >
                <Input
                  placeholder="CA"
                  maxLength={2}
                  onChange={(e) => form.setFieldValue('countryCode', e.target.value.toUpperCase())}
                />
              </Form.Item>
              <Form.Item name="jurisdiction" label="辖区 / 省份代码" rules={[{ required: true, message: '请输入辖区代码' }]}>
                <Input placeholder="ON / NSW / AU" />
              </Form.Item>
              <Form.Item name="taxType" label="税种" rules={[{ required: true, message: '请选择税种' }]}>
                <Select options={TAX_TYPE_OPTIONS} />
              </Form.Item>
              <Form.Item
                name="effectiveFrom"
                label="生效起"
                rules={[{ required: true, message: '请选择生效日期' }]}
              >
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </>
          )}
          <Form.Item
            name="ratePercent"
            label="税率 %"
            rules={[{ required: true, message: '请输入税率' }, { type: 'number', min: 0, max: 100, message: '税率需在 0–100 之间' }]}
          >
            <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.001} precision={3} addonAfter="%" />
          </Form.Item>
          <Form.Item
            name="effectiveTo"
            label="生效止"
            dependencies={['effectiveFrom']}
            extra={editing ? '留空表示长期有效；结束一行即可保留历史' : '留空表示长期有效（直到新增更晚生效的一行）'}
            rules={[
              // Mirrors the server check: effectiveTo must be after effectiveFrom.
              // On edit, effectiveFrom is immutable, so compare against the row.
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
            <Form.Item name="isActive" label="启用" valuePropName="checked" extra="停用后账单不再解析此行；历史账单不受影响">
              <Switch />
            </Form.Item>
          )}
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} placeholder="例如：2025-04-01 起由 15% 降至 14%" />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default TaxRateManage;
