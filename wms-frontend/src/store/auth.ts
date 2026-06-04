import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UserInfo {
  id: string;
  name: string;
  role: string;
  avatar?: string;
}

interface AuthState {
  token: string | null;
  userInfo: UserInfo | null;
  warehouseId: string | null;
  setToken: (token: string) => void;
  setUserInfo: (info: UserInfo) => void;
  setWarehouseId: (id: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      userInfo: null,
      warehouseId: 'WH-SHENZHEN-001', // Default selected warehouse ID

      setToken: (token) => {
        set({ token });
      },

      setUserInfo: (userInfo) => {
        set({ userInfo });
      },

      setWarehouseId: (warehouseId) => {
        localStorage.setItem('warehouseId', warehouseId);
        set({ warehouseId });
      },

      logout: () => {
        localStorage.removeItem('warehouseId');
        set({ token: null, userInfo: null, warehouseId: null });
      },
    }),
    {
      name: 'wms-auth-storage', // Save state to localStorage automatically
    }
  )
);
