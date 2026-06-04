import React, { useRef } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Button, Space, Statistic, Row, Col, Card } from 'antd';
import { PlusOutlined, ExportOutlined, EyeOutlined, PrinterOutlined, SendOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

interface ShipmentOrder {
  id: string;
  shipmentNo: string;
  courier: string;
  totalOrders: number;
  totalWeight: number;
  status: 'DRAFT' | 'READY' | 'SIGNED_OUT' | 'IN_TRANSIT';
  createdAt: string;
  createdBy: string;
}

const ShipmentMain: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const navigate = useNavigate();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const fetchShipments = async (_p: any, _s: any, _f: any) => {
    await new Promise((r) => setTimeout(r, 600));
    const data: ShipmentOrder[] = [
      { id: '1', shipmentNo: 'SH-260304-001', courier: 'SF Express', totalOrders: 32, totalWeight: 28.5, status: 'READY', createdAt: '2026-03-04 08:00', createdBy: '张操作员' },
      { id: '2', shipmentNo: 'SH-260304-002', courier: 'DHL', totalOrders: 15, totalWeight: 12.0, status: 'DRAFT', createdAt: '2026-03-04 10:30', createdBy: '李操作员' },
      { id: '3', shipmentNo: 'SH-260303-001', courier: 'FedEx', totalOrders: 48, totalWeight: 62.3, status: 'SIGNED_OUT', createdAt: '2026-03-03 09:00', createdBy: '张操作员' },
      { id: '4', shipmentNo: 'SH-260303-002', courier: 'UPS', totalOrders: 22, totalWeight: 18.8, status: 'IN_TRANSIT', createdAt: '2026-03-03 14:00', createdBy: '王主管' },
    ];
    return { data, success: true, total: data.length };
  };

  const columns: ProColumns<ShipmentOrder>[] = [
    { title: '总单号', dataIndex: 'shipmentNo', copyable: true, width: 160, render: (v) => <span className="font-mono text-sm">{v as string}</span> },
    { title: '物流渠道', dataIndex: 'courier', width: 120 },
    { title: '订单数', dataIndex: 'totalOrders', width: 80, search: false },
    { title: '总重量(kg)', dataIndex: 'totalWeight', width: 100, search: false, render: (v) => `${v} kg` },
    {
      title: '状态', dataIndex: 'status', width: 100,
      valueEnum: {
        DRAFT: { text: '草稿', status: 'Default' },
        READY: { text: '待签出', status: 'Warning' },
        SIGNED_OUT: { text: '已签出', status: 'Success' },
        IN_TRANSIT: { text: '运输中', status: 'Processing' },
      },
    },
    { title: '创建时间', dataIndex: 'createdAt', width: 150, search: false },
    { title: '操作员', dataIndex: 'createdBy', width: 100, search: false },
    {
      title: '操作', valueType: 'option', width: 180,
      render: (_, record) => [
        <a key="view"><EyeOutlined className="mr-1" />详情</a>,
        <a key="print"><PrinterOutlined className="mr-1" />Scan Form</a>,
        record.status === 'READY' && (
          <a key="signout" className="text-green-600" onClick={() => navigate('/outbound/signout')}>
            <SendOutlined className="mr-1" />签出
          </a>
        ),
      ],
    },
  ];

  return (
    <PageContainer header={{ title: '出货总单管理', subTitle: '按物流渠道汇总订单，执行批量签出操作' }}>
      <Row gutter={16} className="mb-4">
        {[
          { label: '今日待签出', value: 1, color: '#f97316' },
          { label: '今日已签出', value: 2, color: '#10b981' },
          { label: '今日总订单数', value: 47, color: '#D23148' },
          { label: '今日总重量', value: '40.5 kg', color: '#1e293b' },
        ].map((s) => (
          <Col key={s.label} span={6}>
            <Card size="small" className="shadow-sm text-center">
              <Statistic title={s.label} value={s.value} valueStyle={{ color: s.color, fontSize: 22 }} />
            </Card>
          </Col>
        ))}
      </Row>
      <ProTable<ShipmentOrder>
        columns={columns} actionRef={actionRef} cardBordered request={fetchShipments}
        rowKey="id" scroll={{ x: 1100 }} search={{ labelWidth: 'auto', collapsed: false }}
        pagination={{ pageSize: 10 }}
        headerTitle={<Space><SendOutlined style={{ color: '#D23148' }} /><span>出货总单</span></Space>}
        toolBarRender={() => [
          <Button key="export" icon={<ExportOutlined />}>导出</Button>,
          <Button key="add" type="primary" icon={<PlusOutlined />} style={{ backgroundColor: '#D23148' }}>新建总单</Button>,
        ]}
      />
    </PageContainer>
  );
};

export default ShipmentMain;
