import React, { useRef } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Tag, Space, Button, message } from 'antd';
import { CheckOutlined, ExportOutlined } from '@ant-design/icons';

interface ClaimItem {
  id: string;
  claimNo: string;
  barcode: string;
  description: string;
  qty: number;
  arrivalDate: string;
  claimType: 'UNCLAIMED' | 'RETURN';
  status: 'PENDING' | 'CLAIMED' | 'RETURNED';
  customerName?: string;
}

const ClaimManage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const fetchClaims = async (_p: any, _s: any, _f: any) => {
    await new Promise((r) => setTimeout(r, 600));
    const data: ClaimItem[] = [
      { id: '1', claimNo: 'CLM-260304-001', barcode: 'SF000999001', description: '无标签箱子，内含手机壳类商品约50件', qty: 50, arrivalDate: '2026-03-02', claimType: 'UNCLAIMED', status: 'PENDING' },
      { id: '2', claimNo: 'CLM-260303-002', barcode: 'JD888777002', description: 'iPad 保护套 × 20，无客户信息', qty: 20, arrivalDate: '2026-03-01', claimType: 'UNCLAIMED', status: 'PENDING' },
      { id: '3', claimNo: 'RTN-260302-001', barcode: 'YT556677889', description: '客户退回，充电线，原因：买家取消', qty: 5, arrivalDate: '2026-03-02', claimType: 'RETURN', status: 'PENDING' },
      { id: '4', claimNo: 'CLM-260228-001', barcode: 'SF000111333', description: '手机支架散件', qty: 12, arrivalDate: '2026-02-28', claimType: 'UNCLAIMED', status: 'CLAIMED', customerName: '深圳大卖贸易' },
      { id: '5', claimNo: 'RTN-260225-002', barcode: 'EMS999888444', description: '退件，地址错误，iPad Pro 硅胶套', qty: 2, arrivalDate: '2026-02-25', claimType: 'RETURN', status: 'RETURNED' },
    ];
    return { data, success: true, total: data.length };
  };

  const columns: ProColumns<ClaimItem>[] = [
    { title: '认领编号', dataIndex: 'claimNo', copyable: true, width: 160 },
    { title: '货物条码', dataIndex: 'barcode', width: 130, copyable: true },
    { title: '货物描述', dataIndex: 'description', ellipsis: true },
    { title: '件数', dataIndex: 'qty', width: 70, search: false },
    {
      title: '类型', dataIndex: 'claimType', width: 100,
      render: (v) => <Tag color={v === 'RETURN' ? 'orange' : 'blue'}>{v === 'RETURN' ? '退件' : '无主货'}</Tag>,
    },
    { title: '到仓日期', dataIndex: 'arrivalDate', width: 110, search: false },
    {
      title: '已认领客户', dataIndex: 'customerName', width: 140,
      render: (v) => v ?? <span className="text-gray-400">待认领</span>,
    },
    {
      title: '状态', dataIndex: 'status', width: 100,
      valueEnum: {
        PENDING: { text: '待处理', status: 'Warning' },
        CLAIMED: { text: '已认领', status: 'Success' },
        RETURNED: { text: '已退回', status: 'Default' },
      },
    },
    {
      title: '操作', valueType: 'option', width: 130,
      render: (_, record) => [
        record.status === 'PENDING' && (
          <a key="claim" className="text-primary" onClick={() => message.success(`已认领 ${record.claimNo}（Mock）`)}>
            <CheckOutlined className="mr-1" />认领
          </a>
        ),
        record.status === 'PENDING' && record.claimType === 'RETURN' && (
          <a key="return" className="text-orange-500" onClick={() => message.success('已标记退回（Mock）')}>
            退回处理
          </a>
        ),
      ],
    },
  ];

  return (
    <PageContainer header={{ title: '认领管理', subTitle: '处理无主货物认领及客户退件' }}>
      <ProTable<ClaimItem>
        columns={columns} actionRef={actionRef} cardBordered request={fetchClaims}
        rowKey="id" search={{ labelWidth: 'auto', collapsed: false }} pagination={{ pageSize: 10 }}
        headerTitle={<Space><span>待认领列表</span></Space>}
        toolBarRender={() => [<Button key="export" icon={<ExportOutlined />}>导出</Button>]}
        rowClassName={(r) => r.status === 'PENDING' ? 'bg-orange-50' : ''}
      />
    </PageContainer>
  );
};

export default ClaimManage;
