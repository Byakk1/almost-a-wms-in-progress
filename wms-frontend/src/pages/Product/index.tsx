import React, { useEffect, useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  Button, Tag, Modal, Form, Input,
  Select, InputNumber, Upload, message, Drawer, Descriptions, Switch,
  Tabs, Row, Col, Divider,
} from 'antd';
import {
  PlusOutlined, ExportOutlined, EditOutlined,
  EyeOutlined, ImportOutlined,
} from '@ant-design/icons';
import request from '../../utils/request';

const { Option } = Select;

interface Battery {
  batteryType?: string;
  cellOrPack?: string;
  batteryModel?: string;
  quantity?: number;
  weightGrams?: number;
  capacityMah?: number;
  voltageV?: number;
  lithiumContentG?: number;
  packageMaterial?: string;
  packaging?: string;
  chargeStatus?: string;
  otherDesc?: string;
  carryingLabel?: string;
  unCode?: string;
  msdsFileList?: string;
}

interface Product {
  id: string;
  sku: string;
  name: string;
  nameZh?: string;
  nameEn?: string;
  customerId: string;
  customerName?: string;
  barcode?: string;
  // dimensions
  unit?: string;
  weight?: number;
  weightUnit?: string;
  length?: number;
  width?: number;
  height?: number;
  dimensionUnit?: string;
  // trade
  hsCode?: string;
  originCountry?: string;
  declaredValue?: number;
  actualValue?: number;
  currency?: string;
  material?: string;
  usage?: string;
  // supply
  brand?: string;
  supplier?: string;
  model?: string;
  itemType?: string;
  hasShippingBag?: boolean;
  packagingAttr?: string;
  salesUrl?: string;
  catalogue?: string;
  warehouseCodes?: string;
  remark?: string;
  // regulatory
  batteryConfig?: string;
  otherAttrs?: string;
  isHazardous?: boolean;
  hazardCode?: string;
  prop65?: boolean;
  isFood?: boolean;
  isRefrigerated?: boolean;
  hasSerialNumber?: boolean;
  isLotControlled?: boolean;
  battery?: Battery | null;
  createdAt: string;
}

interface DictItem {
  id: string;
  category: string;
  code: string;
  label: string;
  labelEn?: string;
}

const DICT_CATEGORIES = [
  'BATTERY_CONFIG', 'BATTERY_TYPE', 'CELL_OR_PACK', 'CHARGE_STATUS',
  'PACKAGE_MATERIAL', 'PACKAGING', 'CARRYING_LABEL', 'ITEM_TYPE',
  'CATALOGUE', 'OTHER_ATTRS', 'WEIGHT_UNIT', 'DIMENSION_UNIT', 'CURRENCY',
];

const BATTERY_PRESENT_LABELS = ['内置电池', '配套电池', '纯电池'];

