# WMS Backend 联调文档（当前可用）

## 基础信息

- Base URL: `http://localhost:3001/api/v1`
- Swagger: `http://localhost:3001/api/docs`
- 统一成功响应：
```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```
- 分页响应会附带：
```json
{
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 100
  }
}
```

---

## Auth

### 1) 登录
`POST /auth/login`
```json
{
  "email": "admin@wms.com",
  "password": "password"
}
```

### 2) 刷新 Token
`POST /auth/refresh`
```json
{
  "refreshToken": "xxx"
}
```

### 3) 获取当前用户
`GET /auth/me`
- Header:
  - `Authorization: Bearer <accessToken>`

### 4) 登出
`POST /auth/logout`
```json
{
  "refreshToken": "xxx"
}
```

### 5) 修改密码
`PUT /auth/change-password`
- Header:
  - `Authorization: Bearer <accessToken>`
```json
{
  "oldPassword": "password",
  "newPassword": "new-password"
}
```

---

## Customers

### 1) 列表
`GET /customers?page=1&pageSize=20&keyword=&status=ACTIVE`

### 2) 创建
`POST /customers`
```json
{
  "customerCode": "CX-9001",
  "name": "测试客户",
  "contactName": "李四",
  "phone": "13800000000",
  "level": "VIP",
  "creditLimit": 5000
}
```

### 3) 详情
`GET /customers/:id`

### 4) 更新
`PUT /customers/:id`
```json
{
  "name": "新客户名"
}
```

### 5) 删除
`DELETE /customers/:id`

### 6) 状态变更
`PUT /customers/:id/status`
```json
{
  "status": "INACTIVE"
}
```

---

## Products

### 1) 列表
`GET /products?page=1&pageSize=20&sku=SKU&name=壳&customerId=CUST-001`

### 2) 创建
`POST /products`
```json
{
  "sku": "SKU-Z001",
  "name": "新品",
  "customerId": "CUST-001",
  "customerName": "深圳市大卖贸易有限公司",
  "unit": "个"
}
```

### 3) 详情
`GET /products/:id`

### 4) 更新
`PUT /products/:id`

### 5) 删除
`DELETE /products/:id`

---

## Receiving Orders

### 1) 列表
`GET /receiving-orders?page=1&pageSize=20&status=RECEIVING&customerName=深圳`

### 2) 创建
`POST /receiving-orders`
```json
{
  "customerName": "深圳市大卖贸易有限公司",
  "trackingNo": "SF123456",
  "expectedQuantity": 50
}
```

### 3) 详情
`GET /receiving-orders/:id`

### 4) 收货扫描
`PUT /receiving-orders/:id/receive`
```json
{
  "sku": "SKU-A001",
  "qty": 5,
  "locationId": "LOC-1"
}
```

### 5) 完成收货（自动生成上架任务）
`PUT /receiving-orders/:id/complete`

### 6) 标记异常
`POST /receiving-orders/:id/exception`
```json
{
  "reason": "外箱破损"
}
```

---

## Putaway Tasks

### 1) 列表
`GET /putaway-tasks?page=1&pageSize=20&status=PENDING`

### 2) 执行上架
`PUT /putaway-tasks/:id/putaway`
```json
{
  "locationId": "LOC-1",
  "qty": 10
}
```

---

## Inventory

### 1) 列表
`GET /inventory?page=1&pageSize=20&sku=SKU-A001&locationCode=A-01`

### 2) 汇总
`GET /inventory/summary`

### 3) 调整
`POST /inventory/adjust`
```json
{
  "sku": "SKU-A001",
  "locationCode": "A-01-03",
  "deltaQty": 5,
  "reason": "盘盈"
}
```

---

## Locations

### 1) 列表
`GET /locations?floor=1&status=OCCUPIED`

### 2) 新建
`POST /locations`
```json
{
  "code": "E-01-01",
  "row": "E",
  "col": 1,
  "floor": 1,
  "status": "EMPTY"
}
```

### 3) 更新
`PUT /locations/:id`

### 4) 删除
`DELETE /locations/:id`

---

## Dashboard

### 1) 核心统计
`GET /dashboard/stats`

### 2) 趋势图
`GET /dashboard/trend?days=7`

### 3) 待办聚合
`GET /dashboard/todos`

### 4) 仓库利用率
`GET /dashboard/warehouse-utilization`

---

## 启动说明

```bash
cd wms-backend
npm install
npm run start:dev
```

默认端口 3001。