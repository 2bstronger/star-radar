# ⭐ 开源项目雷达

把你的 GitHub starred 仓库变成一份**可筛选、有元数据、中文可读**的开源项目雷达。

- 📊 元数据：语言占比条形图、License、star/fork、创建与最近推送、最热 open issue
- 🇨🇳 中文四件套：一句话定位 / 2–3 句简介 / 适用场景 / 快速上手命令（LLM 生成，增量缓存）
- 🔀 中英切换：中文看定位，点开抽屉核对英文原文，不被翻译误导
- 🆓 全 GitHub 免费资源：Actions 定时更新 + Pages 部署，**仓库本身就是数据库**（git log 即数据变更历史）

## 架构

```
┌─ GitHub Actions（每天北京 03:30）────────────────────┐
│ ① fetch_stars.mjs   REST 抓全部 star + 元数据         │
│ ② translate.mjs     按 README 内容增量翻译            │
│ ③ sync_data.mjs     data/*.json → web/public/data/   │
│ ④ 提交数据 → 构建 → 部署 GitHub Pages                │
└─────────────────────────────────────────────────────┘
```

## 目录结构

```
scripts/    零依赖 Node 脚本（fetch / translate / sync）
data/       抓取与翻译产物（git 跟踪，仓库即数据库）
web/        Vue 3 + Vite + Tailwind 前端
.github/    Actions 工作流（定时更新 + Pages 部署）
```

## 本地开发

```bash
# 1. 配置环境变量
cp .env.example .env   # 填入 GITHUB_TOKEN，LLM 可选

# 2. 抓取 + 翻译 + 同步（node 22+）
node --env-file=.env scripts/fetch_stars.mjs
node --env-file=.env scripts/translate.mjs
node scripts/sync_data.mjs

# 3. 前端
cd web && npm install && npm run dev
```

不带数据也能开发：`web/public/data/` 里有 10 条 mock 数据，`npm run dev` 直接可跑。

## 首次部署（全免费）

1. 在 GitHub 创建**公开**仓库并 push 本项目
2. 仓库 Settings → Pages → Source 选 **GitHub Actions**
3. 仓库 Settings → Secrets and variables → Actions 添加：
   - `GH_PAT`（必需）：fine-grained PAT，权限 **Metadata: read + Starring: read**（Account permissions）
   - `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`（可选）：OpenAI 兼容接口，如智谱 `https://open.bigmodel.cn/api/paas/v4` + `glm-5.3-flash`；不配则新项目先显示英文，之后补翻
4. Actions 页手动 Run workflow 一次，之后每天自动更新

## 中文摘要更新

- **新收藏、重新收藏或缺少中文摘要**的项目在当前运行进入翻译队列。重新收藏通过收藏状态或 GitHub 的 `starredAt` 变化识别。
- **已有摘要**的项目将当前 README 与上次成功翻译的版本比较。对比时忽略常见徽章、统计图、明确标出的星数列、更新时间、已知的自动生成展示区块和普通空白变化。`GitHub520` 的自动生成 Hosts 列表也会忽略，获取和配置说明会参与比较。
- 安装、快速上手或配置等关键内容的变化可以触发更新。其他正文累计增删至少 **150 个非空白字符**才会更新，替换一个字算一次删除和一次新增。新增或移除 README 也属于可更新变化。
- 仅因 README 更新触发时，每个仓库**滚动 7 天最多安排一轮**。冷却从该轮首个模型请求前记下的时间起算，旧记录使用上次成功翻译时间。窗口内的改动累积，到期会在下一次工作流运行时用最新版本重评。失败的翻译保留旧摘要和指纹，README 更新也按此间隔重试。

入选的项目会把原始 README 全文发给模型。模型请求使用原有 JSON 响应格式，最多并行处理 10 个项目。缺少模型配置时，候选项目继续等待。

`data/readme-state.json` 保存上次成功处理的 README 指纹和翻译轮次。升级复用已有指纹。状态文件首次建立时，已有摘要的项目以当时的 README 为基线，基线之前的变化无法追溯。忽略、等待和失败的检查会继续使用原基线。

GitHub **Actions → Update & Deploy → 对应运行 → 翻译**的日志列出入选项目、原因和结果，最后汇总展示变化、小改动、冷却等待和失败数。遇到部分失败时工作流仍会保存已完成的结果，详情见日志中的 warning。

每个收藏项目通常需约 3 次 GitHub REST 请求来检查 README、语言和 Issue。README 指纹变了且需要比较时，会按保存的 SHA 读取历史 Git blob。GitHub 返回的正文不完整时也会请求完整 blob 并核对 SHA。历史内容暂时不可读时保留已有摘要，等后续运行再检查。README 返回 404 时会额外检查仓库是否可访问。

运行 `node --test test/readme-policy.test.mjs test/translate.test.mjs` 可离线验证筛选和翻译流程。

## 免费额度账单

| 资源 | 用量 | 额度 |
|---|---|---|
| Actions（公开仓库） | 每天 ~5 分钟 | 无限免费 |
| Pages | 静态站 | 免费 |
| 仓库存 JSON | 619 star ≈ 2–3MB | 500MB |
| GitHub API | ~7 次列表 + 每仓库约 3 次 REST 请求 | 通常 5000/小时，以实际 token 限额为准 |
| LLM | 新收藏或缺少摘要时生成。已有摘要按 README 变化增量更新，每个仓库最多每 7 天一轮 | 取决于所选模型 |

## 人工纠偏

LLM 分类或定位不满意时，编辑 `data/overrides.json`（优先级最高，push 后自动生效）：

```json
{
  "owner/repo": {
    "categories": ["效率工具"],
    "positioning": "我想强调的一句话定位",
    "pin": true
  }
}
```

## 中英切换说明

中文模式：卡片与抽屉显示 LLM 生成内容；抽屉底部"原文核对"默认折叠。
EN 模式：卡片显示原始 description，抽屉自动展开原文区（description + topics）。
