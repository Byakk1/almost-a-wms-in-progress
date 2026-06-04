import React, { useState } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import { Card, Row, Col, Tag, Tooltip, Select, Badge, Space, Statistic, Button, Modal } from 'antd';
import {
  EnvironmentOutlined, ReloadOutlined, ExportOutlined
} from '@ant-design/icons';

const { Option } = Select;

type LocationStatus = 'EMPTY' | 'OCCUPIED' | 'RESERVED' | 'DISABLED';

interface Location {
  code: string;
  row: string;
  col: number;
  floor: number;
  status: LocationStatus;
  sku?: string;
  qty?: number;
}

// Generate mock warehouse grid
const generateLocations = (): Location[] => {
  const rows = ['A', 'B', 'C', 'D', 'E'];
  const cols = [1, 2, 3, 4, 5, 6, 7, 8];
  const floors = [1, 2, 3];
  const statuses: LocationStatus[] = ['OCCUPIED', 'OCCUPIED', 'OCCUPIED', 'EMPTY', 'EMPTY', 'RESERVED', 'DISABLED'];
  const skus = ['SKU-A001', 'SKU-B002', 'SKU-C003', 'SKU-D004', 'SKU-E005'];

  const locs: Location[] = [];
  rows.forEach((row) => {
    cols.forEach((col) => {
      floors.forEach((floor) => {
        const status = statuses[Math.floor(Math.random() * statuses.length)];
        locs.push({
          code: `${row}-0${col}-0${floor}`,
          row, col, floor,
          status,
          sku: status === 'OCCUPIED' ? skus[Math.floor(Math.random() * skus.length)] : undefined,
          qty: status === 'OCCUPIED' ? Math.floor(Math.random() * 200) + 10 : undefined,
        });
      });
    });
  });
  return locs;
};

const ALL_LOCATIONS = generateLocations();

const STATUS_COLOR: Record<LocationStatus, string> = {
  OCCUPIED: '#10b981',
  EMPTY: '#e2e8f0',
  RESERVED: '#f97316',
  DISABLED: '#94a3b8',
};

const STATUS_TEXT: Record<LocationStatus, string> = {
  OCCUPIED: '已占用',
  EMPTY: '空闲',
  RESERVED: '预留',
  DISABLED: '停用',
};

