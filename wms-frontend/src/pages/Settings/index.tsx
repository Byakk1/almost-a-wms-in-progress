import React, { useState } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import {
  Card, Row, Col, Table, Button, Tag, Modal, Form, Input,
  Select, Space, Popconfirm, message, Tabs, Divider
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, GlobalOutlined,
  TagsOutlined, BankOutlined, SettingOutlined
} from '@ant-design/icons';

const { Option } = Select;

interface DictItem {
  id: string;
  code: string;
  label: string;
  value: string;
  sort: number;
  enabled: boolean;
}

interface CountryItem {
  id: string;
  code: string;
  name: string;
  currency: string;
  enabled: boolean;
}

interface CurrencyItem {
  id: string;
  code: string;
  name: string;
  symbol: string;
  rate: number;
}

const MOCK_COUNTRIES: CountryItem[] = [
  { id: '1', code: 'US', name: '美国', currency: 'USD', enabled: true },
  { id: '2', code: 'UK', name: '英国', currency: 'GBP', enabled: true },
  { id: '3', code: 'DE', name: '德国', currency: 'EUR', enabled: true },
  { id: '4', code: 'AU', name: '澳大利亚', currency: 'AUD', enabled: true },
  { id: '5', code: 'JP', name: '日本', currency: 'JPY', enabled: false },
];

const MOCK_CURRENCIES: CurrencyItem[] = [
  { id: '1', code: 'USD', name: '美元', symbol: '$', rate: 1.000 },
  { id: '2', code: 'GBP', name: '英镑', symbol: '£', rate: 1.267 },
  { id: '3', code: 'EUR', name: '欧元', symbol: '€', rate: 1.085 },
  { id: '4', code: 'AUD', name: '澳大利亚元', symbol: 'A$', rate: 0.643 },
  { id: '5', code: 'CNY', name: '人民币', symbol: '¥', rate: 0.138 },
  { id: '6', code: 'JPY', name: '日元', symbol: '¥', rate: 0.0065 },
];

const MOCK_DICTS: Record<string, DictItem[]> = {
  courier_type: [
    { id: '1', code: 'FEDEX', label: 'FedEx 国际快递', value: 'FedEx', sort: 1, enabled: true },
    { id: '2', code: 'DHL', label: 'DHL Express', value: 'DHL', sort: 2, enabled: true },
    { id: '3', code: 'UPS', label: 'UPS 标准', value: 'UPS', sort: 3, enabled: true },
    { id: '4', code: 'EMS', label: 'EMS 国际小包', value: 'EMS', sort: 4, enabled: true },
  ],
  package_type: [
    { id: '5', code: 'S', label: '小箱 30×20×15cm', value: 'S', sort: 1, enabled: true },
    { id: '6', code: 'M', label: '中箱 40×30×25cm', value: 'M', sort: 2, enabled: true },
    { id: '7', code: 'L', label: '大箱 60×40×35cm', value: 'L', sort: 3, enabled: true },
    { id: '8', code: 'XL', label: '特大箱 80×60×50cm', value: 'XL', sort: 4, enabled: true },
  ],
};

function CRUDTable<T extends { id: string }>({
  columns, dataSource, onAdd, onDelete, addLabel,
}: {
  columns: any[];
  dataSource: T[];
  onAdd: () => void;
  onDelete: (id: string) => void;
  addLabel: string;
}) {
  const cols = [
    ...columns,
    {
      title: '操作',
      width: 120,
      render: (_: any, r: T) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} />
          <Popconfirm title="确认删除?" onConfirm={() => onDelete(r.id)} okText="删除" okButtonProps={{ danger: true }}>
            <Button size="small" icon={<DeleteOutlined />} danger />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button type="primary" icon={<PlusOutlined />} onClick={onAdd} style={{ backgroundColor: '#D23148' }}>
          {addLabel}
        </Button>
      </div>
      <Table columns={cols} dataSource={dataSource} rowKey="id" size="small" pagination={{ pageSize: 10 }} />
    </>
  );
}

