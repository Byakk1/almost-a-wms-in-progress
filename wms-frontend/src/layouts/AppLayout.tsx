import React, { useState } from 'react';
import { ProLayout } from '@ant-design/pro-components';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { menuRoutes, findRouteNameByPath } from '../router/routes';
import { useTabStore } from '../store/tabs';
import logoSVG from '../assets/logo.svg';
import TabLayout from './TabLayout';

const AppLayout: React.FC = () => {
  const [pathname, setPathname] = useState('/dashboard');
  const user = useAuthStore((state) => state.userInfo);
  const logout = useAuthStore((state) => state.logout);
  const location = useLocation();
  const navigate = useNavigate();
  const addTab = useTabStore(state => state.addTab);

  // Sync state with location initially
  React.useEffect(() => {
    setPathname(location.pathname);
  }, [location.pathname]);

  const handleMenuClick = (path: string, name?: string) => {
    setPathname(path);
    if (path !== '/' && path !== '/login') {
      const tabTitle = name || findRouteNameByPath(path) || '新标签页';
      addTab({ key: path, title: tabTitle, path, isModified: false });
    }
    navigate(path);
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <ProLayout
        title="Cherry WMS"
        logo={
          <div className="flex items-center -ml-[3px] mr-2 h-8">
            <img src={logoSVG} alt="Cherry WMS" className="h-full w-auto" />
          </div>
        }
        layout="mix"
        contentWidth="Fluid"
        fixedHeader
        fixSiderbar
        colorPrimary="#D23148"
        location={{
          pathname,
        }}
        avatarProps={{
          src: user?.avatar || 'https://gw.alipayobjects.com/zos/antfincdn/efFD%24IOql2/weixintupian_20170331104822.jpg',
          title: user?.name || 'Admin',
          size: 'small',
        }}
        actionsRender={(props) => {
          if (props.isMobile) return [];
          return [
            <a key="logout" onClick={() => logout()} className="text-slate-500 hover:text-primary transition-colors text-sm font-medium mr-4">
              退出登录
            </a>
          ];
        }}
        token={{
          header: {
            colorBgHeader: '#FFFFFF',
            colorHeaderTitle: '#1E293B',
          },
          sider: {
            colorBgMenuItemSelected: 'rgba(210, 49, 72, 0.1)',
            colorTextMenuSelected: '#D23148',
            colorTextMenuItemHover: '#D23148',
          },
        }}
        menuItemRender={(item, dom) => (
          <div
            onClick={() => handleMenuClick(item.path || '/dashboard', item.name)}
            className="cursor-pointer"
          >
            {dom}
          </div>
        )}
        route={{
          routes: menuRoutes,
        }}
        contentStyle={{ padding: 0, margin: 0, height: 'calc(100vh - 56px)' }} // Ensure content area occupies full height
      >
        <TabLayout />
      </ProLayout>
    </div>
  );
};

export default AppLayout;
