import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PageContainer } from '@ant-design/pro-components';
import {
  Card, Row, Col, Tag, Tooltip, Select, Badge, Space, Statistic, Button,
  Modal, Empty, Spin, message, theme, Descriptions,
} from 'antd';
import { EnvironmentOutlined, ReloadOutlined } from '@ant-design/icons';
import request from '../../../utils/request';
import { useCan } from '../../../router/permissions';

type LocationStatus = 'EMPTY' | 'OCCUPIED' | 'RESERVED' | 'DISABLED';

// Mirrors the Prisma Location row returned by GET /locations.
// zone / row / col / floor are all nullable in the schema and are null on most
// real rows, so nothing here may assume a dense row×col×floor grid.
interface LocationRow {
  id: string;
  code: string;
  warehouseId: string;
  zone: string | null;
  row: string | null;
  col: number | null;
  floor: number | null;
  status: LocationStatus;
  updatedAt: string;
}

interface WarehouseOpt {
  id: string;
  code: string;
  name: string;
}

const STATUS_TEXT: Record<LocationStatus, string> = {
  OCCUPIED: '已占用',
  EMPTY: '空闲',
  RESERVED: '预留',
  DISABLED: '停用',
};

const STATUS_TAG: Record<LocationStatus, string> = {
  OCCUPIED: 'success',
  EMPTY: 'default',
  RESERVED: 'warning',
  DISABLED: 'default',
};

const UNZONED = '未分区';

