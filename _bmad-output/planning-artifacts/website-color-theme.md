---
doc_type: 'color-theme'
project: 'capibara-website'
version: 'v1.0'
author: 'GitHub Copilot'
date: '2026-05-10'
status: 'approved-for-design'
---

# Capibara 官网主题配色方案 v1.0

> **配色来源**：从 `images/logo.png`（水豚 logo）中提取，所有色值自然生长自品牌视觉，无额外主观选色。

---

## 1. Logo 色彩提取

| 色名 | 色值 | 来源位置 |
|------|------|---------|
| Capybara Tan | `#CFA06E` | 主体毛色 |
| Deep Brown | `#7A4E2D` | 鼻吻暗部 |
| Sprout Green | `#5BA84A` | 头顶嫩叶 |
| Blush | `#E8B49A` | 腮红 |
| Ink | `#2D1810` | 轮廓线 |

---

## 2. 设计决策

### 双色分工原则

| 角色 | 色系 | 用途 |
|------|------|------|
| **Primary（品牌色）** | 棕色系（Capybara Tan） | 导航、标题、品牌元素、徽章 |
| **Accent（行动色）** | 绿色系（Sprout Green） | 主 CTA 按钮（下载）、链接、高亮 |
| **Neutral（中性色）** | 暖白 → 暖黑渐变 | 背景、文字、边框 |

**为什么 CTA 用绿而非棕？**
Logo 上"头顶嫩芽"是整张图里唯一的非棕色，象征**生长、行动、开始**，与"下载 / 开始使用"的语义高度契合。棕色承载品牌感，绿色驱动转化，两色分工明确、不撞色。

---

## 3. Design Token — Light Mode

```css
/* ── 背景层 ── */
--color-bg-base:        #FEFAF5;   /* 暖白，主页面底色 */
--color-bg-surface:     #F5EDE0;   /* 暖奶油，卡片 / 区块 */
--color-bg-muted:       #EDE0CE;   /* 轻棕，分隔 / hover */

/* ── 品牌色 Primary ── */
--color-primary:        #C48A5A;   /* Capybara Tan（加深，保证可读性） */
--color-primary-dark:   #8B5E3C;   /* 悬停 / 按压态 */
--color-primary-light:  #E8C9A8;   /* 描边 / 辅助填充 */

/* ── 行动色 Accent（CTA） ── */
--color-accent:         #4E9A44;   /* Sprout Green，下载按钮 / 主 CTA */
--color-accent-dark:    #3A7A32;   /* 悬停态 */
--color-accent-light:   #D6EED3;   /* 背景点缀 / 标签底色 */

/* ── 文字 ── */
--color-text-primary:   #1C1208;   /* 主正文（暖黑） */
--color-text-secondary: #5C4030;   /* 次要信息 */
--color-text-muted:     #9A7A62;   /* 辅助 / 占位 / 禁用 */

/* ── 边框 / 分隔线 ── */
--color-border:         #DDD0BC;
--color-border-muted:   #EDE0CE;
```

---

## 4. Design Token — Dark Mode

```css
/* ── 背景层 ── */
--color-bg-base:        #1A0F08;   /* 深暖黑，主页面底色 */
--color-bg-surface:     #2A1A0F;   /* 深棕，卡片 / 区块 */
--color-bg-muted:       #3A2418;   /* 中棕，hover */

/* ── 品牌色 Primary ── */
--color-primary:        #D4A574;   /* 浅棕（暗背景上保证可读） */
--color-primary-dark:   #CFA06E;
--color-primary-light:  #7A4E2D;

/* ── 行动色 Accent（CTA） ── */
--color-accent:         #6EBF5E;   /* 更亮的绿（暗底高对比） */
--color-accent-dark:    #4E9A44;
--color-accent-light:   #1E3D1A;

/* ── 文字 ── */
--color-text-primary:   #F5EDE0;   /* 暖奶油白 */
--color-text-secondary: #C4A080;
--color-text-muted:     #7A5A42;

/* ── 边框 / 分隔线 ── */
--color-border:         #4A3020;
--color-border-muted:   #3A2418;
```

---

## 5. Tailwind CSS 配置

在 `tailwind.config.ts` 的 `theme.extend.colors` 中添加：

