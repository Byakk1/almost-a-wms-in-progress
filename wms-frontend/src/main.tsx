import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App.tsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#E61B2B',
          colorPrimaryHover: '#C41522',
          colorPrimaryActive: '#A2121C',
          colorLink: '#C41522',
          colorInfo: '#1677FF',
          colorSuccess: '#389E0D',
          colorWarning: '#D46B08',
          colorError: '#B42318',
          colorTextBase: '#1B1D21',
          colorBgLayout: '#F3F4F6',
          colorBorder: 'rgba(0,0,0,0.10)',
          colorBorderSecondary: 'rgba(0,0,0,0.06)',
          borderRadius: 8,
          borderRadiusLG: 12,
          borderRadiusSM: 8,
          wireframe: false,
          fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
          fontSize: 14,
          lineHeight: 1.625,
          // Soft micro-shadows, not hard outlines
          boxShadow: '0 1px 3px rgba(16,24,40,0.06), 0 1px 2px rgba(16,24,40,0.04)',
          boxShadowSecondary: '0 4px 8px -2px rgba(16,24,40,0.08), 0 2px 4px -2px rgba(16,24,40,0.04)',
        },
        components: {
          Button: { primaryShadow: '0 1px 2px rgba(16,24,40,0.06)' },
          Layout: { headerBg: '#E61B2B', headerColor: '#FFFFFF', headerHeight: 56 },
          Table: {
            headerBg: '#F8FAFC',
            headerColor: '#43474E',
            rowHoverBg: '#FEF3F4',
            borderColor: 'rgba(0,0,0,0.06)',
          },
          Tag: { defaultBg: '#FEF3F4', defaultColor: '#A2121C' },
          // sinobuy: cards/sheets at the 12px base radius
          Card: { borderRadiusLG: 12 },
          Modal: { borderRadiusLG: 12 },
          Drawer: { borderRadiusLG: 12 },
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
