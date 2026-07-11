# Astro 中文学习笔记与项目站设计

## 目标

将现有 React 单页作品集迁移为 Astro 静态站点。站点面向一名 AI 方向研究生，真实呈现日常学习、源码阅读和项目实践；不使用“研究档案”“构建者”等夸张定位，也不使用电子信号或波形视觉元素。

站点部署到 GitHub Pages。文章与站点代码同处一个仓库，提交到 `main` 后由 GitHub Actions 自动构建和发布。

## 信息结构

- `/`：中文首页，依次呈现简短自我介绍、最近在做、项目记录、最新学习笔记、主题索引和联系方式。
- `/blog`：文章归档页。按日期倒序展示文章，并可按类型和标签过滤。
- `/blog/[slug]`：文章阅读页。展示文章元数据、正文、标签和返回文章归档的链接。
- `/projects`：项目归档页。展示已发布、实验中与学习型项目，均链接到 GitHub。
- `/about`：中文个人介绍、当前关注方向、GitHub 与邮箱。

全站主导航固定为“笔记、项目、关于、GitHub”。首页不承担完整简历职责，项目与写作均有清晰的独立入口。

## 内容模型

文章存放在 `src/content/blog/`。每篇 Markdown 文件必须包含：

```yaml
---
title: Day 1 - Docker Compose 与项目初始化
description: Docker、PostgreSQL 与 FastAPI 项目初始化的学习记录。
pubDate: 2026-07-11
type: 学习日志
tags: [Docker, PostgreSQL, FastAPI]
featured: false
---
```

`type` 的首批受控值为“学习日志”“源码解读”“项目复盘”。文章可使用标准 Markdown 的标题、任务清单、表格、引用、代码块和图片。内容集合 schema 在构建时校验上述元数据；缺失字段、无效日期或未知类型将使构建失败。

现有 `D:\python_code\agent-lab\docs\day1.md` 将作为首篇迁移示例，转换为 UTF-8 Markdown 并补充 frontmatter。后续文章由用户复制到 `src/content/blog/` 后提交即可发布。

## 首页与视觉

首页采用“个人主页 + 最近更新”的编辑式结构：

1. 中文姓名和一句朴素定位，例如“记录 AI 学习与项目实践”。
2. “最近在做”区，显示当前学习主题或进行中的项目。
3. “项目记录”区，展示少量有代表性的 GitHub 项目，以问题、简介、技术标签和仓库链接说明。
4. “最新笔记”区，从内容集合取最新文章，混排不同文章类型。
5. “主题”区，按标签链接到相关笔记。

视觉方向参考 Maggie Appleton 的个人网站所体现的内容优先、阅读友好和长期积累逻辑，但不复制其插画、版式或品牌元素。使用偏暖的浅色纸张背景、深色正文、低饱和红棕或绿色作为单一强调色；标题使用有阅读感的衬线字体，正文使用清晰的中文无衬线字体。布局保持较多留白、细分隔线和可读的内容宽度，避免大幅渐变、发光科技风、信号图形与密集卡片墙。

文章页的正文列限制在舒适阅读宽度；代码块和表格在小屏幕可水平滚动；文章列表和导航在移动端保持单列且可点击区域充足。

## 技术与部署

- 用 Astro 替换 Vite React 入口，采用静态输出模式。
- 使用 Astro Content Collections 管理并校验 Markdown 内容。
- 使用共享的布局、导航、页脚、文章卡片和项目卡片组件，页面只负责组合内容。
- 将 GitHub Actions 的构建命令替换为 Astro 构建，继续上传 `dist` 到 GitHub Pages。
- 因仓库为用户主页 `dqyydq.github.io`，站点基路径使用 `/`。
- 移除不再使用的 React、Tailwind 和 Vite 依赖及旧页面源码，保留当前项目资料并以 Astro 数据或内容文件重建。

## 验证

- `npm run build` 必须成功并生成 `dist`。
- 构建验证每篇文章的 schema。
- 本地启动开发服务器，检查首页、文章列表、文章详情、项目页和关于页。
- 在桌面与移动宽度检查导航、长代码块、表格和中文文本换行。
- 推送 `main` 后确认 GitHub Actions 上传的是 Astro `dist`，线上首页引用编译后的 `/assets/` 文件而非源码入口。

## 发布流程

新增或更新文章的固定流程：

1. 将 Markdown 文件放入 `src/content/blog/` 并补齐 frontmatter。
2. 本地运行 `npm run build`。
3. 执行 `git add`、`git commit`、`git push origin main`。
4. 等待 GitHub Actions 部署完成后访问线上站点。