```ts
colors: {
  capybara: {
    50:  '#FEFAF5',  // bg-base (light)
    100: '#F5EDE0',  // bg-surface (light)
    200: '#EDE0CE',  // bg-muted (light)
    300: '#E8C9A8',  // primary-light
    400: '#D4A574',  // primary (dark mode)
    500: '#CFA06E',  // logo 原色
    600: '#C48A5A',  // primary (light mode)
    700: '#8B5E3C',  // primary-dark
    800: '#5C3820',
    900: '#2D1810',  // ink / 轮廓
    950: '#1A0F08',  // bg-base (dark)
  },
  sprout: {
    50:  '#D6EED3',  // accent-light (light mode)
    400: '#6EBF5E',  // accent (dark mode)
    500: '#5BA84A',  // logo 原色
    600: '#4E9A44',  // accent (light mode)
    700: '#3A7A32',  // accent-dark
    950: '#1E3D1A',  // accent-light (dark mode)
  },
},
```

### 语义化工具类映射建议

| Tailwind 类 | 使用场景 |
|-------------|---------|
| `bg-capybara-50` | 页面底色（light） |
| `bg-capybara-100` | 卡片底色（light） |
| `bg-capybara-950` | 页面底色（dark） |
| `text-capybara-900` | 主标题（light） |
| `text-capybara-50` | 主标题（dark） |
| `bg-sprout-600 hover:bg-sprout-700` | 主下载 CTA 按钮（light） |
| `bg-sprout-400 hover:bg-sprout-500` | 主下载 CTA 按钮（dark） |
| `text-capybara-600` | 品牌色文字链接（light） |
| `border-capybara-200` | 卡片边框（light） |

---

## 6. 色彩用法规范

### 按钮规范

| 按钮类型 | Light | Dark |
|---------|-------|------|
| **Primary CTA**（下载） | `bg-sprout-600 text-white hover:bg-sprout-700` | `bg-sprout-400 text-capybara-950 hover:bg-sprout-500` |
| **Secondary**（GitHub） | `border border-capybara-300 text-capybara-700 hover:bg-capybara-100` | `border border-capybara-700 text-capybara-300 hover:bg-capybara-900` |
| **Ghost** | `text-capybara-600 hover:text-capybara-800` | `text-capybara-400 hover:text-capybara-200` |

### 区块背景规范

| 区块 | Light | Dark |
|------|-------|------|
| Hero | `bg-capybara-50` | `bg-capybara-950` |
| 概念卡片区 | `bg-capybara-100` | `bg-capybara-900` |
| 场景矩阵 | `bg-white` | `bg-capybara-950` |
| 差异化区 | `bg-capybara-100` | `bg-capybara-900` |
| Final CTA | `bg-capybara-600`（品牌色背景） | `bg-capybara-800` |
| Footer | `bg-capybara-900 text-capybara-100` | `bg-capybara-950 text-capybara-300` |

---

## 7. 字体与色彩搭配

| 字体角色 | 字体 | 配色 |
|---------|------|------|
| Hero 主标题 | Geist Sans Bold | `text-capybara-900` / `text-capybara-50` |
| Hero 副标题 | Inter Regular | `text-capybara-700` / `text-capybara-300` |
| 正文 | Inter Regular | `text-capybara-800` / `text-capybara-200` |
| 中文正文 | 思源黑体 / PingFang SC | 同上 |
| 次要信息 | Inter Regular | `text-capybara-600` / `text-capybara-400` |
| CTA 按钮文字 | Inter SemiBold | `text-white` / `text-capybara-950` |

---

## 8. 参考视觉锚点

| 参考来源 | 借鉴点 |
|---------|--------|
| [Linear](https://linear.app) | 极简布局、深色模式质感 |
| [Raycast](https://raycast.com) | 暖色品牌 + 深色模式融合 |
| [Vercel](https://vercel.com) | 首屏文案节奏、CTA 层级 |

---

## 9. 相关文档

- **网站设计提案**：`_bmad-output/planning-artifacts/website-proposal.md`
- **Logo 源文件**：`images/logo.png`
- **本项目 README**：`README.md`

---

**文档状态**：✅ Ready for UX Design  
**版本**：v1.0  
**负责人**：uoyo
