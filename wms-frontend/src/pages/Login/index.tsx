import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Form, Input, Button, message, Checkbox } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useAuthStore } from '../../store/auth';
import request from '../../utils/request';

const Login: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const setToken = useAuthStore((state) => state.setToken);
  const setUserInfo = useAuthStore((state) => state.setUserInfo);

  const from = location.state?.from?.pathname || '/dashboard';

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);

    try {
      const email =
        values.username.includes('@') ? values.username.trim() : `${values.username.trim()}@convex-wms.local`;

      const res = await request.post('/auth/login', {
        email,
        password: values.password,
      });

      const payload = res?.data;
      if (!payload?.accessToken) {
        throw new Error('登录返回缺少 accessToken');
      }

      message.success('登录成功');
      setToken(payload.accessToken);
      setUserInfo({
        id: payload.user?.id ?? '',
        name: payload.user?.name ?? values.username,
        role: payload.user?.role ?? 'OPERATOR',
      });
      navigate(from, { replace: true });
    } catch (error: any) {
      message.error(error?.response?.data?.message || error?.message || '账号或密码错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background bg-[url('https://images.unsplash.com/photo-1586528116311-ad8ed7c83a54?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80')] bg-cover bg-center">
      {/* Dark overlay for better contract */}
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"></div>
      
      <div className="relative z-10 w-full max-w-md p-8 glass-panel rounded-2xl shadow-2xl m-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-primary/10 text-primary mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
            </svg>
          </div>
          <h1 className="text-3xl font-heading font-bold text-slate-800">Cherry WMS</h1>
          <p className="text-slate-500 mt-2">仓储物流管理系统</p>
        </div>

        <Form
          name="login_form"
          className="login-form"
          initialValues={{ remember: true }}
          onFinish={onFinish}
          size="large"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入管理员账号!' }]}
          >
            <Input 
              prefix={<UserOutlined className="text-slate-400" />} 
              placeholder="Username or Email (admin)"
              className="rounded-lg hover:border-primary focus:border-primary"
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码!' }]}
          >
            <Input.Password
              prefix={<LockOutlined className="text-slate-400" />}
              type="password"
              placeholder="Password (123456)"
              className="rounded-lg hover:border-primary focus:border-primary"
            />
          </Form.Item>

          <Form.Item>
            <Form.Item name="remember" valuePropName="checked" noStyle>
              <Checkbox>记住我</Checkbox>
            </Form.Item>
            <a className="float-right text-primary hover:text-primary-light" href="">
              忘记密码？
            </a>
          </Form.Item>

          <Form.Item className="mb-0">
            <Button 
              type="primary" 
              htmlType="submit" 
              className="w-full h-12 rounded-lg text-base font-medium shadow-md hover:-translate-y-0.5 transition-transform" 
              loading={loading}
              style={{ backgroundColor: '#D23148' }}
            >
              登 录
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  );
};

export default Login;