const SystemSettings: React.FC = () => {
  const [countries, setCountries] = useState(MOCK_COUNTRIES);
  const [currencies] = useState(MOCK_CURRENCIES);
  const [dicts] = useState(MOCK_DICTS);
  const [dictKey, setDictKey] = useState('courier_type');
  const [addModal, setAddModal] = useState<string | null>(null);
  const [form] = Form.useForm();

  const handleDelete = (type: string, id: string) => {
    if (type === 'country') setCountries((prev) => prev.filter((c) => c.id !== id));
    message.success('删除成功');
  };

  const countryColumns = [
    { title: '国家代码', dataIndex: 'code', width: 90, render: (v: string) => <Tag>{v}</Tag> },
    { title: '国家名称', dataIndex: 'name', width: 120 },
    { title: '默认货币', dataIndex: 'currency', width: 100 },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 80,
      render: (v: boolean) => <Tag color={v ? 'success' : 'default'}>{v ? '启用' : '停用'}</Tag>,
    },
  ];

  const currencyColumns = [
    { title: '货币代码', dataIndex: 'code', width: 90, render: (v: string) => <Tag color="gold">{v}</Tag> },
    { title: '货币名称', dataIndex: 'name', width: 120 },
    { title: '符号', dataIndex: 'symbol', width: 70 },
    { title: '对USD汇率', dataIndex: 'rate', width: 110, render: (v: number) => v.toFixed(4) },
  ];

  const dictColumns = [
    { title: '编码', dataIndex: 'code', width: 100 },
    { title: '显示名称', dataIndex: 'label', ellipsis: true },
    { title: '值', dataIndex: 'value', width: 80 },
    { title: '排序', dataIndex: 'sort', width: 60 },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 80,
      render: (v: boolean) => <Tag color={v ? 'success' : 'default'}>{v ? '启用' : '停用'}</Tag>,
    },
  ];

  return (
    <PageContainer
      header={{
        title: '系统配置管理',
        subTitle: '维护国家、货币、数据字典等基础配置数据',
      }}
    >
      <Tabs
        defaultActiveKey="countries"
        type="card"
        items={[
          {
            key: 'countries',
            label: <Space><GlobalOutlined />国家配置</Space>,
            children: (
              <Card className="shadow-sm">
                <CRUDTable
                  columns={countryColumns}
                  dataSource={countries}
                  onAdd={() => setAddModal('country')}
                  onDelete={(id) => handleDelete('country', id)}
                  addLabel="新增国家"
                />
              </Card>
            ),
          },
          {
            key: 'currencies',
            label: <Space><BankOutlined />货币配置</Space>,
            children: (
              <Card className="shadow-sm">
                <CRUDTable
                  columns={currencyColumns}
                  dataSource={currencies}
                  onAdd={() => setAddModal('currency')}
                  onDelete={(id) => handleDelete('currency', id)}
                  addLabel="新增货币"
                />
              </Card>
            ),
          },
          {
            key: 'dicts',
            label: <Space><TagsOutlined />数据字典</Space>,
            children: (
              <Card className="shadow-sm">
                <Row className="mb-4" align="middle">
                  <Col>
                    <span className="mr-2 font-medium text-slate-600">字典类型：</span>
                    <Select value={dictKey} onChange={setDictKey} style={{ width: 180 }}>
                      <Option value="courier_type">物流渠道</Option>
                      <Option value="package_type">包材类型</Option>
                    </Select>
                  </Col>
                </Row>
                <Divider className="my-2" />
                <CRUDTable
                  columns={dictColumns}
                  dataSource={dicts[dictKey] || []}
                  onAdd={() => setAddModal('dict')}
                  onDelete={(id) => message.success(`删除 ${id}`)}
                  addLabel="新增字典项"
                />
              </Card>
            ),
          },
          {
            key: 'warehouse',
            label: <Space><SettingOutlined />仓库配置</Space>,
            children: (
              <Card className="shadow-sm">
                <div className="py-8 text-center text-slate-400">
                  <SettingOutlined style={{ fontSize: 40, opacity: 0.3 }} />
                  <p className="mt-3">仓库基础配置（待后端接口对接后开放）</p>
                  <Button type="primary" style={{ backgroundColor: '#D23148', marginTop: 16 }} disabled>
                    配置仓库信息
                  </Button>
                </div>
              </Card>
            ),
          },
        ]}
      />

      {/* Shared Add Modal */}
      <Modal
        title={`新增${addModal === 'country' ? '国家' : addModal === 'currency' ? '货币' : '字典项'}`}
        open={!!addModal}
        onOk={() => { form.resetFields(); setAddModal(null); message.success('保存成功'); }}
        onCancel={() => { form.resetFields(); setAddModal(null); }}
        okText="保存"
        okButtonProps={{ style: { backgroundColor: '#D23148' } }}
      >
        <Form form={form} layout="vertical" className="mt-4">
          <Form.Item label="代码" name="code" rules={[{ required: true }]}>
            <Input placeholder="例：US / USD / FEDEX" />
          </Form.Item>
          <Form.Item label="名称" name="name" rules={[{ required: true }]}>
            <Input placeholder="名称" />
          </Form.Item>
          {addModal === 'country' && (
            <Form.Item label="默认货币代码" name="currency">
              <Input placeholder="例：USD" />
            </Form.Item>
          )}
          {addModal === 'currency' && (
            <>
              <Form.Item label="货币符号" name="symbol"><Input placeholder="$" /></Form.Item>
              <Form.Item label="对 USD 汇率" name="rate"><Input type="number" placeholder="1.000" /></Form.Item>
            </>
          )}
          <Form.Item label="状态" name="enabled" initialValue="true">
            <Select>
              <Option value="true">启用</Option>
              <Option value="false">停用</Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default SystemSettings;
