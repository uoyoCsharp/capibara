---
doc_type: 'website-proposal'
project: 'capibara'
version: 'v1.0'
author: 'John (PM) + uoyo'
date: '2026-05-08'
status: 'approved-for-prd'
---

# Capibara 官网设计提案 v1.0

> **状态**：已与 `uoyo` 对齐核心方向，本文档作为后续 PRD 与开发的基线。

---

## 1. 项目背景与目标

### 1.1 背景

- Capibara 是一款桌面级 AI 工作台应用（Electron + React + SQLite，本地优先）。
- 当前 v0.1.0-rc.2，通过 GitHub Releases 分发 Windows / Linux 安装包。
- 目前用户只能从 GitHub Releases 页面下载，对**非开发者用户**门槛较高，且缺少品牌与产品介绍的统一入口。

### 1.2 本次目标

**一句话**：搭建 Capibara 的官方网站，让潜在用户能快速了解产品并下载安装。

**核心成功指标（Primary KPI）**：
1. 官网 → 下载按钮点击 → GitHub Release 资产下载的**转化率**。
2. 官网的**首屏跳出率** < 60%。
3. Google 搜索 "capibara AI / capibara 工作台 / capibara 下载" 等关键词能命中官网（3 个月内）。

**次要指标**：
- 月访问 UV 增长趋势。
- GitHub Star 来源中 "官网" 占比。

### 1.3 非目标（Out of Scope）

本次 MVP **不做**：
- 博客 / 内容系统（CMS）
- 用户账号 / 登录 / 后台
- 付费订阅 / License 管理
- 社区论坛 / 评论
- 在线试用 / Web Demo
- Newsletter 订阅（先不做邮箱采集）
- Analytics / 用户行为追踪（先不做）

这些需求在 Phase 2+ 再评估。

---

## 2. 目标用户

### 2.1 用户画像

**主要用户**：**任何需要用 AI 完成任务的普通人** — 不限职业、不限场景。

**锚点用户群**（用于内容设计的锚点，并非排他）：
- **独立创作者 / 自由职业者**：写作、研究、设计、内容生产
- **小团队 Lead / 产品经理**：项目管理、需求拆解、文档撰写
- **学生 / 研究者**：学习辅助、论文研究、资料整理
- **开发者 / 技术人**：编程辅助、文档生成、自动化脚本

**共同特征**：
- 有使用 ChatGPT / Claude / 其他 AI 产品的经验
- 对"只会聊天的 AI"感到不够用，期望 AI 能更像"做事的工具"
- 愿意在桌面安装应用，接受本地数据存储

### 2.2 用户场景

| 场景 | 用户触达路径 |
|------|-------------|
| 从别人分享的链接点进来 | 社交媒体 / 聊天群 |
| 主动搜索 "桌面 AI 工作台 / AI Agent 协同" | 搜索引擎 |
| 从 GitHub 仓库点"官网"链接 | GitHub README |
| 看到博主 / YouTuber 介绍 | 内容平台 |

---

## 3. 核心定位与文案

### 3.1 产品定位（官网叙事主线）

> **Capibara 是一个桌面 AI 工作台 — 创建 AI 组织、设计工作流，让多个 AI Agent 像真团队一样分工协作，完成任何事。**

### 3.2 差异化卖点（Key Differentiators）

| # | 卖点 | 对谁说 | 证据 |
|---|------|--------|------|
| 1 | **AI 组织化协作**：不是聊天，而是组建团队 | 所有用户 | `capibara:org:*` IPC、多 Agent 架构 |
| 2 | **工作流驱动**：像画流程图一样安排任务执行路径 | 有结构化需求的用户 | workflow-engine 模块 |
| 3 | **本地优先，数据在你手上**：SQLite 本地存储，无云端强绑 | 注重隐私的用户 | better-sqlite3 本地库 |
| 4 | **桌面原生体验**：Windows / Linux，离线可用 | 跨平台用户 | Electron 打包 |
| 5 | **开源免费**：代码开放，无订阅 | 技术社区 | GitHub 仓库 |

