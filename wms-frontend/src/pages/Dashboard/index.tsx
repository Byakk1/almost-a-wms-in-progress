import React, { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, List, Typography, Space, Tag, Spin, Button } from 'antd';
import { PageContainer } from '@ant-design/pro-components';
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
  InboxOutlined,
  UploadOutlined,
  RocketOutlined,
  WarningOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import request from '../../utils/request';

const { Text } = Typography;

// Placeholder notices since backend doesn't have notices API yet
const notices = [
  { id: 1, title: '系统升级维护通知', date: '2026-02-28 10:00', type: 'system' },
  { id: 2, title: '新增北美 FBA 线路报价', date: '2026-02-27 15:30', type: 'business' },
  { id: 3, title: '关于规范易碎品打包的培训', date: '2026-02-26 09:15', type: 'training' },
];

const Dashboard: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>({});
  const [trendData, setTrendData] = useState<any>({ labels: [], inbound: [], outbound: [] });
  const [utilization, setUtilization] = useState<any>({ total: 100, occupied: 0, reserved: 0, empty: 100, utilizationRate: 0 });
  const [todos, setTodos] = useState<any[]>([]);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        const [statsRes, trendRes, utilRes, todosRes] = await Promise.all([
          request.get('/dashboard/stats'),
          request.get('/dashboard/trend?days=7'),
          request.get('/dashboard/warehouse-utilization'),
          request.get('/dashboard/todos')
        ]);
        
        setStats(statsRes?.data || statsRes || {});
        setTrendData(trendRes?.data || trendRes || { labels: [], inbound: [], outbound: [] });
        setUtilization(utilRes?.data || utilRes || { total: 100, occupied: 0, reserved: 0, empty: 100, utilizationRate: 0 });
        setTodos(todosRes?.data || todosRes || []);
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  const metricCards = [
    { title: '今日入库量', value: stats.todayInbound || 0, suffix: '件', icon: <UploadOutlined />, color: '#3B82F6', trend: 'up', trendValue: 12 },
    { title: '今日出库量', value: stats.todayOutbound || 0, suffix: '件', icon: <RocketOutlined />, color: '#F97316', trend: 'down', trendValue: 5 },
    { title: '待处理任务', value: stats.pendingOrders || 0, icon: <ClockCircleOutlined />, color: '#F59E0B' },
    { title: '已分配签出', value: stats.pendingSignout || 0, icon: <RocketOutlined />, color: '#D23148' },
    { title: '在库 SKUs', value: stats.totalSkus || 0, icon: <InboxOutlined />, color: '#10B981' },
    { title: '异常状况', value: stats.exceptionCount || 0, icon: <WarningOutlined />, color: '#EF4444' }
  ];

  // ECharts Option for Trend Line
  const trendOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['入库', '出库'], bottom: 0 },
    grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: trendData.labels },
    yAxis: { type: 'value' },
    series: [
      {
        name: '入库',
        type: 'line',
        smooth: true,
        itemStyle: { color: '#3B82F6' },
        areaStyle: { color: 'rgba(59, 130, 246, 0.1)' },
        data: trendData.inbound
      },
      {
        name: '出库',
        type: 'line',
        smooth: true,
        itemStyle: { color: '#F97316' },
        areaStyle: { color: 'rgba(249, 115, 22, 0.1)' },
        data: trendData.outbound
      }
    ]
  };

  // ECharts Option for Utilization Donut
  const utilizationOption = {
    tooltip: { trigger: 'item' },
    legend: { top: '5%', left: 'center' },
    series: [
      {
        name: '库区使用状态',
        type: 'pie',
        radius: ['40%', '70%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 10,
          borderColor: '#fff',
          borderWidth: 2
        },
        label: { show: false, position: 'center' },
        emphasis: {
          label: { show: true, fontSize: 20, fontWeight: 'bold' }
        },
        labelLine: { show: false },
        data: [
          { value: utilization.occupied || 0, name: '已使用', itemStyle: { color: '#D23148' } },
          { value: utilization.reserved || 0, name: '已保留', itemStyle: { color: '#F59E0B' } },
          { value: utilization.empty || utilization.total || 1, name: '空闲', itemStyle: { color: '#E2E8F0' } },
        ]
      }
    ]
  };

  return (
    <PageContainer
      header={{
        title: '运行总览',
        subTitle: 'Cherry WMS 深圳主仓实时看板',
        extra: <Text className="text-gray-400">数据更新时间: 刚刚</Text>,
      }}
    >
      <Spin spinning={loading} tip="加载中...">
        <div className="space-y-4">
          {/* Metrics Row */}
          <Row gutter={[16, 16]}>
            {metricCards.map((item, index) => (
              <Col xs={24} sm={12} lg={8} xl={4} key={index}>
                <Card size="small" className="shadow-sm border-gray-100">
                  <Statistic
                    title={
                      <Space size={4} className="text-gray-500 text-xs">
                        <span style={{ color: item.color }}>{item.icon}</span>
                        {item.title}
                      </Space>
                    }
                    value={item.value}
                    valueStyle={{ color: '#1f2937', fontWeight: 600, fontSize: 24 }}
                    suffix={<span className="text-xs text-gray-400 ml-1">{item.suffix}</span>}
                  />
                  {item.trend && (
                    <div className="mt-1 text-[10px]">
                      <span className={item.trend === 'up' ? 'text-red-500' : 'text-green-500'}>
                        {item.trend === 'up' ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {item.trendValue}%
                      </span>
                      <span className="text-gray-400 ml-1">较昨日</span>
                    </div>
                  )}
                </Card>
              </Col>
            ))}
          </Row>

          {/* Charts Row */}
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={16}>
              <Card 
                title={<span className="text-sm font-semibold">近七天出入库趋势</span>} 
                size="small"
                className="shadow-sm border-gray-100"
              >
                <ReactECharts option={trendOption} style={{ height: '300px', width: '100%' }} />
              </Card>
            </Col>
            <Col xs={24} lg={8}>
              <Card 
                title={<span className="text-sm font-semibold">当前仓库利用率</span>} 
                size="small"
                className="shadow-sm border-gray-100"
              >
                <ReactECharts option={utilizationOption} style={{ height: '300px', width: '100%' }} />
                <div className="text-center mt-2">
                  <div className="text-2xl font-bold text-red-600">{utilization.utilizationRate || 0}%</div>
                  <Text type="secondary" className="text-xs">总利用率健康</Text>
                </div>
              </Card>
            </Col>
          </Row>

          {/* Bottom Row - Notices & Tasks */}
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <Card 
                title={<span className="text-sm font-semibold">最新系统公告</span>} 
                extra={<Button type="link" size="small">查看全部</Button>}
                size="small"
                className="shadow-sm border-gray-100"
              >
                <List
                  size="small"
                  itemLayout="horizontal"
                  dataSource={todos.length ? todos : notices}
                  renderItem={(item: any) => (
                    <List.Item className="hover:bg-gray-50 transition-colors rounded px-2 cursor-pointer border-none py-2">
                      <List.Item.Meta
                        title={
                          <Space size={4}>
                            <Tag color={item.type === 'receiving' ? 'blue' : item.type === 'putaway' ? 'orange' : 'green'} className="m-0 text-[10px] leading-4">
                              {item.type || 'system'}
                            </Tag>
                            <span className="text-gray-700 text-xs">{item.title}</span>
                          </Space>
                        }
                      />
                      <div className="text-[10px] text-gray-400">{item.count ? `Count: ${item.count}` : item.date}</div>
                    </List.Item>
                  )}
                />
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card 
                title={<span className="text-sm font-semibold">快捷操作台</span>} 
                size="small"
                className="shadow-sm border-gray-100 h-full"
              >
                <div className="grid grid-cols-3 gap-3 h-full pb-2">
                  <div className="flex flex-col items-center justify-center p-3 border border-gray-100 rounded-lg cursor-pointer hover:border-red-500 hover:shadow-sm transition-all group bg-white">
                    <div className="w-10 h-10 rounded-full bg-red-50 text-red-500 flex items-center justify-center text-lg mb-2 group-hover:bg-red-500 group-hover:text-white transition-colors">
                      <UploadOutlined />
                    </div>
                    <span className="text-gray-700 text-xs font-medium">快速收货</span>
                  </div>
                  
                  <div className="flex flex-col items-center justify-center p-3 border border-gray-100 rounded-lg cursor-pointer hover:border-orange-500 hover:shadow-sm transition-all group bg-white">
                    <div className="w-10 h-10 rounded-full bg-orange-50 text-orange-500 flex items-center justify-center text-lg mb-2 group-hover:bg-orange-500 group-hover:text-white transition-colors">
                      <RocketOutlined />
                    </div>
                    <span className="text-gray-700 text-xs font-medium">按单打包</span>
                  </div>

                  <div className="flex flex-col items-center justify-center p-3 border border-gray-100 rounded-lg cursor-pointer hover:border-blue-500 hover:shadow-sm transition-all group bg-white">
                    <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center text-lg mb-2 group-hover:bg-blue-500 group-hover:text-white transition-colors">
                      <InboxOutlined />
                    </div>
                    <span className="text-gray-700 text-xs font-medium">库存盘点</span>
                  </div>
                </div>
              </Card>
            </Col>
          </Row>
        </div>
      </Spin>
    </PageContainer>
  );
};

export default Dashboard;
