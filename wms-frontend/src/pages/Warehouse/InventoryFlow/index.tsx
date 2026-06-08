import React, { useEffect, useRef, useState } from 'react';
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import { Select, Space, Empty } from 'antd';
import request from '../../../utils/request';

interface InventoryTx {
  id: string;
  type: string;
  qtyBefore: number;
  qtyChange: number;
  qtyAfter: number;
  refType?: string | null;
  refNo?: string | null;
  reason?: string | null;
  operatorName?: string | null;
  batchNo?: string | null;
  createdAt: string;
}

interface WarehouseOpt {
  id: string;
  code: string;
  name: string;
}
interface SelectOpt {
  value: string;
  label: string;
}

const InventoryFlow: React.FC = () => {
  const actionRef = useRef<ActionType>(null);
  const [warehouses, setWarehouses] = useState<WarehouseOpt[]>([]);
  const [warehouseId, setWarehouseId] = useState<string>();
  const [productId, setProductId] = useState<string>();
  const [productOpts, setProductOpts] = useState<SelectOpt[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    request
      .get('/warehouses')
      .then((res: any) => setWarehouses(res?.data ?? []))
      .catch(() => {});
  }, []);

  const searchProducts = async (kw: string) => {
    if (!kw) {
      setProductOpts([]);
      return;
    }
    setSearching(true);
    try {
      const res: any = await request.get('/products', { params: { name: kw, pageSize: 20 } });
      const rows = res?.data ?? [];
      setProductOpts(rows.map((p: any) => ({ value: p.id, label: `${p.sku}${p.name ? ` · ${p.name}` : ''}` })));
    } catch {
      setProductOpts([]);
    } finally {
      setSearching(false);
    }
  };

  const fetchList = async (params: any) => {
    if (!warehouseId || !productId) return { data: [], success: true, total: 0 };
    const { current, pageSize } = params || {};
    const res: any = await request.get('/audit/inventory-transactions', {
      params: { warehouseId, productId, page: current, pageSize },
    });
    return {
      data: res?.data ?? [],
      success: true,
      total: res?.pagination?.total ?? (res?.data?.length ?? 0),
    };
  };

  const columns: ProColumns<InventoryTx>[] = [
    { title: '时间', dataIndex: 'createdAt', valueType: 'dateTime', width: 170 },
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      valueEnum: {
        INBOUND: { text: '入库', status: 'Success' },
        OUTBOUND: { text: '出库', status: 'Error' },
        ADJUST: { text: '调整', status: 'Warning' },
        FREEZE: { text: '冻结', status: 'Processing' },
        UNFREEZE: { text: '解冻', status: 'Default' },
        TRANSFER: { text: '移库', status: 'Processing' },
        PUTAWAY: { text: '上架', status: 'Success' },
      },
    },
    { title: '变更前', dataIndex: 'qtyBefore', width: 90 },
    {
      title: '变更量',
      dataIndex: 'qtyChange',
      width: 100,
      render: (_, r) => (
        <span className={r.qtyChange >= 0 ? 'text-green-600 font-medium' : 'text-red-500 font-medium'}>
          {r.qtyChange >= 0 ? `+${r.qtyChange}` : r.qtyChange}
        </span>
      ),
    },
    { title: '变更后', dataIndex: 'qtyAfter', width: 90 },
    { title: '批次', dataIndex: 'batchNo', width: 140, ellipsis: true, render: (_, r) => r.batchNo || '—' },
    { title: '来源单据', dataIndex: 'refNo', width: 170, ellipsis: true, render: (_, r) => r.refNo || r.refType || '—' },
    { title: '原因', dataIndex: 'reason', ellipsis: true, render: (_, r) => r.reason || '—' },
    { title: '操作人', dataIndex: 'operatorName', width: 110, render: (_, r) => r.operatorName || '系统' },
  ];

  const filterBar = (
    <Space size="middle" wrap>
      <Select
        placeholder="选择仓库"
        style={{ width: 220 }}
        value={warehouseId}
        onChange={setWarehouseId}
        options={warehouses.map((w) => ({ value: w.id, label: `${w.code}${w.name ? ` · ${w.name}` : ''}` }))}
      />
      <Select
        showSearch
        placeholder="搜索商品（SKU / 名称）"
        style={{ width: 300 }}
        value={productId}
        filterOption={false}
        loading={searching}
        onSearch={searchProducts}
        onChange={setProductId}
        options={productOpts}
        notFoundContent={searching ? '搜索中…' : null}
      />
    </Space>
  );

  return (
    <PageContainer header={{ title: '库存变动流水', subTitle: '按仓库 + 商品查询库存事务（冻结 / 出库 / 调整等）的逐笔流水' }}>
      <ProTable<InventoryTx>
        columns={columns}
        actionRef={actionRef}
        cardBordered
        request={fetchList}
        params={{ warehouseId, productId }}
        rowKey="id"
        search={false}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        dateFormatter="string"
        headerTitle={filterBar}
        locale={{
          emptyText: (
            <Empty description={!warehouseId || !productId ? '请先选择仓库和商品' : '暂无流水'} />
          ),
        }}
      />
    </PageContainer>
  );
};

export default InventoryFlow;