### 3.3 核心文案（基于方向 🅰：团队隐喻派）

**Hero 主标题**：
> **给 AI 组个团队。**

**Hero 副标题**：
> Capibara 是一个桌面 AI 工作台 — 创建组织、设计工作流，让多个 AI Agent 像真团队一样分工协作，完成任何事。

**Hero 标签行**：
> 免费 · 开源 · 数据本地存储 · v0.1.0

**Final CTA**：
> 准备好组建你的 AI 团队了吗？

---

## 4. 网站信息架构

### 4.1 站点地图（MVP）

```
capibara.[tbd]
│
├─ /                首页（核心转化页）
├─ /download        下载页（按平台分发）
└─ /changelog       发布日志（从 GitHub Releases 动态拉取）
```

**MVP 只做 3 个页面**。`/docs`、`/blog`、`/about` 等放 Phase 2。

### 4.2 全局导航

**顶部 Nav（所有页面一致）**：
```
[Logo + Capibara]                     Docs   GitHub   [Download ↓]
```

- **Docs** → 暂时指向 GitHub README（未来指向独立文档站）
- **GitHub** → `https://github.com/uoyoCsharp/capibara`
- **Download** → `/download` 或直接锚点到首屏下载区

**页脚 Footer**：
```
Capibara · Open Source AI Workstation
├ Product:     Download · Changelog · GitHub
├ Resources:   Docs · Release Notes
├ Community:   GitHub Issues · Discussions
└ Legal:       License (MIT/Apache, tbd) · Privacy
```

### 4.3 语言支持

- **中英双语**：`en-US` / `zh-CN`，与 Electron 客户端一致
- **默认语言**：根据浏览器 `Accept-Language` header 自动判断，用户可手动切换
- **URL 策略**：`/` 为默认语言，`/zh` 或 `/en` 为切换后的路径（具体方案见技术选型章节）

---

## 5. 页面详细设计

### 5.1 首页 `/`

**目标**：3 秒内让用户理解 Capibara 是什么 + 是否对他有用 + 如何下载。

**页面结构（从上到下）**：

#### Section 1 — Hero 区
- **主标题**：给 AI 组个团队。
- **副标题**：Capibara 是一个桌面 AI 工作台 — 创建组织、设计工作流，让多个 AI Agent 像真团队一样分工协作，完成任何事。
- **主 CTA**：[▼ Download for Windows] [Download for Linux]
  - 按钮下方小字：免费 · 开源 · 数据本地存储 · v0.1.0
- **自动检测 OS**：用 `navigator.userAgent` 高亮用户当前平台的下载按钮
- **视觉资产**：产品截图 / 演示 GIF（资产待补）

#### Section 2 — 核心概念卡片区（3 卡）
```
🏢 组织              🔀 工作流           🤝 多 Agent 协同
把相关 Agent 组织     像画流程图一样      每个 Agent 有角色、
在一起，共用上下文    安排任务执行路径     有分工，独立又协作
和数据                和决策点
```

#### Section 3 — 产品演示区
- 60~90 秒视频 **或** 长 GIF 组合
- 展示流程：创建组织 → 设计工作流 → Agent 协同执行 → 拿到交付物
- **资产待补**（开发前需要）

#### Section 4 — "可以用来做什么" 场景矩阵（6 格）
```
✍️ 写作 & 内容生产     📚 研究 & 学习
💻 编程 & 开发         📊 分析 & 决策
📋 项目 & 任务管理     🧠 任何场景
```

每格点击后可展开一段简短用例描述（Phase 2 做，MVP 静态即可）。

#### Section 5 — "为什么选 Capibara" 差异化区
```
🏠 本地优先          🔓 开源免费         🖥️ 桌面原生
数据存在你电脑，       代码完全开放          Windows / Linux
不上传云端            无订阅无限制          原生性能
```

#### Section 6 — Final CTA 区
- 大标题：准备好组建你的 AI 团队了吗？
- 按钮：[▼ 立即下载] [查看 GitHub]

#### Section 7 — Footer
见 4.2。

---

### 5.2 下载页 `/download`

