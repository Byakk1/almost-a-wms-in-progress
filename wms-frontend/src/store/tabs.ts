import { create } from 'zustand';

export interface TabItem {
  key: string;       // Usually the path, used as unique ID
  title: string;     // Display title
  path: string;      // The actual URL path
  isModified?: boolean; // Whether the tab has unsaved changes
}

interface TabState {
  tabs: TabItem[];
  activeKey: string;
  addTab: (tab: TabItem) => void;
  removeTab: (targetKey: string) => void;
  setActiveKey: (key: string) => void;
  closeAll: () => void;
  closeOthers: (targetKey: string) => void;
  setTabs: (tabs: TabItem[]) => void;
  updateTabState: (key: string, isModified: boolean) => void;
}

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeKey: '',
  
  addTab: (tab) => {
    const { tabs } = get();
    // Check if tab already exists
    const exists = tabs.find((t) => t.key === tab.key);
    if (!exists) {
      set({ tabs: [...tabs, tab], activeKey: tab.key });
    } else {
      set({ activeKey: tab.key });
    }
  },

  removeTab: (targetKey) => {
    const { tabs, activeKey } = get();
    let newActiveKey = activeKey;
    let lastIndex = -1;

    tabs.forEach((item, i) => {
      if (item.key === targetKey) {
        lastIndex = i - 1;
      }
    });

    const newTabs = tabs.filter((item) => item.key !== targetKey);

    if (newTabs.length && newActiveKey === targetKey) {
      if (lastIndex >= 0) {
        newActiveKey = newTabs[lastIndex].key;
      } else {
        newActiveKey = newTabs[0].key;
      }
    } else if (!newTabs.length) {
      newActiveKey = '';
    }

    set({ tabs: newTabs, activeKey: newActiveKey });
  },

  setActiveKey: (key) => {
    set({ activeKey: key });
  },

  closeAll: () => {
    // We optionally keep a default tab open or nothing
    set({ tabs: [], activeKey: '' });
  },

  closeOthers: (targetKey) => {
    const { tabs } = get();
    const currentTab = tabs.find(t => t.key === targetKey);
    if (currentTab) {
      set({ tabs: [currentTab], activeKey: targetKey });
    }
  },

  setTabs: (newTabs) => {
    set({ tabs: newTabs });
  },
  
  updateTabState: (key, isModified) => {
    set((state) => ({
      tabs: state.tabs.map(tab => 
        tab.key === key ? { ...tab, isModified } : tab
      )
    }));
  }
}));
