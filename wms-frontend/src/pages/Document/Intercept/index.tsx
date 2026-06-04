import React, { useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Space, Button, Modal, Input, message } from 'antd';
import { ExportOutlined, StopOutlined, CheckCircleOutlined } from '@ant-design/icons';

interface InterceptItem {
  id: string;
  orderNo: string;
  trackingNo: string;
  customerName: string;
  reason: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  createdAt: string;
}

const InterceptManage: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [completeModal, setCompleteModal] = useState<InterceptItem | null>(null);
  const [remark, setRemark] = useState('');

  const [data, setData] = useState<InterceptItem[]>([
    { id: '1', orderNo: 'ORD-260305-001', trackingNo: 'SF999888001', customerName: '深圳大卖贸易', reason: '客户要求取消发货', status: 'PENDING', createdAt: '2026-03-05 09:15' },
    { id: '2', orderNo: 'ORD-260304-005', trackingNo: 'JD111222005', customerName: '跨境优品', reason: '地址填写错误，改派地址', status: 'PENDING', createdAt: '2026-03-05 10:00' },
    { id: '3', orderNo: 'ORD-260303-099', trackingNo: 'USP555666099', customerName: 'Global E-commerce', reason: '买家退款止发', status: 'SUCCESS', createdAt: '2026-03-04 14:00' },
    { id: '4', orderNo: 'ORD-260301-050', trackingNo: 'YT333444050', customerName: '欧洲专线', reason: '申报信息有误', status: 'FAILED', createdAt: '2026-03-02 08:30' },
  ]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const fetchIntercepts = async (_p: any) => {
    await new Promise((r) => setTimeout(r, 500));
    return { data, success: true, total: data.length };
  };

  const handleComplete = (success: boolean) => {
    setData((prev) => prev.map((item) =>
      item.id === completeModal!.id ? { ...item, status: success ? 'SUCCESS' : 'FAILED' } : item
    ));
    message.success(`已标记为拦截${success ? '成功' : '失败'}`);
    setCompleteModal(null);
    setRemark('');
  };

  const columns: ProColumns<InterceptItem>[] = [
    { title: '关联订单', dataIndex: 'orderNo', copyable: true, width: 160 },
    { title: '物流单号', dataIndex: 'trackingNo', copyable: true, width: 150 },
    { title: '客户名称', dataIndex: 'customerName', ellipsis: true },
    { title: '拦截原因', dataIndex: 'reason', ellipsis: true, search: false },
    {
      title: '状态', dataIndex: 'status', width: 100,
      valueEnum: {
        PENDING: { text: '处理中', status: 'Processing' },
        SUCCESS: { text: '拦截成功', status: 'Success' },
        FAILED: { text: '拦截失败', status: 'Error' },
      },
    },
    { title: '申请时间', dataIndex: 'createdAt', width: 150, search: false },
    {
      title: '操作', valueType: 'option', width: 110,
      render: (_, record) => record.status === 'PENDING' && [
        <a key="handle" className="text-primary" onClick={() => setCompleteModal(record)}>
          <CheckCircleOutlined className="mr-1" />完成拦截
        </a>,
      ],
    },
  ];

  return (
    <PageContainer header={{ title: '拦截管理', subTitle: '处理出库单止发、物流包裹召回等拦截请求' }}>
      <ProTable<InterceptItem>
        columns={columns} actionRef={actionRef} cardBordered request={fetchIntercepts}
        rowKey="id" search={{ labelWidth: 'auto', collapsed: false }} pagination={{ pageSize: 15 }}
        headerTitle={<Space><StopOutlined style={{ color: '#D23148' }} /><span>拦截请求列表</span></Space>}
        toolBarRender={() => [<Button key="export" icon={<ExportOutlined />}>导出记录</Button>]}
        rowClassName={(r) => r.status === 'PENDING' ? 'bg-orange-50' : ''}
      />

      <Modal
        title="标记拦截结果"
        open={!!completeModal}
        onCancel={() => { setCompleteModal(null); setRemark(''); }}
        footer={[
          <Button key="fail" danger onClick={() => handleComplete(false)}>拦截失败（已发出）</Button>,
          <Button key="succ" type="primary" style={{ backgroundColor: '#10b981' }} onClick={() => handleComplete(true)}>拦截成功（成功扣留）</Button>,
        ]}
      >
        <p className="mt-4">
          请确认订单 <strong>{completeModal?.orderNo}</strong> 的拦截操作结果。
          成功拦截的包裹将转入问题件/退件流程。
        </p>
        <Input.TextArea
          rows={3}
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="请输入处理备注（选填）"
          className="mt-4"
        />
      </Modal>
    </PageContainer>
  );
};

export default InterceptManage;