**目标**：零摩擦让用户拿到安装包。

**页面结构**：

#### Section 1 — 智能下载区
```
┌─────────────────────────────────────────────┐
│  [自动检测：Windows 11 x64]                  │
│                                               │
│  ▼ Capibara Setup 0.1.0.exe (推荐)           │
│     大小 ~120MB · 支持自动更新                │
└─────────────────────────────────────────────┘
```

**逻辑**：
- 通过 `navigator.userAgent` / `navigator.platform` 检测 OS 与架构
- 高亮推荐版本，其他版本折叠在"其他平台"
- 下载链接直连 GitHub Release 资产的 `latest` 别名：
  - `https://github.com/uoyoCsharp/capibara/releases/latest/download/Capibara-Setup-{version}.exe`
- **版本号**：通过 GitHub Releases API 在构建/运行时动态获取

#### Section 2 — 其他平台下载
列表形式展示所有可用构件（参考 `docs/release-runbook.md`）：

**Windows**
- Capibara Setup {ver}.exe (x64)
- Capibara Setup {ver}-arm64.exe

**Linux**
- Capibara-{ver}.AppImage (x64)
- Capibara-{ver}-arm64.AppImage
- capibara_{ver}_amd64.deb

**macOS**：暂时不提（Mac 支持待后续评估）

**其他**：链接跳转 GitHub Releases 查看全部历史版本。

#### Section 3 — 系统要求
- Windows 10+ (x64 / ARM64)
- Linux 主流发行版 (Ubuntu 20.04+, Debian 11+)
- 磁盘 ~500MB · 内存 ≥ 4GB

#### Section 4 — 安装提示 / 故障排查
- **Windows SmartScreen 提示怎么办**？点 "更多信息 → 仍要运行"（已知问题，未做代码签名 — 参考 release-runbook）
- **安装后如何启动 / 初次设置**
- **如何更新到新版本**：客户端自带自动更新，无需手动下载（指向 release-runbook §4）
- **遇到问题？** → 跳转 GitHub Issues

---

### 5.3 Changelog 页 `/changelog`

**目标**：让用户查看产品迭代历史、当前版本、新功能。

**数据源**：GitHub Releases API

- 构建时（SSG）调用 `GET /repos/uoyoCsharp/capibara/releases` 拉取所有 release
- 按版本倒序展示
- 每条显示：版本号、发布时间、release note（Markdown 渲染）、下载入口
- 区分 stable / prerelease（与 release-runbook §6 一致）

**刷新策略**：每次 Vercel 重新构建时更新（后续可做 Webhook 触发 redeploy）。

---

## 6. 视觉 & 品牌方向

| 维度 | 方案 |
|------|------|
| **整体调性** | 温暖 + 技术感（参考 Linear / Raycast / Vercel） |
| **主色** | 暖色系（橙/棕），呼应 Capibara（水豚）品牌 — 具体色值待 UX 阶段确认 |
| **深色模式** | 支持（首发即支持，与 Electron 客户端一致） |
| **字体** | Inter（英文正文）+ Geist Sans（标题）+ 思源黑体 / PingFang（中文） |
| **图标** | lucide-react（shadcn/ui 默认），与 Electron 端 `@phosphor-icons/react` 风格兼容 |
| **动效** | 克制 — Hero 区一个微动效 + 按钮 hover；React Bits 做点睛不做炫技 |
| **Logo** | 复用 `images/logo.png`（需补足 SVG / 多尺寸版本） |

---

## 7. 技术选型（已确认）

### 7.1 技术栈

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  框架          Next.js 15 (App Router, Static Export)
  语言          TypeScript (strict mode)
  样式          Tailwind CSS v4
  UI 组件       shadcn/ui (基于 Radix UI)
  动效组件      React Bits（Hero 区亮点动效）
  图标          lucide-react
  字体          next/font 管理 Inter + Geist
  国际化        next-intl 或 App Router 原生 i18n routing
  包管理        pnpm
  部署          Vercel (Free Plan)
  域名          待定（稍后提供）
  仓库          新开独立仓库（不复用 capibara 主仓库）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 7.2 选型理由（关键决策记录）