const LocationMap: React.FC = () => {
  const [selectedFloor, setSelectedFloor] = useState<number>(1);
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [detail, setDetail] = useState<Location | null>(null);

  const floorLocations = ALL_LOCATIONS.filter((l) => l.floor === selectedFloor);
  const filtered = selectedStatus === 'ALL'
    ? floorLocations
    : floorLocations.filter((l) => l.status === selectedStatus);

  const rows = [...new Set(ALL_LOCATIONS.map((l) => l.row))].sort();
  const cols = [...new Set(ALL_LOCATIONS.map((l) => l.col))].sort((a, b) => a - b);

  const occupied = ALL_LOCATIONS.filter((l) => l.status === 'OCCUPIED').length;
  const empty = ALL_LOCATIONS.filter((l) => l.status === 'EMPTY').length;
  const reserved = ALL_LOCATIONS.filter((l) => l.status === 'RESERVED').length;
  const total = ALL_LOCATIONS.filter((l) => l.status !== 'DISABLED').length;
  const utilRate = Math.round(((occupied + reserved) / total) * 100);

  return (
    <PageContainer
      header={{
        title: '仓库库位大屏',
        subTitle: '实时查看各库区库位使用状态',
        extra: [
          <Button key="export" icon={<ExportOutlined />}>导出库位报表</Button>,
          <Button key="refresh" icon={<ReloadOutlined />} type="primary" style={{ backgroundColor: '#D23148' }}>刷新</Button>,
        ],
      }}
    >
      {/* Summary Cards */}
      <Row gutter={16} className="mb-4">
        {[
          { label: '总库位', value: total, color: '#1e293b' },
          { label: '已占用', value: occupied, color: '#10b981' },
          { label: '空闲', value: empty, color: '#64748b' },
          { label: '预留', value: reserved, color: '#f97316' },
          { label: '利用率', value: `${utilRate}%`, color: '#D23148' },
        ].map((s) => (
          <Col key={s.label} xs={12} sm={8} md={4} lg={4}>
            <Card size="small" className="text-center shadow-sm">
              <Statistic title={s.label} value={s.value} valueStyle={{ color: s.color, fontSize: 22 }} />
            </Card>
          </Col>
        ))}
        <Col xs={12} sm={8} md={4} lg={4} className="flex items-center">
          <Badge color="#10b981" text="占用" className="mr-3" />
          <Badge color="#e2e8f0" text="空闲" className="mr-3" />
          <Badge color="#f97316" text="预留" className="mr-3" />
          <Badge color="#94a3b8" text="停用" />
        </Col>
      </Row>

      {/* Controls */}
      <Card className="mb-4 shadow-sm" size="small">
        <Space>
          <span className="font-medium text-slate-600">楼层：</span>
          {[1, 2, 3].map((f) => (
            <Button
              key={f}
              size="small"
              type={selectedFloor === f ? 'primary' : 'default'}
              onClick={() => setSelectedFloor(f)}
              style={selectedFloor === f ? { backgroundColor: '#D23148' } : {}}
            >
              F{f}
            </Button>
          ))}
          <span className="ml-4 font-medium text-slate-600">筛选状态：</span>
          <Select value={selectedStatus} onChange={setSelectedStatus} size="small" style={{ width: 110 }}>
            <Option value="ALL">全部</Option>
            <Option value="OCCUPIED">已占用</Option>
            <Option value="EMPTY">空闲</Option>
            <Option value="RESERVED">预留</Option>
            <Option value="DISABLED">停用</Option>
          </Select>
        </Space>
      </Card>

      {/* Location Grid */}
      <Card className="shadow-sm" title={<Space><EnvironmentOutlined style={{ color: '#D23148' }} /><span>F{selectedFloor} 层库位图</span></Space>}>
        {/* Column headers */}
        <div className="mb-3">
          <div style={{ display: 'grid', gridTemplateColumns: `60px repeat(${cols.length}, 1fr)`, gap: 4 }}>
            <div />
            {cols.map((c) => (
              <div key={c} className="text-center text-xs text-slate-400 font-medium">{c}列</div>
            ))}
          </div>
        </div>

        {rows.map((row) => (
          <div key={row} className="mb-2">
            <div style={{ display: 'grid', gridTemplateColumns: `60px repeat(${cols.length}, 1fr)`, gap: 4, alignItems: 'center' }}>
              <div className="text-sm font-bold text-slate-600 text-center">{row} 区</div>
              {cols.map((col) => {
                const loc = filtered.find((l) => l.row === row && l.col === col);
                const allFloorLoc = floorLocations.find((l) => l.row === row && l.col === col);
                if (!loc && selectedStatus !== 'ALL') {
                  // Show dimmed placeholder when filtered
                  return (
                    <div
                      key={col}
                      style={{
                        height: 40,
                        borderRadius: 4,
                        backgroundColor: '#f1f5f9',
                        border: '1px dashed #cbd5e1',
                        opacity: 0.4,
                      }}
                    />
                  );
                }
                const display = loc || allFloorLoc;
                if (!display) return <div key={col} style={{ height: 40 }} />;
                return (
                  <Tooltip
                    key={col}
                    title={
                      <div>
                        <div className="font-bold">{display.code}</div>
                        <div>状态：{STATUS_TEXT[display.status]}</div>
                        {display.sku && <div>SKU: {display.sku}</div>}
                        {display.qty && <div>库存: {display.qty} 件</div>}
                      </div>
                    }
                  >
                    <div
                      onClick={() => setDetail(display)}
                      style={{
                        height: 40,
                        borderRadius: 4,
                        backgroundColor: STATUS_COLOR[display.status],
                        border: `2px solid ${display.status === 'OCCUPIED' ? '#059669' : 'transparent'}`,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        color: display.status === 'EMPTY' ? '#94a3b8' : '#fff',
                        fontWeight: 500,
                        transition: 'transform 0.1s, box-shadow 0.1s',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.transform = 'scale(1.08)';
                        (e.currentTarget as HTMLElement).style.zIndex = '10';
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.transform = '';
                        (e.currentTarget as HTMLElement).style.zIndex = '';
                      }}
                    >
                      {display.status === 'EMPTY' ? '空' : display.code.split('-')[1]}
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        ))}
      </Card>

      {/* Detail Modal */}
      <Modal
        title={<Space><EnvironmentOutlined style={{ color: '#D23148' }} />{detail?.code}</Space>}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={[
          <Button key="close" onClick={() => setDetail(null)}>关闭</Button>,
          detail?.status === 'EMPTY' && (
            <Button key="assign" type="primary" style={{ backgroundColor: '#D23148' }}>
              分配此库位
            </Button>
          ),
        ]}
      >
        {detail && (
          <div className="space-y-3">
            <Row gutter={16}>
              <Col span={12}><Statistic title="库区" value={detail.row} /></Col>
              <Col span={12}><Statistic title="列号" value={detail.col} /></Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}><Statistic title="楼层" value={`F${detail.floor}`} /></Col>
              <Col span={12}>
                <div className="text-xs text-slate-400 mb-1">状态</div>
                <Tag color={
                  detail.status === 'OCCUPIED' ? 'success' :
                  detail.status === 'EMPTY' ? 'default' :
                  detail.status === 'RESERVED' ? 'warning' : 'default'
                }>{STATUS_TEXT[detail.status]}</Tag>
              </Col>
            </Row>
            {detail.sku && <Row gutter={16}>
              <Col span={12}><Statistic title="当前SKU" value={detail.sku} /></Col>
              <Col span={12}><Statistic title="库存量" value={`${detail.qty} 件`} /></Col>
            </Row>}
          </div>
        )}
      </Modal>
    </PageContainer>
  );
};

export default LocationMap;
