import React, { useEffect, useState } from 'react';
import type { MenuProps } from 'antd';
import { Tabs, Dropdown } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTabStore } from '../store/tabs';
import { routeElements, findRouteNameByPath } from '../router/routes';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface DraggableTabPaneProps extends React.HTMLAttributes<HTMLDivElement> {
  'data-node-key': string;
}

const DraggableTabNode = ({ className, ...props }: DraggableTabPaneProps) => {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: props['data-node-key'],
  });

  const style: React.CSSProperties = {
    ...props.style,
    transform: CSS.Transform.toString(transform && { ...transform, scaleX: 1 }),
    transition,
    cursor: 'move',
  };

  return React.cloneElement(props.children as React.ReactElement, {
    ref: setNodeRef,
    style,
    ...attributes,
    ...listeners,
  } as any);
};

const TabLayout: React.FC = () => {
  const { tabs, activeKey, addTab, removeTab, setActiveKey, closeAll, closeOthers, setTabs } = useTabStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [contextMenuRef, setContextMenuRef] = useState<{ x: number; y: number; key: string } | null>(null);

  // Sync route changes to tabs
  useEffect(() => {
    const path = location.pathname;
    // Don't add tabs for root or login
    if (path === '/' || path === '/login') return;

    // Fast check to prevent infinite loops: don't add if already exists and active
    if (tabs.find(t => t.key === path) && activeKey === path) return;

    const title = findRouteNameByPath(path) || '新页签';
    addTab({ key: path, title, path, isModified: false });
  }, [location.pathname]);

  // Note: a previous useEffect synced activeKey → navigate(activeKey). It raced
  // with the route→tab effect above and caused dashboard/putaway to bounce in a
  // navigation loop. Tab-click navigation now lives in onChange below, and the
  // "all tabs closed → /dashboard" fallback lives in onEdit.

  const onEdit = (targetKey: React.MouseEvent | React.KeyboardEvent | string, action: 'add' | 'remove') => {
    if (action === 'remove') {
      removeTab(targetKey as string);
      const next = useTabStore.getState();
      navigate(next.activeKey || '/dashboard');
    }
  };

  const onChange = (newActiveKey: string) => {
    setActiveKey(newActiveKey);
    if (newActiveKey && newActiveKey !== location.pathname) {
      navigate(newActiveKey);
    }
  };

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) {
      const activeIndex = tabs.findIndex((i) => i.key === active.id);
      const overIndex = tabs.findIndex((i) => i.key === over.id);
      setTabs(arrayMove(tabs, activeIndex, overIndex));
    }
  };

  // Context Menu
  const handleContextMenu = (e: React.MouseEvent, key: string) => {
    e.preventDefault();
    setContextMenuRef({ x: e.clientX, y: e.clientY, key });
  };

  const closeContextMenu = () => {
    setContextMenuRef(null);
  };

  // Auto-close context menu on click outside
  useEffect(() => {
    document.addEventListener('click', closeContextMenu);
    return () => document.removeEventListener('click', closeContextMenu);
  }, []);

  const menuItems: MenuProps['items'] = [
    {
      key: 'close',
      label: '关闭当前',
      onClick: () => {
        if (contextMenuRef) {
          removeTab(contextMenuRef.key);
          const next = useTabStore.getState();
          navigate(next.activeKey || '/dashboard');
        }
      },
    },
    {
      key: 'closeOthers',
      label: '关闭其他',
      onClick: () => {
        if (contextMenuRef) {
          closeOthers(contextMenuRef.key);
          if (contextMenuRef.key !== location.pathname) navigate(contextMenuRef.key);
        }
      },
    },
    {
      key: 'closeAll',
      label: '全部关闭',
      onClick: () => {
        closeAll();
        navigate('/dashboard');
      },
    },
  ];

  return (
    <div className="w-full h-full flex flex-col bg-white min-w-0 overflow-hidden">
      <div className="flex-1 w-full relative min-w-0 min-h-0 overflow-hidden flex flex-col">
        <Tabs
          hideAdd
          className="w-full h-full flex-1 custom-layout-tabs px-4 pt-2 flex flex-col overflow-hidden"
          onChange={onChange}
          activeKey={activeKey}
          type="editable-card"
          onEdit={onEdit}
          renderTabBar={(tabBarProps, DefaultTabBar) => (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={tabs.map((i) => i.key)} strategy={horizontalListSortingStrategy}>
                <DefaultTabBar {...tabBarProps}>
                  {(node) => {
                    const tabKey = (node as React.ReactElement).key as string;
                    // Make it wrapper div for context menu and dnd
                    return (
                      <DraggableTabNode {...(node.props as DraggableTabPaneProps)} key={tabKey}>
                        <div onContextMenu={(e) => handleContextMenu(e, tabKey)}>
                          {node}
                        </div>
                      </DraggableTabNode>
                    );
                  }}
                </DefaultTabBar>
              </SortableContext>
            </DndContext>
          )}
          items={tabs.map((tab) => ({
            key: tab.key,
            label: (
              <span title={tab.title} className="truncate max-w-[120px] inline-block align-bottom">
                {tab.isModified ? <span className="text-red-500 mr-1">*</span> : null}
                {tab.title}
              </span>
            ),
            children: (
              <div className="tab-page-wrapper">
                {/* Find the corresponding element for the tab's path */}
                {routeElements[tab.path] || <div className="p-8 text-center text-gray-500">页面未找到 404</div>}
              </div>
            ),
            closable: true,
          }))}
        />
      </div>
      
      {/* Context Menu Dropdown Overlayer */}
      {contextMenuRef && (
        <Dropdown
          menu={{ items: menuItems }}
          open={true}
          trigger={['click']}
        >
          <div
            style={{
              position: 'fixed',
              top: contextMenuRef.y,
              left: contextMenuRef.x,
              width: 1,
              height: 1,
              zIndex: 9999,
            }}
          />
        </Dropdown>
      )}
    </div>
  );
};

export default TabLayout;