| 选择 | 理由 |
|------|------|
| **Next.js 而非纯 Vite + React** | SEO 友好（SSG）、Open Graph 预览、Vercel 零配置、shadcn 官方栈 |
| **App Router 而非 Pages Router** | 新标准、Server Components 对静态内容更友好、未来性 |
| **Tailwind v4** | 与 Electron 端（Tailwind 4.2.1）对齐，降低心智 |
| **shadcn/ui** | 与 Electron 端 Radix UI 同源 — 视觉语言可复用，组件"复制进项目"而非 npm 依赖 |
| **独立仓库** | 官网部署节奏 ≠ 桌面应用发版节奏；降低耦合 |
| **Vercel Free Plan** | 100GB/月带宽够用一年，与 Next.js 天然集成 |

### 7.3 项目结构建议

```
capibara-website/
├── src/
│   ├── app/
│   │   ├── [locale]/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx              # 首页
│   │   │   ├── download/page.tsx     # 下载页
│   │   │   └── changelog/page.tsx    # Changelog
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/                        # shadcn/ui 组件
│   │   ├── sections/                  # 页面分区组件
│   │   │   ├── hero.tsx
│   │   │   ├── concepts.tsx
│   │   │   ├── demo.tsx
│   │   │   ├── use-cases.tsx
│   │   │   └── final-cta.tsx
│   │   └── shared/                    # Nav / Footer / OS 检测等
│   ├── lib/
│   │   ├── github.ts                  # GitHub Releases API 封装
│   │   ├── os-detect.ts               # 客户端 OS 检测
│   │   └── utils.ts
│   ├── i18n/
│   │   ├── en.json
│   │   └── zh.json
│   └── config/
│       └── site.ts                    # 站点元数据（title/desc/og）
├── public/
│   ├── images/
│   ├── videos/
│   └── favicon.ico
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
└── README.md
```

### 7.4 关键技术细节

**1. 下载链接策略**

直连 GitHub Release 的 `latest/download` 别名：
```
https://github.com/uoyoCsharp/capibara/releases/latest/download/<asset-name>
```

优势：
- 发新版本后官网**无需重新部署**
- 用户始终拿到最新稳定版

**2. 版本号获取**

构建时通过 GitHub API 获取：
```ts
// Next.js SSG / ISR
const res = await fetch('https://api.github.com/repos/uoyoCsharp/capibara/releases/latest', {
  next: { revalidate: 3600 }  // 每小时重新生成
});
```

**3. OS 自动检测**

客户端 `useEffect` 中基于 `navigator.userAgent` + `navigator.platform`：
- `Windows` → 默认高亮 Windows x64
- `Linux` → 默认高亮 Linux AppImage
- 其他 → 展示全部平台

**4. SEO**

- 每页配置 `<title>`、`<meta description>`、`<meta og:*>`
- `sitemap.xml` 自动生成（`next-sitemap` 或 Next.js 15 原生支持）
- `robots.txt` 允许全站爬取
- 中英文页面分别提交到 Google Search Console

**5. 性能预算**

- Lighthouse Performance ≥ 95（Desktop）
- Lighthouse Performance ≥ 90（Mobile）
- First Contentful Paint < 1.0s
- Largest Contentful Paint < 2.5s
- Total Blocking Time < 200ms

---

## 8. 开发路线图

### Phase 1 — MVP（预计 3–5 天有效工时）

| 天 | 内容 | 产出 |
|----|------|------|
| **Day 1** | 项目初始化 + shadcn 集成 + Tailwind 配置 + 布局骨架 | 新仓库 + 可本地 run 的空架子 |
| **Day 2** | 首页 Hero + 核心概念 + 场景矩阵 + 差异化区（无动效版） | 首页静态视觉成型 |
| **Day 3** | 下载页 + GitHub Releases API 集成 + OS 检测 | 下载流程打通 |
| **Day 4** | Changelog 页 + i18n（中英双语） + Footer / Nav | 三页面功能完整 |
| **Day 5** | React Bits 动效 + 响应式 + 性能调优 + Vercel 部署 | 上线 MVP |

