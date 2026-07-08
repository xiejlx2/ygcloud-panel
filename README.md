# 服务器控制台

一个多租户的服务器管理面板。管理员用上游云平台的 API 接入凭据接入自己的服务器资源，再按服务器维度把机器分配给下游客户；客户登录后只能查看和操作分配给自己的服务器。

- 管理员用 API 接入凭据接入自己在上游云平台的服务器资源。
- 管理员在面板内为客户创建账号，并按服务器维度做资源分配。
- 客户登录后只能看到和操作分配给自己的服务器。
- 面板不涉及任何购买、续费、变配、订单、余额、发票等资金功能。
- API 接入凭据只保存在服务端加密存储，绝不暴露给前端或客户。

---

## 技术栈

- Next.js 14（App Router）+ TypeScript
- Prisma ORM（默认 SQLite，可一行切 PostgreSQL）
- Tailwind CSS（Indigo 主题）
- bcryptjs（登录密码哈希）、jsonwebtoken（会话）、AES-256-GCM（凭据加密）
- zod（请求体校验）、swr（前端数据获取）

---

## 安全设计要点

- **凭据加密**：接入凭据经 AES-256-GCM 落库；任何前端接口都不返回明文，仅展示末 4 位。
- **接口白名单**：`lib/cloud.ts` 的 `ALLOWED_PATHS` 写死允许调用的上游接口；未列入的路径在后端直接拒绝，前端篡改无法绕过。
- **服务器权限校验**：所有 `/api/servers/:uuid/*` 都走 `assertCanAccessServer`；越权访问返回 403/404。
- **会话失效**：JWT 会话每次请求回查数据库状态，账号被禁用/删除即时失效。
- **路由保护**：`app/admin/layout.tsx` 与 `app/client/layout.tsx` 在服务端按角色重定向。
- **JWT httpOnly cookie**：会话不进入 localStorage/sessionStorage；SameSite=Lax 缓解 CSRF。
- **限流**：登录、开关机/重启、改密码、同步等均有频率限制。
- **审计**：登录、凭据增删、客户增删改、同步、分配、开关机重启、改密码均落 `operation_logs`。
- **安全响应头**：CSP（`frame-ancestors 'none'`）、X-Frame-Options、nosniff、Referrer-Policy、HSTS。

---

## 本地启动

```bash
npm install

# 生成密钥并写入 .env
cp .env.example .env
openssl rand -hex 32   # → TOKEN_ENCRYPTION_KEY
openssl rand -hex 48   # → JWT_SECRET
```

`.env` 至少需要：

```
PROVIDER_API_BASE=<上游云平台 OpenAPI 地址>
TOKEN_ENCRYPTION_KEY=<64 位 hex>
JWT_SECRET=<长随机串>
DATABASE_URL="file:./dev.db"
SEED_RESELLER_USERNAME=admin
SEED_RESELLER_PASSWORD=<强随机密码>
```

初始化数据库并创建管理员，然后启动：

```bash
npx prisma migrate dev --name init
npm run seed
npm run dev        # http://localhost:3000
```

首次登录后请：

1. **接入配置** → 填入 API 接入凭据 → 保存 → 立即校验。
2. **服务器** → 点击「同步服务器」拉取云端资源。
3. **客户** → 新建客户账号。
4. **服务器** 列表勾选机器 → 批量分配给客户。

---

## 环境变量

见 `.env.example`。关键项：

| 变量 | 说明 |
|------|------|
| `PROVIDER_API_BASE` | 上游云平台 OpenAPI 基础地址（必填，无默认值） |
| `TOKEN_ENCRYPTION_KEY` | 凭据加密密钥，64 位 hex（`openssl rand -hex 32`） |
| `JWT_SECRET` | JWT 签名密钥，长随机串 |
| `TRUST_PROXY_HEADERS` | 部署在可信反代（Nginx/Caddy/CF）后设 `true`，直连保持 `false` |
| `COOKIE_SECURE` | 生产默认强制 HTTPS；纯 HTTP 部署时才设 `false` |
| `DATABASE_URL` | SQLite 或 PostgreSQL 连接串 |

---

## 切换到 PostgreSQL

1. 部署 PostgreSQL（>= 12）。
2. `.env` 改 `DATABASE_URL="postgresql://user:password@host:5432/panel?schema=public"`。
3. `prisma/schema.prisma` 的 `provider` 由 `sqlite` 改为 `postgresql`。
4. `npx prisma migrate reset --force && npm run seed`。

---

## 生产部署（示例：Caddy + pm2）

```bash
npm ci
npm run build
pm2 start npm --name server-console -- run start -- -H 127.0.0.1 -p 3000
```

Caddy 反代（自动 HTTPS）：

```
your-domain.com {
    encode gzip zstd
    reverse_proxy 127.0.0.1:3000
}
```

> 反代后记得在 `.env` 设 `TRUST_PROXY_HEADERS=true`，IP 维度限流才能拿到真实客户端 IP。

### 生产部署安全注意事项

- **必须启用 HTTPS 并配置 `TRUST_PROXY_HEADERS=true`**：登录限流以客户端 IP 为主要防线。
  取不到 IP 时自动降级为“用户名维度 + 全局宽松兜底”，防爆破能力减弱，
  且攻击者可对已知用户名制造登录锁定。
- **限流为单实例内存实现**：多实例 / 集群部署时各实例各自计数，限流阈值会被放大 N 倍。
  水平扩容前需将 `lib/ratelimit.ts` 替换为 Redis 等集中式存储。
- **CSP 目前允许 `unsafe-inline` 脚本**（Next.js 注水所需）。如需更严格的策略，
  可引入基于 nonce 的中间件方案，改造时需回归验证页面正常注水。
- **重置客户密码会使其所有已登录会话立即失效**（`tokenVersion` 机制）；
  升级部署本版本后，所有存量会话需重新登录一次。

---

## 目录结构

```
app/            登录 / admin（概览·服务器·客户·分配·日志·接入配置）/ client（服务器·详情·记录）/ api
components/     Shell / Logo / Toast / Modal / ConfirmDialog / Skeleton / 图标 等通用 UI
lib/            prisma / env / auth / crypto / password / permissions / cloud / audit / ratelimit / api
prisma/         schema.prisma + seed.ts
```
