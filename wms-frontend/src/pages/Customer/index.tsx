import React, { useRef } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Button, Dropdown, message } from 'antd';
import { PlusOutlined, MoreOutlined } from '@ant-design/icons';
import request from '../../utils/request';

// Types definition based on PRD
interface CustomerItem {
  id: string;
  customerCode: string;
  name: string;
  contactName: string;
  phone: string;
  level: 'NORMAL' | 'VIP' | 'VVIP';
  status: 'ACTIVE' | 'INACTIVE';
  creditLimit: number;
  balance: number;
  createdAt: string;
}

const CustomerList: React.FC = () => {
  const actionRef = useRef<ActionType>(null);

  const fetchCustomers = async (params: any) => {
    const page = params.current || 1;
    const pageSize = params.pageSize || 10;

    const res: any = await request.get('/customers', {
      params: {
        page,
        pageSize,
        keyword: params.name || params.customerCode || params.phone || undefined,
        status: params.status || undefined,
      },
    });

    return {
      data: (res?.data || []) as CustomerItem[],
      success: true,
      total: res?.pagination?.total || 0,
    };
  };

  const columns: ProColumns<CustomerItem>[] = [
    {
      title: '客户代码',
      dataIndex: 'customerCode',
      copyable: true,
      width: 120,
    },
    {
      title: '客户名称',
      dataIndex: 'name',
      ellipsis: true,
      formItemProps: {
        rules: [{ required: true, message: '请输入客户名称' }],
      },
    },
    {
      title: '联系人',
      dataIndex: 'contactName',
      width: 120,
      search: false,
    },
    {
      title: '联系电话',
      dataIndex: 'phone',
      width: 150,
    },
    {
      title: '等级',
      dataIndex: 'level',
      width: 100,
      valueEnum: {
        NORMAL: { text: '普通', status: 'Default' },
        VIP: { text: 'VIP', status: 'Processing' },
        VVIP: { text: 'VVIP', status: 'Success' },
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueEnum: {
        ACTIVE: { text: '正常', status: 'Success' },
        INACTIVE: { text: '停用', status: 'Error' },
      },
    },
    {
      title: '账户余额',
      dataIndex: 'balance',
      width: 150,
      search: false,
      valueType: 'money',
      render: (_, record) => (
        <span className={record.balance < 0 ? 'text-error font-medium' : 'text-success font-medium'}>
          ¥ {record.balance.toFixed(2)}
        </span>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 150,
      render: (_, record) => [
        <a key="edit" className="text-primary hover:text-primary-light">编辑</a>,
        <a key="view" className="text-secondary hover:text-blue-400">详情</a>,
        <Dropdown
          key="more"
          menu={{
            items: [
              { key: 'recharge', label: '账户充值' },
              { key: 'limit', label: '调整额度' },
              { type: 'divider' },
              { 
                key: 'disable', 
                label: <span className="text-error">停用客户</span>,
                disabled: record.status === 'INACTIVE'
              },
            ]
          }}
        >
          <a onClick={e => e.preventDefault()} className="text-text-muted hover:text-text-primary">
            <MoreOutlined />
          </a>
        </Dropdown>,
      ],
    },
  ];

  return (
    <PageContainer 
      header={{
        title: '客户列表',
        subTitle: '管理所有的客户档案、信用额度和账户状态',
      }}
    >
      <ProTable<CustomerItem>
        columns={columns}
        actionRef={actionRef}
        cardBordered
        request={fetchCustomers}
        rowKey="id"
        search={{
          labelWidth: 'auto',
          collapsed: false,
        }}
        options={{
          setting: {
            listsHeight: 400,
          },
        }}
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
        }}
        dateFormatter="string"
        headerTitle="客户信息"
        toolBarRender={() => [
          <Button key="button" icon={<PlusOutlined />} type="primary" onClick={() => message.info('打开新增抽屉')}>
            新增客户
          </Button>,
        ]}
      />
    </PageContainer>
  );
};

export default CustomerList;
