import React from 'react';
import { Alert, Button, Empty, Skeleton, Tooltip, theme } from 'antd';
import {
  ArrowRightOutlined, InboxOutlined, UploadOutlined, RocketOutlined,
  WarningOutlined, ClockCircleOutlined, ReloadOutlined, ScanOutlined,
  DatabaseOutlined, CalculatorOutlined, InfoCircleOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import { canAccessPath, useRole } from '../../router/permissions';
import { useDashboardResource } from './useDashboardResource';

interface Stats {
  todayInbound: number;
  todayOutbound: number;
  pendingOrders: number;
  pendingSignout: number;
  totalSkus: number;
  exceptionCount: number;
}
interface Trend { labels: string[]; inbound: number[]; outbound: number[] }
interface Capacity { total: number; occupied: number; reserved: number; empty: number; utilizationRate: number }
interface Todo { id: string; type: string; title: string; count: number }

const taskRoutes: Record<string, { path: string; icon: React.ReactNode; label: string }> = {
  receiving: { path: '/inbound/receiving', icon: <UploadOutlined />, label: '收货管理' },
  putaway: { path: '/inbound/putaway', icon: <InboxOutlined />, label: '上架管理' },
  inventory: { path: '/warehouse/inventory', icon: <DatabaseOutlined />, label: '库存查询' },
};

function ResourceFeedback({ resource, label }: {
  resource: { loading: boolean; error: boolean; data: unknown; reload: () => void };
  label: string;
}) {
  if (resource.error) return (
    <Alert
      className="console-resource-error"
      type="error"
      showIcon
      role="alert"
      message={`${label} unavailable`}
      description={resource.data ? 'Showing the last successful response. Retry to refresh.' : 'This is not a zero result. Please retry.'}
      action={<Button size="small" onClick={resource.reload}>Retry</Button>}
    />
  );
  if (resource.loading && !resource.data) return <Skeleton active paragraph={{ rows: 3 }} title={false} />;
  return null;
}

const Dashboard: React.FC = () => {
  const role = useRole();
  const { token } = theme.useToken();
  const stats = useDashboardResource<Stats>('/dashboard/stats');
  const trend = useDashboardResource<Trend>('/dashboard/trend?days=7');
  const capacity = useDashboardResource<Capacity>('/dashboard/warehouse-utilization');
  const todos = useDashboardResource<Todo[]>('/dashboard/todos');

  const metrics: Array<{ key: keyof Stats; title: string; unit?: string; icon: React.ReactNode; note: string }> = [
    { key: 'todayInbound', title: '今日入库量', unit: '件', icon: <UploadOutlined />, note: 'Received units on orders created today' },
    { key: 'todayOutbound', title: '今日出库量', unit: '件', icon: <RocketOutlined />, note: 'Packed units on orders created today' },
    { key: 'pendingOrders', title: '待处理任务', unit: '单', icon: <ClockCircleOutlined />, note: 'Receiving orders not yet in a terminal state' },
    { key: 'pendingSignout', title: '已分配签出', unit: '单', icon: <RocketOutlined />, note: 'Packed or shipped orders awaiting sign-out' },
    { key: 'totalSkus', title: '在库 SKUs', icon: <InboxOutlined />, note: 'Distinct products with inventory records' },
    { key: 'exceptionCount', title: '异常状况', unit: '单', icon: <WarningOutlined />, note: 'Inbound and outbound orders in exception state' },
  ];
  const shortcuts = [
    { path: '/inbound/receiving/add', label: '收货操作台', icon: <ScanOutlined /> },
    { path: '/inbound/putaway', label: '上架管理', icon: <InboxOutlined /> },
    { path: '/outbound/picking', label: '拣货管理', icon: <RocketOutlined /> },
    { path: '/outbound/packing', label: '按单打包台', icon: <ScanOutlined /> },
    { path: '/warehouse/inventory', label: '库存查询', icon: <DatabaseOutlined /> },
    { path: '/fee/calculator', label: '运费试算', icon: <CalculatorOutlined /> },
  ].filter((item) => canAccessPath(item.path, role));

  const trendOption = {
    animation: false,
    tooltip: { trigger: 'axis' },
    legend: { data: ['入库', '出库'], top: 0, right: 0, textStyle: { color: token.colorTextSecondary } },
    grid: { left: 12, right: 16, top: 42, bottom: 8, containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: trend.data?.labels ?? [], axisLine: { lineStyle: { color: token.colorBorderSecondary } }, axisTick: { show: false }, axisLabel: { color: token.colorTextSecondary } },
    yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: token.colorBorderSecondary, type: 'dashed' } }, axisLabel: { color: token.colorTextSecondary } },
    series: [
      { name: '入库', type: 'line', symbol: 'circle', symbolSize: 5, itemStyle: { color: token.colorPrimary }, lineStyle: { width: 2 }, data: trend.data?.inbound ?? [] },
      { name: '出库', type: 'line', symbol: 'rect', symbolSize: 5, itemStyle: { color: token.colorTextSecondary }, lineStyle: { width: 2, type: 'dashed' }, data: trend.data?.outbound ?? [] },
    ],
  };
  const busy = stats.loading || trend.loading || capacity.loading || todos.loading;
  const refresh = () => { stats.reload(); trend.reload(); capacity.reload(); todos.reload(); };

  return (
    <div className="console-dashboard">
      <header className="console-page-heading">
        <div>
          <p className="eyebrow">WAREHOUSE OPERATIONS</p>
          <h1>运行总览</h1>
          <p className="console-caption">出入库吞吐、待办任务与库位容量</p>
        </div>
        <div className="console-heading-actions">
          {stats.updatedAt && <span className="console-caption">Metrics updated <time dateTime={stats.updatedAt.toISOString()}>{stats.updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></span>}
          <Button icon={<ReloadOutlined />} onClick={refresh} loading={busy}>Refresh</Button>
        </div>
      </header>

      <section aria-label="关键指标" data-widget="stats" aria-busy={stats.loading}>
        {stats.error && <ResourceFeedback resource={stats} label="Metrics" />}
        <div className="console-metrics">
          {metrics.map((metric) => (
            <div key={metric.key} className={`console-metric${metric.key === 'exceptionCount' && (stats.data?.exceptionCount ?? 0) > 0 ? ' console-metric-alert' : ''}`}>
              <div className="console-metric-label"><span>{metric.icon} {metric.title}</span><Tooltip title={metric.note}><InfoCircleOutlined tabIndex={0} aria-label={metric.note} /></Tooltip></div>
              <div className="console-metric-value num">
                {stats.loading && !stats.data ? <Skeleton.Input active size="small" style={{ width: 72 }} /> : stats.data?.[metric.key] ?? '—'}
                {stats.data && metric.unit && <span className="console-metric-unit">{metric.unit}</span>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="console-overview-grid">
        <section className="console-panel console-work-queue" data-widget="todos" aria-busy={todos.loading}>
          <div className="console-panel-heading"><div><p className="eyebrow">WORK QUEUE</p><h2>待办任务</h2></div><ClockCircleOutlined className="console-muted-icon" /></div>
          <ResourceFeedback resource={todos} label="Work queue" />
          {todos.data && (todos.data.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No pending tasks returned" /> : (
            <ul className="console-task-list">
              {todos.data.map((todo) => {
                const target = taskRoutes[todo.type];
                const allowed = target && canAccessPath(target.path, role);
                return (
                  <li key={todo.id} className="console-task-row">
                    <span className="console-task-icon">{target?.icon ?? <ClockCircleOutlined />}</span>
                    <div className="console-task-name"><strong>{todo.title}</strong><span className="console-caption">{target?.label ?? todo.type}</span></div>
                    <span className="console-task-count num">{todo.count}</span>
                    {allowed ? <Link to={target.path} className="console-task-open" aria-label={`Open ${todo.title}`}><ArrowRightOutlined /></Link> : <span className="console-task-open-placeholder" />}
                  </li>
                );
              })}
            </ul>
          ))}
          <p className="console-panel-note">Counts are grouped by task type. Open a queue to review its records.</p>
        </section>

        <section className="console-panel" data-widget="capacity" aria-busy={capacity.loading}>
          <div className="console-panel-heading"><div><p className="eyebrow">CAPACITY</p><h2>库区状态</h2></div><DatabaseOutlined className="console-muted-icon" /></div>
          <ResourceFeedback resource={capacity} label="Warehouse capacity" />
          {capacity.data && (capacity.data.total === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No active locations" /> : (
            <>
              <div className="console-capacity-summary"><div><span className="console-capacity-value num">{capacity.data.utilizationRate}<small>%</small></span><p className="console-caption">已使用 + 已保留</p></div><span className="console-caption">Total <b className="num">{capacity.data.total}</b></span></div>
              <div className="console-capacity-bar" role="img" aria-label={`Occupied ${capacity.data.occupied}, reserved ${capacity.data.reserved}, empty ${capacity.data.empty}`}>
                <span className="console-capacity-occupied" style={{ width: `${capacity.data.occupied / capacity.data.total * 100}%` }} />
                <span className="console-capacity-reserved" style={{ width: `${capacity.data.reserved / capacity.data.total * 100}%` }} />
              </div>
              <dl className="console-capacity-legend">
                {[['已使用', capacity.data.occupied, 'occupied'], ['已保留', capacity.data.reserved, 'reserved'], ['空闲', capacity.data.empty, 'empty']].map(([label, value, kind]) => (
                  <div key={kind}><dt><i className={`console-capacity-${kind}`} />{label}</dt><dd className="num">{value}</dd></div>
                ))}
              </dl>
            </>
          ))}
        </section>

        <section className="console-panel console-trend" data-widget="trend" aria-busy={trend.loading}>
          <div className="console-panel-heading"><div><p className="eyebrow">THROUGHPUT</p><h2>近七天出入库趋势</h2></div><span className="console-caption">件 / day</span></div>
          <ResourceFeedback resource={trend} label="Throughput" />
          {trend.data && (trend.data.labels.length ? <ReactECharts option={trendOption} style={{ height: 240, width: '100%' }} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No throughput data returned" />)}
          <p className="console-panel-note"><InfoCircleOutlined /> Received / packed units grouped by order creation date; not completion timestamps.</p>
        </section>

        <section className="console-panel" aria-label="快捷操作">
          <div className="console-panel-heading"><div><p className="eyebrow">WORKSTATIONS</p><h2>快捷操作</h2></div><ScanOutlined className="console-muted-icon" /></div>
          <nav className="console-shortcuts" aria-label="Workstation shortcuts">
            {shortcuts.map((item) => <Link key={item.path} to={item.path}><span>{item.icon} {item.label}</span><ArrowRightOutlined /></Link>)}
          </nav>
          <p className="console-panel-note">Shortcuts supplement the existing navigation. All submenus remain available.</p>
        </section>
      </div>
    </div>
  );
};

export default Dashboard;
