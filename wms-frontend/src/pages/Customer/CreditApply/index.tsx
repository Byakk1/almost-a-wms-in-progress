import React, { useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ProColumns } from '@ant-design/pro-components';
import { Tag, Space, Modal, Form, Input, InputNumber, message, Descriptions } from 'antd';
import { CheckOutlined, CloseOutlined, EyeOutlined } from '@ant-design/icons';

interface CreditApply {
  id: string;
  applyNo: string;
  customerName: string;
  currentLimit: number;
  applyLimit: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  appliedAt: string;
  reviewedAt?: string;
  reviewer?: string;
  reviewRemark?: string;
}

const CreditApplyPage: React.FC = () => {
  const [reviewModal, setReviewModal] = useState<{ record: CreditApply; action: 'approve' | 'reject' } | null>(null);
  const [detailRecord, setDetailRecord] = useState<CreditApply | null>(null);
  const [form] = Form.useForm();
  const [data, setData] = useState<CreditApply[]>([
    { id: '1', applyNo: 'CA-260304-001', customerName: '深圳大卖贸易', currentLimit: 10000, applyLimit: 30000, reason: '业务量增加，需要提升额度以保证正常运营', status: 'PENDING', appliedAt: '2026-03-04 09:00' },
    { id: '2', applyNo: 'CA-260303-001', customerName: 'Global E-commerce', currentLimit: 5000, applyLimit: 20000, reason: '签约新合作，预计月出货量翻3倍', status: 'PENDING', appliedAt: '2026-03-03 14:00' },
    { id: '3', applyNo: 'CA-260228-002', customerName: '跨境优品', currentLimit: 8000, applyLimit: 15000, reason: '季节性旺季到来，库存备货需求大', status: 'APPROVED', appliedAt: '2026-02-28 10:00', reviewedAt: '2026-03-01 16:00', reviewer: '财务王', reviewRemark: '审核通过，追加至15000' },
    { id: '4', applyNo: 'CA-260220-001', customerName: '欧洲专线', currentLimit: 3000, applyLimit: 10000, reason: '扩大欧洲市场', status: 'REJECTED', appliedAt: '2026-02-20 11:00', reviewedAt: '2026-02-21 09:00', reviewer: '财务王', reviewRemark: '当前余额不足，暂不批准' },
  ]);

  const handleReview = (record: CreditApply, action: 'approve' | 'reject') => {
    setReviewModal({ record, action });
  };

  const handleConfirmReview = () => {
    const remark = form.getFieldValue('remark');
    setData((prev) => prev.map((r) =>
      r.id === reviewModal!.record.id
        ? { ...r, status: reviewModal!.action === 'approve' ? 'APPROVED' : 'REJECTED', reviewer: '当前用户', reviewedAt: new Date().toLocaleString('zh-CN'), reviewRemark: remark }
        : r
    ));
    message.success(reviewModal!.action === 'approve' ? '已批准额度申请' : '已驳回额度申请');
    setReviewModal(null);
    form.resetFields();
  };

  const columns: ProColumns<CreditApply>[] = [
    { title: '申请编号', dataIndex: 'applyNo', copyable: true, width: 160 },
    { title: '客户名称', dataIndex: 'customerName', ellipsis: true },
    { title: '当前额度', dataIndex: 'currentLimit', width: 110, search: false, render: (v) => `¥${(v as number).toLocaleString()}` },
    { title: '申请额度', dataIndex: 'applyLimit', width: 110, search: false, render: (v) => <span className="font-bold text-primary">¥{(v as number).toLocaleString()}</span> },
    {
      title: '申请增幅', dataIndex: 'applyLimit', key: 'increase', width: 100, search: false,
      render: (_, record) => {
        const pct = Math.round(((record.applyLimit - record.currentLimit) / record.currentLimit) * 100);
        return <Tag color="orange">+{pct}%</Tag>;
      },
    },
    { title: '申请原因', dataIndex: 'reason', ellipsis: true, search: false },
    {
      title: '状态', dataIndex: 'status', width: 100,
      valueEnum: { PENDING: { text: '待审核', status: 'Warning' }, APPROVED: { text: '已通过', status: 'Success' }, REJECTED: { text: '已驳回', status: 'Error' } },
    },
    { title: '申请时间', dataIndex: 'appliedAt', width: 150, search: false },
    {
      title: '操作', valueType: 'option', width: 170,
      render: (_, record) => [
        <a key="view" className="text-primary" onClick={() => setDetailRecord(record)}><EyeOutlined className="mr-1" />详情</a>,
        record.status === 'PENDING' && (
          <a key="approve" className="text-green-600" onClick={() => handleReview(record, 'approve')}>
            <CheckOutlined className="mr-1" />通过
          </a>
        ),
        record.status === 'PENDING' && (
          <a key="reject" className="text-red-500" onClick={() => handleReview(record, 'reject')}>
            <CloseOutlined className="mr-1" />驳回
          </a>
        ),
      ],
    },
  ];

  return (
    <PageContainer header={{ title: '额度申请管理', subTitle: '审核客户信用额度调整申请' }}>
      <ProTable<CreditApply>
        columns={columns} cardBordered
        dataSource={data} rowKey="id"
        search={{ labelWidth: 'auto' }} pagination={{ pageSize: 10 }}
        headerTitle={<Space><span>额度申请列表</span></Space>}
        toolBarRender={() => []}
        rowClassName={(r) => r.status === 'PENDING' ? 'bg-orange-50' : ''}
      />

      {/* Review Modal */}
      <Modal
        title={reviewModal?.action === 'approve' ? '✅ 审批通过' : '❌ 驳回申请'}
        open={!!reviewModal}
        onOk={handleConfirmReview}
        onCancel={() => { setReviewModal(null); form.resetFields(); }}
        okText="确认"
        okButtonProps={{ style: { backgroundColor: reviewModal?.action === 'approve' ? '#10b981' : '#ef4444' } }}
      >
        {reviewModal && (
          <>
            <p className="mb-3 text-slate-600">
              客户 <strong>{reviewModal.record.customerName}</strong> 申请将额度从
              <strong> ¥{reviewModal.record.currentLimit.toLocaleString()}</strong> 调整至
              <strong> ¥{reviewModal.record.applyLimit.toLocaleString()}</strong>
            </p>
            <Form form={form} layout="vertical">
              <Form.Item label="审核意见" name="remark" rules={[{ required: true, message: '请填写审核意见' }]}>
                <Input.TextArea rows={3} placeholder={reviewModal.action === 'approve' ? '例：审核通过，按申请额度执行' : '例：余额不足，暂不批准'} />
              </Form.Item>
              {reviewModal.action === 'approve' && (
                <Form.Item label="批准额度" name="approvedLimit" initialValue={reviewModal.record.applyLimit}>
                  <InputNumber style={{ width: '100%' }} prefix="¥" />
                </Form.Item>
              )}
            </Form>
          </>
        )}
      </Modal>

      {/* Detail Modal */}
      <Modal title="申请详情" open={!!detailRecord} onCancel={() => setDetailRecord(null)} footer={null}>
        {detailRecord && (
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="申请编号" span={2}>{detailRecord.applyNo}</Descriptions.Item>
            <Descriptions.Item label="客户">{detailRecord.customerName}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={detailRecord.status === 'APPROVED' ? 'success' : detailRecord.status === 'REJECTED' ? 'error' : 'warning'}>
                {detailRecord.status === 'APPROVED' ? '已通过' : detailRecord.status === 'REJECTED' ? '已驳回' : '待审核'}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="当前额度">¥{detailRecord.currentLimit.toLocaleString()}</Descriptions.Item>
            <Descriptions.Item label="申请额度">¥{detailRecord.applyLimit.toLocaleString()}</Descriptions.Item>
            <Descriptions.Item label="申请原因" span={2}>{detailRecord.reason}</Descriptions.Item>
            <Descriptions.Item label="申请时间" span={2}>{detailRecord.appliedAt}</Descriptions.Item>
            {detailRecord.reviewer && <Descriptions.Item label="审核人">{detailRecord.reviewer}</Descriptions.Item>}
            {detailRecord.reviewedAt && <Descriptions.Item label="审核时间">{detailRecord.reviewedAt}</Descriptions.Item>}
            {detailRecord.reviewRemark && <Descriptions.Item label="审核意见" span={2}>{detailRecord.reviewRemark}</Descriptions.Item>}
          </Descriptions>
        )}
      </Modal>
    </PageContainer>
  );
};

export default CreditApplyPage;
