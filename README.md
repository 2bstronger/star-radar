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

## 翻译触发与迁移

每次运行逐个获取 README 的 GitHub blob SHA；只有新收藏（包括重新收藏）、缺少中文翻译或 README 内容变化时才调用 LLM。普通代码推送、描述和 topics 变化不会单独触发翻译。确认 README 不存在时记录稳定的 `none` 状态，创建或删除 README 也会触发翻译。README 获取失败不会替代已有指纹，翻译失败也不会确认新指纹，下次运行重试。未配置 LLM 时待翻译项目保留待处理状态。输入为 README 全文，翻译并发上限为 10。

升级后首次运行会将已有翻译项目的当前 README 指纹记为基线，不因缺少历史指纹重翻；缺少翻译的项目仍会处理。基线名单先持久化，部分请求失败后可继续建立基线。无法追溯判断基线建立以前 README 是否已经变化。`data/readme-state.json` 必须随数据一起保存；删除或丢失它会重新建立基线。重新收藏通过两次运行间的收藏状态或 GitHub 的 `starredAt` 变化识别；如果两者都无法观察到，就无法识别。

在 GitHub 仓库的 **Actions → Update & Deploy → 对应运行 → 翻译**步骤日志中查看每个待翻译仓库、触发原因和成功、失败或待重试状态；日志不包含 README 或模型回复。失败时会输出 warning 和失败数量，并在下次重试。为了保存已完成的进度，部分失败仍会正常退出，因此 Actions 作业成功不代表全部翻译成功。README 返回 404 时会额外检查仓库是否可访问，只有仓库可访问才确认 README 不存在。未配置 GitHub token 和完整 LLM 配置时，翻译会跳过；已配置 LLM 但缺少 token 时会报错。

每次约增加每个收藏仓库一次 README API 请求；README 元数据内容不完整或校验不符时，会按 blob SHA 额外请求 Git blob 原文，并验证字节长度和 SHA，失败则保留旧指纹并重试。网络错误会重试。加上收藏列表及每仓库语言和 issue 请求，约为每仓库 3 次请求（例如 619 个约 1864 次，未计重试），需留意 token 的 GitHub 限额和其他应用共享的用量。超过 API 对 README 的支持范围时项目会保持待重试，不会误写为空。

离线回归测试：`node --test test/translate.test.mjs`，使用临时数据和模拟网络，不需要密钥。

## 免费额度账单

| 资源 | 用量 | 额度 |
|---|---|---|
| Actions（公开仓库） | 每天 ~5 分钟 | 无限免费 |
| Pages | 静态站 | 免费 |
| 仓库存 JSON | 619 star ≈ 2–3MB | 500MB |
| GitHub API | ~7 次列表 + 每仓库约 3 次 REST 请求 | 通常 5000/小时，以实际 token 限额为准 |
| LLM | 缺少摘要时首次生成；已有摘要迁移只建立指纹，之后按 README 变化或新收藏增量更新 | 取决于所选模型 |

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