const LocationMap: React.FC = () => {
  const { token } = theme.useToken();
  const canWrite = useCan('location.write'); // PUT /locations/:id — admin only

  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOpt[]>([]);
  const [warehouseId, setWarehouseId] = useState<string>();
  const [status, setStatus] = useState<string>('ALL');
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<LocationRow | null>(null);
  const [nextStatus, setNextStatus] = useState<LocationStatus>('EMPTY');
  const [saving, setSaving] = useState(false);

  // Status colours follow the active theme so the board tracks the palette.
  const STATUS_COLOR: Record<LocationStatus, string> = useMemo(
    () => ({
      OCCUPIED: token.colorSuccess,
      EMPTY: token.colorFillSecondary,
      RESERVED: token.colorWarning,
      DISABLED: token.colorTextDisabled,
    }),
    [token],
  );

  const loadLocations = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await request.get('/locations', {
        params: {
          warehouseId: warehouseId || undefined,
          status: status === 'ALL' ? undefined : status,
        },
      });
      setLocations(res?.data ?? []);
    } catch {
      // request.ts interceptor surfaces errors
    } finally {
      setLoading(false);
    }
  }, [warehouseId, status]);

  useEffect(() => {
    request
      .get('/warehouses')
      .then((res: any) => setWarehouses(res?.data ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadLocations();
  }, [loadLocations]);

  // Stats are computed over whatever the current filter returned, so the header
  // always describes the board actually on screen.
  const stats = useMemo(() => {
    const by = (s: LocationStatus) => locations.filter((l) => l.status === s).length;
    const occupied = by('OCCUPIED');
    const reserved = by('RESERVED');
    const usable = locations.filter((l) => l.status !== 'DISABLED').length;
    return {
      total: locations.length,
      occupied,
      empty: by('EMPTY'),
      reserved,
      disabled: by('DISABLED'),
      utilRate: usable ? Math.round(((occupied + reserved) / usable) * 100) : 0,
    };
  }, [locations]);

  // Grouped by zone — the only positional field populated on real rows.
  const zones = useMemo(() => {
    const map = new Map<string, LocationRow[]>();
    for (const l of locations) {
      const key = l.zone || UNZONED;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(l);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [locations]);

  const openDetail = (loc: LocationRow) => {
    setDetail(loc);
    setNextStatus(loc.status);
  };

  const saveStatus = async () => {
    if (!detail) return;
    setSaving(true);
    try {
      await request.put(`/locations/${detail.id}`, { status: nextStatus });
      message.success(`${detail.code} 状态已更新为${STATUS_TEXT[nextStatus]}`);
      setDetail(null);
      loadLocations();
    } catch {
      // request.ts interceptor surfaces errors
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageContainer
      header={{
        title: '仓库库位大屏',
        subTitle: '按库区查看库位使用状态',
        extra: [
          <Button key="refresh" icon={<ReloadOutlined />} type="primary" loading={loading} onClick={loadLocations}>
            刷新
          </Button>,
        ],
      }}
    >
      <Row gutter={[16, 16]} className="mb-4">
        {[
          { label: '库位总数', value: stats.total },
          { label: '已占用', value: stats.occupied, color: token.colorSuccess },
          { label: '空闲', value: stats.empty },
          { label: '预留', value: stats.reserved, color: token.colorWarning },
          { label: '停用', value: stats.disabled, color: token.colorTextDisabled },
          { label: '利用率', value: `${stats.utilRate}%`, color: token.colorPrimary },
        ].map((s) => (
          <Col key={s.label} xs={12} sm={8} md={4}>
            <Card size="small" className="text-center shadow-sm">
              <Statistic title={s.label} value={s.value} valueStyle={{ color: s.color, fontSize: 22 }} />
            </Card>
          </Col>
        ))}
      </Row>

      <Card className="mb-4 shadow-sm" size="small">
        <Space wrap>
          <span className="font-medium text-slate-600">仓库：</span>
          <Select
            allowClear
            placeholder="全部仓库"
            style={{ width: 220 }}
            value={warehouseId}
            onChange={setWarehouseId}
            options={warehouses.map((w) => ({
              value: w.id,
              label: `${w.code}${w.name ? ` · ${w.name}` : ''}`,
            }))}
          />
          <span className="ml-4 font-medium text-slate-600">状态：</span>
          <Select
            value={status}
            onChange={setStatus}
            style={{ width: 120 }}
            options={[
              { value: 'ALL', label: '全部' },
              { value: 'OCCUPIED', label: '已占用' },
              { value: 'EMPTY', label: '空闲' },
              { value: 'RESERVED', label: '预留' },
              { value: 'DISABLED', label: '停用' },
            ]}
          />
          <Space className="ml-4" size="middle">
            <Badge color={STATUS_COLOR.OCCUPIED} text="占用" />
            <Badge color={STATUS_COLOR.EMPTY} text="空闲" />
            <Badge color={STATUS_COLOR.RESERVED} text="预留" />
            <Badge color={STATUS_COLOR.DISABLED} text="停用" />
          </Space>
        </Space>
      </Card>

      <Spin spinning={loading}>
        {zones.length === 0 ? (
          <Card className="shadow-sm">
            <Empty description="当前筛选条件下没有库位" />
          </Card>
        ) : (
          zones.map(([zone, list]) => (
            <Card
              key={zone}
              className="shadow-sm mb-4"
              title={
                <Space>
                  <EnvironmentOutlined style={{ color: token.colorPrimary }} />
                  <span>{zone === UNZONED ? UNZONED : `${zone} 区`}</span>
                  <Tag>{list.length}</Tag>
                </Space>
              }
            >
              <div className="flex flex-wrap gap-2">
                {list.map((loc) => (
                  <Tooltip
                    key={loc.id}
                    title={
                      <div>
                        <div className="font-bold">{loc.code}</div>
                        <div>状态：{STATUS_TEXT[loc.status]}</div>
                        {loc.row && <div>排：{loc.row}</div>}
                        {loc.col != null && <div>列：{loc.col}</div>}
                      </div>
                    }
                  >
                    <div
                      onClick={() => openDetail(loc)}
                      style={{
                        minWidth: 92,
                        height: 46,
                        padding: '0 10px',
                        borderRadius: token.borderRadius,
                        backgroundColor: STATUS_COLOR[loc.status],
                        color: loc.status === 'EMPTY' ? token.colorTextSecondary : '#fff',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                        fontWeight: 500,
                        boxShadow: token.boxShadowTertiary,
                      }}
                    >
                      {loc.code}
                    </div>
                  </Tooltip>
                ))}
              </div>
            </Card>
          ))
        )}
      </Spin>

      <Modal
        title={
          <Space>
            <EnvironmentOutlined style={{ color: token.colorPrimary }} />
            {detail?.code}
          </Space>
        }
        open={!!detail}
        onCancel={() => setDetail(null)}
        destroyOnHidden
        footer={[
          <Button key="close" onClick={() => setDetail(null)}>关闭</Button>,
          <Button
            key="save"
            type="primary"
            loading={saving}
            disabled={!canWrite || nextStatus === detail?.status}
            onClick={saveStatus}
          >
            保存状态
          </Button>,
        ]}
      >
        {detail && (
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label="库位编码" span={2}>{detail.code}</Descriptions.Item>
            <Descriptions.Item label="库区">{detail.zone || '—'}</Descriptions.Item>
            <Descriptions.Item label="楼层">{detail.floor ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="排">{detail.row || '—'}</Descriptions.Item>
            <Descriptions.Item label="列">{detail.col ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="当前状态" span={2}>
              <Tag color={STATUS_TAG[detail.status]}>{STATUS_TEXT[detail.status]}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="变更为" span={2}>
              <Select
                value={nextStatus}
                onChange={(v) => setNextStatus(v as LocationStatus)}
                disabled={!canWrite}
                style={{ width: 160 }}
                options={(Object.keys(STATUS_TEXT) as LocationStatus[]).map((s) => ({
                  value: s,
                  label: STATUS_TEXT[s],
                }))}
              />
              {!canWrite && <span className="ml-3 text-xs text-slate-400">仅管理员可修改</span>}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </PageContainer>
  );
};

export default LocationMap;
