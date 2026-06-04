# WMS 后端梳理（基于 PRD + 当前前端进度）

## 1) 项目现状结论

- 当前仓库内已存在两个前端相关工程：`wms-frontend`（主业务前端）与 `my-app`（Convex 示例工程）。
- `wms-frontend` 已按照 PRD 结构完成大量页面骨架，但绝大多数页面仍在使用 Mock 数据。
- `my-app/convex/schema.ts` 仅有演示级模型（`users`、`numbers`），不具备承载 WMS 业务复杂度的能力。

**结论：后端应按任务文档要求，采用独立服务实现（NestJS + Prisma + PostgreSQL），而非继续扩展 Convex 示例工程。**

---

## 2) 已验证的前后端契约关键点

### 基础请求约定（前端已内置）
- Base URL：`/api/v1`（可由环境变量覆盖）
- 认证头：`Authorization: Bearer <token>`
- 仓库上下文头：`X-Warehouse-Id`

### 关键文件证据
- 前端请求封装已注入认证与仓库头：`wms-frontend/src/utils/request.ts`
- 路由与页面矩阵（可反推模块优先级）：`wms-frontend/src/App.tsx`
- 代表性页面均为 Mock 数据：
  - 客户管理：`wms-frontend/src/pages/Customer/index.tsx`
  - 收货管理：`wms-frontend/src/pages/Inbound/index.tsx`
  - 库存查询：`wms-frontend/src/pages/Warehouse/index.tsx`
  - 库位大屏：`wms-frontend/src/pages/Warehouse/Location/index.tsx`
  - 按单打包：`wms-frontend/src/pages/Outbound/Packing/index.tsx`
  - 账单生成：`wms-frontend/src/pages/Fee/BillingGen/index.tsx`
  - Dashboard：`wms-frontend/src/pages/Dashboard/index.tsx`

---

## 3) 与前端完成度匹配的后端 P0 实施切片（建议按此落地）

> 目标：先把「可联调、可跑主流程」打通，再补全长尾模块。

### Slice A（基础可用）
1. Auth（登录/刷新/me）
2. Customers（列表/增删改查/状态）
3. Products（列表/增删改查）
4. Dashboard（stats/trend/todos）

### Slice B（入库主链路）
1. receiving-orders（列表/创建/详情/receive/complete）
2. putaway-tasks（列表/putaway）
3. inventory（查询/summary）
4. locations（列表）

### Slice C（出库主链路）
1. outbound-orders（列表/详情）
2. picking-lists（列表）
3. outbound-orders/:id/pack（按单打包）
4. outbound-exceptions（问题件列表）

### Slice D（费用与运营基础）
1. fee/calculate（运费试算）
2. bills（账单列表）
3. system/dictionaries（基础配置）
4. transit-orders（中转单列表）

---

## 4) 数据模型最小闭环（首批必须建表）

- User / Role / Warehouse
- Customer / CustomerTransaction / CreditApplication
- Product / SerialNumber
- ReceivingOrder / ReceivingItem / PutawayTask
- Inventory / Location / WarehouseZone
- OutboundOrder / OutboundItem / PickingList
- CustomerBill / BillItem
- Announcement / Notification（可后置）

---

## 5) API 响应统一规范（与任务文档保持一致）

- 成功：`{ code: 0, message: "success", data, pagination? }`
- 失败：`{ code: <error_code>, message: "<desc>", data: null }`

---

## 6) 技术路线确认

- 独立目录新建：`wms-backend/`
- 技术栈：NestJS + Prisma + PostgreSQL
- 端口：3001
- API 前缀：`/api/v1`
- Swagger：`/api/docs`
- CORS 放行：`http://localhost:5173`

---

## 7) 下一步执行清单（紧接开发）

1. 初始化 `wms-backend` Nest 工程与依赖
2. 搭建 Prisma schema（先覆盖 P0 首批模型）
3. 落地 Auth + Customers + Products + Dashboard
4. 落地 Receiving + Putaway + Inventory + Locations
5. 提供 Swagger + Postman 联调集合 + README