const ProductManage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [editModal, setEditModal] = useState<{ open: boolean; mode: 'create' | 'edit'; row?: Product }>({ open: false, mode: 'create' });
  const [detailDrawer, setDetailDrawer] = useState<Product | null>(null);
  const [importModal, setImportModal] = useState<{ open: boolean; customerId?: string }>({ open: false });
  const [form] = Form.useForm();
  const [dicts, setDicts] = useState<Record<string, DictItem[]>>({});
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);

  const watchBatteryConfig = Form.useWatch('batteryConfig', form);
  const watchBatteryType = Form.useWatch(['battery', 'batteryType'], form);
  const watchHazardous = Form.useWatch('isHazardous', form);
  const batteryPresent = !!watchBatteryConfig && BATTERY_PRESENT_LABELS.includes(watchBatteryConfig);

  // load dictionaries + customers once
  useEffect(() => {
    Promise.all(
      DICT_CATEGORIES.map((c) =>
        request.get(`/dictionaries/by-category/${c}`).then((r: any) => [c, r?.data || []] as const).catch(() => [c, []] as const),
      ),
    ).then((entries) => {
      const map: Record<string, DictItem[]> = {};
      entries.forEach(([k, v]) => { map[k] = v as DictItem[]; });
      setDicts(map);
    });

    request.get('/customers', { params: { pageSize: 200 } }).then((r: any) => {
      setCustomers(r?.data || []);
    }).catch(() => undefined);
  }, []);

  const dictOptions = (cat: string) =>
    (dicts[cat] || []).map((d) => <Option key={d.code} value={d.label}>{d.label}</Option>);

  const fetchProducts = async (params: any) => {
    const res: any = await request.get('/products', {
      params: {
        page: params.current || 1,
        pageSize: params.pageSize || 10,
        sku: params.sku || undefined,
        name: params.name || undefined,
        customerId: params.customerId || undefined,
      },
    });
    return {
      data: (res?.data || []) as Product[],
      success: true,
      total: res?.pagination?.total || 0,
    };
  };

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({
      weightUnit: 'KG', dimensionUnit: 'CM', currency: 'USD',
      hasShippingBag: false, isHazardous: false, prop65: false,
      isFood: false, isRefrigerated: false, hasSerialNumber: false, isLotControlled: false,
    });
    setEditModal({ open: true, mode: 'create' });
  };

  const openEdit = (row: Product) => {
    form.resetFields();
    form.setFieldsValue(row);
    setEditModal({ open: true, mode: 'edit', row });
  };

  const handleSave = () => {
    form.validateFields().then(async (values) => {
      try {
        if (editModal.mode === 'create') {
          await request.post('/products', values);
          message.success('产品已创建');
        } else if (editModal.row) {
          await request.put(`/products/${editModal.row.id}`, values);
          message.success('产品已更新');
        }
        setEditModal({ open: false, mode: 'create' });
        actionRef.current?.reload();
      } catch (err: any) {
        message.error(err?.response?.data?.message || '保存失败');
      }
    });
  };

  const columns: ProColumns<Product>[] = [
    { title: 'SKU', dataIndex: 'sku', copyable: true, width: 130, render: (v) => <code className="text-xs bg-slate-100 px-1 rounded">{v as string}</code> },
    { title: '中文名称', dataIndex: 'nameZh', ellipsis: true, search: false },
    { title: '英文名称', dataIndex: 'nameEn', ellipsis: true, search: false },
    { title: '产品名称', dataIndex: 'name', ellipsis: true, hideInTable: true },
    { title: '客户', dataIndex: 'customerName', width: 130, search: false },
    { title: 'HS Code', dataIndex: 'hsCode', width: 110, search: false },
    {
      title: '尺寸',
      dataIndex: 'length',
      width: 130,
      search: false,
      render: (_, r) => r.length ? `${r.length}×${r.width}×${r.height} ${r.dimensionUnit || ''}` : '-',
    },
    {
      title: '重量',
      dataIndex: 'weight',
      width: 100,
      search: false,
      render: (_, r) => r.weight ? `${r.weight} ${r.weightUnit || ''}` : '-',
    },
    {
      title: '电池',
      dataIndex: 'batteryConfig',
      width: 100,
      search: false,
      render: (v) => v ? <Tag color={v === '不含电池' ? 'default' : 'orange'}>{v as string}</Tag> : '-',
    },
    {
      title: '危险品',
      dataIndex: 'isHazardous',
      width: 80,
      search: false,
      render: (v) => v ? <Tag color="red">是</Tag> : '-',
    },
    { title: '创建日期', dataIndex: 'createdAt', width: 160, search: false },
    {
      title: '操作', valueType: 'option', width: 130, fixed: 'right',
      render: (_, record) => [
        <a key="view" onClick={() => setDetailDrawer(record)}><EyeOutlined /> 详情</a>,
        <a key="edit" onClick={() => openEdit(record)}><EditOutlined /> 编辑</a>,
      ],
    },
  ];

  return (
    <PageContainer header={{ title: '产品管理', subTitle: '海外仓商品库（按 海外仓商品库上传模板V2 维护 52 个字段）' }}>
      <ProTable<Product>
        columns={columns}
        actionRef={actionRef}
        cardBordered
        request={fetchProducts}
        rowKey="id"
        scroll={{ x: 1400 }}
        search={{ labelWidth: 'auto', collapsed: false }}
        pagination={{ pageSize: 10 }}
        headerTitle="产品列表"
        toolBarRender={() => [
          <Button key="import" icon={<ImportOutlined />} onClick={() => setImportModal({ open: true })}>批量导入 (xlsx)</Button>,
          <Button key="export" icon={<ExportOutlined />}>导出</Button>,
          <Button key="add" type="primary" icon={<PlusOutlined />} style={{ backgroundColor: '#D23148' }} onClick={openCreate}>新建产品</Button>,
        ]}
      />

      {/* Create / Edit Modal */}
      <Modal
        title={editModal.mode === 'create' ? '新建产品' : `编辑产品 — ${editModal.row?.sku}`}
        open={editModal.open}
        onOk={handleSave}
        onCancel={() => setEditModal({ open: false, mode: 'create' })}
        okText="保存"
        okButtonProps={{ style: { backgroundColor: '#D23148' } }}
        width={960}
        destroyOnClose
      >
        <Form form={form} layout="vertical" className="mt-2">
          <Tabs
            items={[
              {
                key: 'basic',
                label: '基本信息',
                children: (
                  <Row gutter={16}>
                    <Col span={8}>
                      <Form.Item label="SKU 编码" name="sku" rules={[{ required: true, max: 30 }]}>
                        <Input placeholder="例：SKU-F006" maxLength={30} />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item label="条形码编号" name="barcode" rules={[{ max: 50 }]}>
                        <Input maxLength={50} />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item label="所属客户" name="customerId" rules={[{ required: true }]}>
                        <Select placeholder="选择客户" showSearch optionFilterProp="children">
                          {customers.map((c) => <Option key={c.id} value={c.id}>{c.name}</Option>)}
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label="品名(中文)" name="nameZh" rules={[{ required: true, max: 255 }]}>
                        <Input maxLength={255} />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label="品名(英文)" name="nameEn" rules={[{ required: true, max: 255 }]}>
                        <Input maxLength={255} />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item label="原产国(二字码)" name="originCountry" rules={[{ pattern: /^[A-Za-z]{2,3}$/, message: '2-3 位字母' }]}>
                        <Input placeholder="CN / US" maxLength={3} />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item label="HS Code" name="hsCode" rules={[{ required: true, max: 20 }]}>
                        <Input maxLength={20} />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item label="单位" name="unit" rules={[{ max: 20 }]}>
                        <Input placeholder="pcs" maxLength={20} />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item label="品牌" name="brand" rules={[{ max: 50 }]}>
                        <Input maxLength={50} />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item label="供应商" name="supplier" rules={[{ max: 20 }]}>
                        <Input maxLength={20} />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item label="型号" name="model" rules={[{ max: 128 }]}>
                        <Input maxLength={128} />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item label="组合类型" name="itemType">
                        <Select allowClear>{dictOptions('ITEM_TYPE')}</Select>
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item label="目录" name="catalogue">
                        <Select allowClear>{dictOptions('CATALOGUE')}</Select>
                      </Form.Item>
                    </Col>
                    <Col span={24}>
                      <Form.Item label="商品链接" name="salesUrl" rules={[{ max: 4000 }]}>
                        <Input maxLength={4000} />
                      </Form.Item>
                    </Col>
                    <Col span={24}>
                      <Form.Item label="关联海外仓仓库代码 (逗号分隔)" name="warehouseCodes" rules={[{ max: 255 }]}>
                        <Input placeholder="WH-CA-LA, WH-UK-LON" maxLength={255} />
                      </Form.Item>
                    </Col>
                    <Col span={24}>
                      <Form.Item label="备注" name="remark" rules={[{ max: 255 }]}>
                        <Input.TextArea maxLength={255} rows={2} />
                      </Form.Item>
                    </Col>
                  </Row>
                ),
              },
              {
                key: 'dimensions',
                label: '尺寸/重量/申报',
                children: (
                  <Row gutter={16}>
                    <Col span={6}>
                      <Form.Item label="预估重量" name="weight" rules={[{ required: true }]}>
                        <InputNumber min={0} step={0.001} precision={3} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item label="重量单位" name="weightUnit" rules={[{ required: true }]}>
                        <Select>{dictOptions('WEIGHT_UNIT')}</Select>
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item label="预估长度" name="length" rules={[{ required: true }]}>
                        <InputNumber min={0} step={0.1} precision={1} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item label="尺寸单位" name="dimensionUnit" rules={[{ required: true }]}>
                        <Select>{dictOptions('DIMENSION_UNIT')}</Select>
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item label="预估宽度" name="width" rules={[{ required: true }]}>
                        <InputNumber min={0} step={0.1} precision={1} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item label="预估高度" name="height" rules={[{ required: true }]}>
                        <InputNumber min={0} step={0.1} precision={1} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item label="申报价值" name="declaredValue" rules={[{ required: true }]}>
                        <InputNumber min={0} step={0.01} precision={2} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item label="实际价值" name="actualValue">
                        <InputNumber min={0} step={0.01} precision={2} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item label="币种" name="currency" rules={[{ required: true }]}>
                        <Select>{dictOptions('CURRENCY')}</Select>
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item label="自带物流包装" name="hasShippingBag" valuePropName="checked"><Switch /></Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item label="物流包装属性" name="packagingAttr" rules={[{ max: 100 }]}>
                        <Input maxLength={100} />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label="材质" name="material" rules={[{ required: true, max: 100 }]}>
                        <Input maxLength={100} />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label="用途" name="usage" rules={[{ max: 50 }]}>
                        <Input maxLength={50} />
                      </Form.Item>
                    </Col>
                  </Row>
                ),
              },
              {
                key: 'regulatory',
                label: '合规属性',
                children: (
                  <Row gutter={16}>
                    <Col span={8}>
                      <Form.Item label="电池配置" name="batteryConfig" rules={[{ required: true }]}>
                        <Select>{dictOptions('BATTERY_CONFIG')}</Select>
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item label="其他属性" name="otherAttrs" rules={[{ required: true }]}>
                        <Select mode="multiple" allowClear placeholder="可多选">{dictOptions('OTHER_ATTRS')}</Select>
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item label="危险品" name="isHazardous" valuePropName="checked"><Switch /></Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item label="危险代码" name="hazardCode" rules={[{ required: !!watchHazardous, message: '危险品时必填' }]}>
                        <Input maxLength={20} disabled={!watchHazardous} />
                      </Form.Item>
                    </Col>
                    <Col span={4}><Form.Item label="Prop65" name="prop65" valuePropName="checked"><Switch /></Form.Item></Col>
                    <Col span={4}><Form.Item label="食品" name="isFood" valuePropName="checked"><Switch /></Form.Item></Col>
                    <Col span={4}><Form.Item label="冷藏" name="isRefrigerated" valuePropName="checked"><Switch /></Form.Item></Col>
                    <Col span={6}><Form.Item label="序列号管理" name="hasSerialNumber" valuePropName="checked"><Switch /></Form.Item></Col>
                    <Col span={6}><Form.Item label="批次管理" name="isLotControlled" valuePropName="checked"><Switch /></Form.Item></Col>
                  </Row>
                ),
              },
              {
                key: 'battery',
                label: `电池信息${batteryPresent ? ' *' : ''}`,
                disabled: !batteryPresent,
                children: (
                  <>
                    <Divider style={{ margin: '0 0 12px 0' }}>电池配置：{watchBatteryConfig || '-'}</Divider>
                    <Row gutter={16}>
                      <Col span={8}>
                        <Form.Item label="电池类型" name={['battery', 'batteryType']} rules={[{ required: batteryPresent }]}>
                          <Select>{dictOptions('BATTERY_TYPE')}</Select>
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item label="电池芯/电池组" name={['battery', 'cellOrPack']} rules={[{ required: batteryPresent }]}>
                          <Select>{dictOptions('CELL_OR_PACK')}</Select>
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item label="电池型号" name={['battery', 'batteryModel']} rules={[{ required: batteryPresent, max: 50 }]}>
                          <Input placeholder="GB-S04-733068" maxLength={50} />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item label="电池数量" name={['battery', 'quantity']}>
                          <InputNumber min={1} max={99999} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item label="单个电池重量(g)" name={['battery', 'weightGrams']} rules={[{ required: batteryPresent }]}>
                          <InputNumber min={0.01} max={99999.99} step={0.01} precision={2} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item label="安时额定值(mAh)" name={['battery', 'capacityMah']}>
                          <InputNumber min={0.01} max={99999.99} step={0.01} precision={2} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item label="额定电压(V)" name={['battery', 'voltageV']}>
                          <InputNumber min={0.01} max={99999.99} step={0.01} precision={2} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item label="锂含量(g)" name={['battery', 'lithiumContentG']} rules={[{ required: watchBatteryType === '锂电池(锂金属电池)' }]}>
                          <InputNumber min={0} step={0.01} precision={2} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item label="电池包装材质" name={['battery', 'packageMaterial']} rules={[{ required: batteryPresent }]}>
                          <Select>{dictOptions('PACKAGE_MATERIAL')}</Select>
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item label="电池包装" name={['battery', 'packaging']} rules={[{ required: batteryPresent }]}>
                          <Select>{dictOptions('PACKAGING')}</Select>
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item label="电池充电状态" name={['battery', 'chargeStatus']} rules={[{ required: batteryPresent }]}>
                          <Select>{dictOptions('CHARGE_STATUS')}</Select>
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item label="商品携带标签" name={['battery', 'carryingLabel']}>
                          <Select allowClear>{dictOptions('CARRYING_LABEL')}</Select>
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item label="UN编码" name={['battery', 'unCode']} rules={[{ required: batteryPresent, max: 20 }]}>
                          <Input placeholder="UN3480" maxLength={20} />
                        </Form.Item>
                      </Col>
                      <Col span={16}>
                        <Form.Item label="其他电池属性" name={['battery', 'otherDesc']}>
                          <Input maxLength={255} />
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Form.Item label="MSDS报告证书链接列表 (逗号分隔, 单条 ≤300 字符)" name={['battery', 'msdsFileList']}>
                          <Input.TextArea rows={2} />
                        </Form.Item>
                      </Col>
                    </Row>
                  </>
                ),
              },
            ]}
          />
        </Form>
      </Modal>

      {/* Bulk Import Modal */}
      <Modal
        title="批量导入产品 (海外仓商品库上传模板V2)"
        open={importModal.open}
        onCancel={() => setImportModal({ open: false })}
        footer={null}
      >
        <Form layout="vertical">
          <Form.Item label="目标客户" required>
            <Select
              placeholder="导入时所有产品归属此客户"
              value={importModal.customerId}
              onChange={(v) => setImportModal((s) => ({ ...s, customerId: v }))}
              showSearch
              optionFilterProp="children"
            >
              {customers.map((c) => <Option key={c.id} value={c.id}>{c.name}</Option>)}
            </Select>
          </Form.Item>
          <Upload
            accept=".xlsx,.xls"
            showUploadList={false}
            beforeUpload={async (file) => {
              if (!importModal.customerId) {
                message.warning('请先选择客户');
                return Upload.LIST_IGNORE;
              }
              const fd = new FormData();
              fd.append('file', file);
              fd.append('customerId', importModal.customerId);
              try {
                const res: any = await request.post('/products/bulk-import-excel', fd, {
                  headers: { 'Content-Type': 'multipart/form-data' },
                  timeout: 60000,
                });
                const { created, updated, errors } = res?.data || {};
                if (errors?.length) {
                  Modal.warning({
                    title: `导入完成（含 ${errors.length} 条错误）`,
                    content: (
                      <div>
                        <p>新增：{created}, 更新：{updated}</p>
                        <ul style={{ maxHeight: 240, overflow: 'auto', margin: 0, paddingLeft: 16 }}>
                          {errors.map((e: string, i: number) => <li key={i}>{e}</li>)}
                        </ul>
                      </div>
                    ),
                  });
                } else {
                  message.success(`导入成功：新增 ${created}, 更新 ${updated}`);
                }
                setImportModal({ open: false });
                actionRef.current?.reload();
              } catch (err: any) {
                message.error(err?.response?.data?.message || '导入失败');
              }
              return Upload.LIST_IGNORE;
            }}
          >
            <Button icon={<ImportOutlined />} type="primary" style={{ backgroundColor: '#D23148' }}>
              选择 .xlsx 文件并上传
            </Button>
          </Upload>
        </Form>
      </Modal>

      {/* Detail Drawer */}
      <Drawer
        title={`产品详情 — ${detailDrawer?.sku}`}
        open={!!detailDrawer}
        onClose={() => setDetailDrawer(null)}
        width={720}
      >
        {detailDrawer && (
          <>
            <Descriptions title="基本信息" column={2} size="small" bordered>
              <Descriptions.Item label="SKU"><code>{detailDrawer.sku}</code></Descriptions.Item>
              <Descriptions.Item label="条形码">{detailDrawer.barcode || '-'}</Descriptions.Item>
              <Descriptions.Item label="中文名" span={2}>{detailDrawer.nameZh || '-'}</Descriptions.Item>
              <Descriptions.Item label="英文名" span={2}>{detailDrawer.nameEn || '-'}</Descriptions.Item>
              <Descriptions.Item label="客户">{detailDrawer.customerName || '-'}</Descriptions.Item>
              <Descriptions.Item label="HS Code">{detailDrawer.hsCode || '-'}</Descriptions.Item>
              <Descriptions.Item label="原产国">{detailDrawer.originCountry || '-'}</Descriptions.Item>
              <Descriptions.Item label="单位">{detailDrawer.unit || '-'}</Descriptions.Item>
            </Descriptions>
            <Descriptions title="尺寸 / 申报" column={2} size="small" bordered className="mt-4">
              <Descriptions.Item label="尺寸">
                {detailDrawer.length ? `${detailDrawer.length}×${detailDrawer.width}×${detailDrawer.height} ${detailDrawer.dimensionUnit || ''}` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="重量">{detailDrawer.weight ? `${detailDrawer.weight} ${detailDrawer.weightUnit || ''}` : '-'}</Descriptions.Item>
              <Descriptions.Item label="申报价值">{detailDrawer.declaredValue ? `${detailDrawer.declaredValue} ${detailDrawer.currency || ''}` : '-'}</Descriptions.Item>
              <Descriptions.Item label="实际价值">{detailDrawer.actualValue ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="材质">{detailDrawer.material || '-'}</Descriptions.Item>
              <Descriptions.Item label="用途">{detailDrawer.usage || '-'}</Descriptions.Item>
            </Descriptions>
            <Descriptions title="合规" column={2} size="small" bordered className="mt-4">
              <Descriptions.Item label="电池配置">{detailDrawer.batteryConfig || '-'}</Descriptions.Item>
              <Descriptions.Item label="危险品">{detailDrawer.isHazardous ? `是 (${detailDrawer.hazardCode || ''})` : '否'}</Descriptions.Item>
              <Descriptions.Item label="Prop65">{detailDrawer.prop65 ? '是' : '否'}</Descriptions.Item>
              <Descriptions.Item label="食品/冷藏">
                {[detailDrawer.isFood && '食品', detailDrawer.isRefrigerated && '冷藏'].filter(Boolean).join(' / ') || '否'}
              </Descriptions.Item>
              <Descriptions.Item label="序列号">{detailDrawer.hasSerialNumber ? '是' : '否'}</Descriptions.Item>
              <Descriptions.Item label="批次管理">{detailDrawer.isLotControlled ? '是' : '否'}</Descriptions.Item>
            </Descriptions>
            {detailDrawer.battery && (
              <Descriptions title="电池信息" column={2} size="small" bordered className="mt-4">
                <Descriptions.Item label="电池类型">{detailDrawer.battery.batteryType || '-'}</Descriptions.Item>
                <Descriptions.Item label="芯/组">{detailDrawer.battery.cellOrPack || '-'}</Descriptions.Item>
                <Descriptions.Item label="型号">{detailDrawer.battery.batteryModel || '-'}</Descriptions.Item>
                <Descriptions.Item label="数量">{detailDrawer.battery.quantity ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="重量(g)">{detailDrawer.battery.weightGrams ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="mAh">{detailDrawer.battery.capacityMah ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="V">{detailDrawer.battery.voltageV ?? '-'}</Descriptions.Item>
                <Descriptions.Item label="UN">{detailDrawer.battery.unCode || '-'}</Descriptions.Item>
              </Descriptions>
            )}
          </>
        )}
      </Drawer>
    </PageContainer>
  );
};

export default ProductManage;