### Phase 2 — 打磨（上线后 1–2 周）

- 产品演示视频 / GIF 补齐
- SEO 细化（结构化数据、OG 图片、Sitemap 提交搜索引擎）
- 响应式细节优化（移动端体验）
- 视觉微调（基于真实用户反馈）

### Phase 3 — 扩展（1–3 个月后视需求评估）

- `/docs` 独立文档站
- `/blog` 博客系统
- Mac 版本支持（同步客户端进度）
- 多语言扩展（日 / 韩 / 其他）
- Analytics 接入（Plausible / Umami）
- Newsletter 订阅

---

## 9. 风险与未决项

### 9.1 风险清单

| 风险 | 影响 | 缓解 |
|------|------|------|
| **视觉资产缺失**（产品截图 / 演示视频 / Logo SVG） | 首页显得空、转化低 | 开发并行 + UX Designer 介入，至少产出占位资产 |
| **"全场景"定位稀释记忆点** | 用户看完记不住是干嘛的 | "组织 + 工作流 + 团队隐喻" 主线压住，场景只做副卡 |
| **无 Mac 版本**，Mac 用户访问体验受损 | 损失部分流量 | 下载页做 Mac 检测 → 显示"Mac 版本开发中"（暂不留邮箱） |
| **Windows SmartScreen 提示** 导致用户流失 | 降低首装成功率 | 下载页 FAQ 明确说明，降低困惑 |
| **GitHub API 限流** | Changelog 构建失败 | 加缓存 / 降级到静态 JSON 快照 |
| **域名未定**影响启动 | 阻塞部署 | 先用 Vercel 默认域名（`capibara-website.vercel.app`）上线，正式域名后期切换 |

### 9.2 未决项（Open Questions）

| # | 问题 | Owner | 截止时间 |
|---|------|-------|---------|
| 1 | 官方域名 | uoyo | 开发开始前 |
| 2 | Logo 的 SVG / 多尺寸版本 | uoyo / UX | Phase 1 Day 2 前 |
| 3 | 产品演示截图 / 视频录制 | uoyo / UX | Phase 1 Day 3 前，或 Phase 2 初 |
| 4 | 开源协议（MIT / Apache 2.0 / 其他）— Footer 展示需要 | uoyo | 开发开始前 |
| 5 | GitHub 仓库可见性确认（当前是否 public） | uoyo | 开发开始前 |

---

## 10. 成功验收标准

Phase 1 MVP 上线需同时满足：

- [ ] 三个页面（`/`、`/download`、`/changelog`）全部可访问
- [ ] 中英双语切换正常
- [ ] 下载按钮能正确下载 Windows + Linux 全部 5 个构件
- [ ] OS 自动检测在 Windows / Linux / Mac 三个 OS 下行为正确
- [ ] Changelog 从 GitHub Releases 自动拉取最新数据
- [ ] Lighthouse Performance ≥ 95（Desktop）
- [ ] 响应式：移动端（375px 宽度）无横向滚动，所有 CTA 可点击
- [ ] 深色模式切换正常
- [ ] 所有页面 SEO meta / Open Graph 齐全
- [ ] Vercel 部署成功，HTTPS 正常

---

## 11. 相关文档

- **项目主上下文**：`_bmad-output/project-context.md`
- **发布流程参考**：`docs/release-runbook.md`
- **主项目 README**：`README.md`
- **本提案所属 PRD**（后续生成）：`_bmad-output/planning-artifacts/prd-website.md`

---

## 12. 下一步

本提案已与 `uoyo` 对齐，建议立即执行：

1. **[推荐]** 调用 `bmad-create-prd` 基于本提案生成**正式 PRD**（可直接交给开发）
2. 调用 `bmad-agent-ux-designer`（Sally）开始**视觉稿设计**
3. 调用 `bmad-create-epics-and-stories` 拆解为**开发用的 Epic + Story**

---

**文档状态**：✅ Approved by uoyo on 2026-05-08
**版本**：v1.0
**负责人**：John (PM)
