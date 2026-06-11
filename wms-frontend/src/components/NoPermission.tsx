import { Result } from 'antd';

// 403 placeholder rendered in a tab when the current role may not view that route.
const NoPermission = () => (
  <div className="p-8">
    <Result status="403" title="403" subTitle="抱歉，您没有访问该页面的权限。" />
  </div>
);

export default NoPermission;
