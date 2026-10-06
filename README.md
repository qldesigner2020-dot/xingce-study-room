# 行测练习室

GitHub Pages 上的个人行测练习工具。宋体题面、实时计时、整题手写、排除选项、收藏、自评、复盘描述，以及直接下载带图试题 / 复盘 PDF。

练习记录由 Supabase 保存，数据库只允许获准的练习账号访问自己的记录。断网时暂存在当前电脑，重连后补传；同时修改同一记录时保留内容并提示处理冲突。网站源码不包含考生的历史记录、备份、密码或管理密钥。

## 开发

Node.js 22 或更高版本：

```sh
npm ci
npm test
npm run build
```

`client/` 是静态应用源码；`src/backend.js` 是登录与 Supabase 适配器；`client/assets/cloud-sync.js` 是记录同步逻辑。原来的本地离线版独立保留。

## 配置与发布

1. 在新的 Supabase 项目 SQL Editor 执行 `supabase/schema.sql`。
2. 以管理员身份向 `study_accounts` 添加本人练习邮箱，其他邮箱不会获得记录同步权限。
3. 在 Supabase Authentication URL Configuration 设置本站 URL 和同地址的 Redirect URL。浏览器使用 PKCE 流程。
4. 在仓库 Actions variables 设置 `SUPABASE_URL` 与 `SUPABASE_PUBLISHABLE_KEY`（仅浏览器 publishable key）。
5. 仓库 Pages 选择 GitHub Actions，推送 main 后运行 pages.yml。

首次使用在网站创建练习账号并确认邮箱；在家和公司使用同一练习账号。Supabase 控制台管理账号和网站练习账号分别使用各自的登录流程。数据库管理密钥与 service_role key 不能进入源码或网页。

首次迁移记录：本地「练习记录 → 导出完整备份」，在线「练习记录 → 导入完整备份」。首次登录前的本机练习也会保留为可下载备份，不自动归入其他账号。

## 数据库测试

`npm test` 使用 PGlite 执行实际 PostgreSQL schema 和函数，覆盖未登录拒绝、练习邮箱限制、两个账号隔离、版本冲突整批回滚、删除墓碑、数据校验、禁止直接读表。测试为独立内存数据库，不连接生产记录。

PDF 生成器与字体的许可文件位于 `client/assets/vendor/`；题库内容保留原来源与题号。正式发布只使用 client 源码与构建出的静态文件，测试脚本、源地图和个人备份不会进入 Pages 网站。
