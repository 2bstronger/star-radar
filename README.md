# ⭐ 开源项目雷达

把你的 GitHub starred 仓库变成一份**可筛选、有元数据、中文可读**的开源项目雷达。

- 📊 元数据：语言占比条形图、License、star/fork、创建与最近推送、最热 open issue
- 🇨🇳 中文四件套：一句话定位 / 2–3 句简介 / 适用场景 / 快速上手命令（LLM 生成，增量缓存）
- 🔀 中英切换：中文看定位，点开抽屉核对英文原文，不被翻译误导
- 🆓 全 GitHub 免费资源：Actions 定时更新 + Pages 部署，**仓库本身就是数据库**（git log 即数据变更历史）

## 架构

```
┌─ GitHub Actions（每天北京 03:30）────────────────────┐
│ ① fetch_stars.mjs   GraphQL 抓全部 star + 元数据      │
│ ② translate.mjs     LLM 增量翻译（缓存，翻过不重翻）   │
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

## 免费额度账单

| 资源 | 用量 | 额度 |
|---|---|---|
| Actions（公开仓库） | 每天 ~5 分钟 | 无限免费 |
| Pages | 静态站 | 免费 |
| 仓库存 JSON | 619 star ≈ 2–3MB | 500MB |
| GitHub API | ~7 次 GraphQL + 增量 README | 5000/小时 |
| LLM | 首次全量 619 条，之后每天增量 | 取决于所选模型 |

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
