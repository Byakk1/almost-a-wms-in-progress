import React, { useState } from 'react';
import { ProLayout } from '@ant-design/pro-components';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { menuRoutes, findRouteNameByPath } from '../router/routes';
import { filterMenuByRole, canAccessPath, firstLeafPath } from '../router/permissions';
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
  const role = user?.role;

  // Menu filtered to the current role (RBAC). Backend @Roles is the real guard;
  // this just hides what the user can't use. See router/permissions.ts.
  const visibleRoutes = React.useMemo(() => filterMenuByRole(menuRoutes, role), [role]);

  // Sync state with location initially
  React.useEffect(() => {
    setPathname(location.pathname);
  }, [location.pathname]);

  // Landing fallback: if the default route isn't permitted for this role
  // (e.g. CUSTOMER can't see /dashboard), send them to their first visible page.
  React.useEffect(() => {
    if (location.pathname === '/' || location.pathname === '/dashboard') {
      if (!canAccessPath('/dashboard', role)) {
        const first = firstLeafPath(visibleRoutes);
        if (first) {
          setPathname(first);
          navigate(first, { replace: true });
        }
      }
    }
  }, [role, location.pathname, visibleRoutes, navigate]);

  const handleMenuClick = (path: string, name?: string) => {
    setPathname(path);
    if (path !== '/' && path !== '/login') {
      const tabTitle = name || findRouteNameByPath(path) || '新标签页';
      addTab({ key: path, title: tabTitle, path, isModified: false });
    }
    navigate(path);
  };

  return (
    <div className="console-shell" style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <ProLayout
        // `title={false}`: ProLayout renders its title as an <h1> on every page,
        // which competed with each page's own <h1> (two h1s per document).
        title={false}
        logo={
          // The original brand asset, rendered pure white on the cherry header.
          //
          // Recolour is done with a CSS filter rather than by editing the file:
          // logo.svg is a 625-path auto-trace with 621 distinct fills and zero
          // strokes, so recolouring would mean rewriting every fill and keeping a
          // second 357 KB file in sync. `brightness(0) invert(1)` was verified to
          // render pixel-identically to the hand-recoloured version.
          //
          // Size floor is 40px: measured on a 28/32/36/40/48/56 ladder, the mark
          // is unreadable speckle at 28px and only resolves from ~36-40px up,
          // because the form is carried entirely by fill colour, not line work.
          // `!` is mandatory — ProLayout hard-sets the logo img to 28px with
          // unlayered CSS, which beats Tailwind's @layer utilities outright.
          <div className="flex items-center h-full -ml-[3px] mr-2">
            <img
              src={logoSVG}
              alt="Cherry WMS"
              className="!h-8 sm:!h-10 !w-auto shrink-0"
              style={{ filter: 'brightness(0) invert(1)' }}
            />
          </div>
        }
        layout="mix"
        contentWidth="Fluid"
        fixedHeader
        fixSiderbar
        colorPrimary="#E61B2B"
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
            <button key="logout" type="button" onClick={() => logout()} className="console-logout">
              退出登录
            </button>
          ];
        }}
        token={{
          header: {
            colorBgHeader: '#E61B2B',
            colorHeaderTitle: '#FFFFFF',
            // Pure white throughout: #E61B2B is only 4.61:1 against white, so
            // the previous pale-pink (#FCE4E9) would drop to 3.82:1 and fail AA.
            colorTextRightActionsItem: '#FFFFFF',
            colorTextMenu: '#FFFFFF',
            colorTextMenuSelected: '#FFFFFF',
            colorTextMenuActive: '#FFFFFF',
            colorBgMenuItemSelected: 'rgba(255,255,255,0.18)',
            colorBgMenuItemHover: 'rgba(255,255,255,0.12)',
          },
          sider: {
            colorBgMenuItemSelected: '#FEF3F4',
            colorTextMenuSelected: '#A2121C',
            colorTextMenuItemHover: '#C41522',
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
          routes: visibleRoutes,
        }}
        contentStyle={{ padding: 0, margin: 0, height: 'calc(100vh - 56px)' }} // Ensure content area occupies full height
      >
        <TabLayout />
      </ProLayout>
    </div>
  );
};

export default AppLayout;
