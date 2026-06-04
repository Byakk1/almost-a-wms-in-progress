import axios from 'axios';
import { message } from 'antd';
import { useAuthStore } from '../store/auth';

const request = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  timeout: 10000,
});

// Request Interceptor
request.interceptors.request.use(
  (config) => {
    // Read token from the single source of truth (persisted zustand store) that
    // AuthRoute also trusts. Reading a separate localStorage 'token' key used to
    // desync from the store and surface as spurious 401s.
    const token = useAuthStore.getState().token;
    const warehouseId = localStorage.getItem('warehouseId');

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Add X-Warehouse-Id as specified in PRD API contracts
    if (warehouseId) {
      config.headers['X-Warehouse-Id'] = warehouseId;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response Interceptor
request.interceptors.response.use(
  (response) => {
    const { success, code, message: msg } = response.data || {};
    
    // Auto-handle structural API errors
    if (success === false || (code && code !== '0' && code !== 0)) {
      message.error(msg || 'API Request Failed');
      return Promise.reject(new Error(msg || 'Error'));
    }
    
    return response.data; // Return structural data directly usually { data }
  },
  (error) => {
    if (error.response) {
      switch (error.response.status) {
        case 401:
          message.error('Session expired, please login again.');
          // TODO: handle redirect to login
          break;
        case 403:
          message.error('Access denied. Insufficient permissions.');
          break;
        case 404:
          message.error('Resource not found.');
          break;
        case 500:
          message.error('Internal Server Error. Please contact support.');
          break;
        default:
          message.error(`Request Failed: ${error.message}`);
      }
    } else if (error.request) {
      message.error('Network Error. Please check your connection.');
    } else {
      message.error(`Error: ${error.message}`);
    }
    return Promise.reject(error);
  }
);

export default request;
