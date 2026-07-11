---
title: Day 1 - Docker Compose 与项目初始化
description: Docker、PostgreSQL 与 FastAPI 项目初始化的学习记录。
pubDate: 2026-07-11
type: 学习日志
tags: [Docker, PostgreSQL, FastAPI]
featured: true
---

## 今天的目标

- [x] 建立项目目录和依赖声明
- [x] 理解 Image、Container 与 Compose 的区别
- [x] 用 Docker 启动本地 PostgreSQL
- [x] 建立 FastAPI 健康检查接口

## 先把项目跑起来

今天的重点不是把所有基础设施一步做完，而是确认每一层的责任：Compose 负责描述一组服务，Dockerfile 负责构建自己的应用镜像，PostgreSQL 先作为独立服务运行。

```yaml
services:
  db:
    image: postgres:18-alpine
    ports:
      - "127.0.0.1:15432:5432"
```

把数据库端口绑定到 `127.0.0.1`，可以避免它被局域网直接访问，也能减少本机端口冲突。

## 今天记住的几点

| 概念 | 作用 |
| --- | --- |
| Image | 只读的运行模板 |
| Container | 由镜像启动的运行实例 |
| Service | Compose 中定义的一项服务 |
| Volume | 容器重建后仍保留的数据 |

接下来会补上数据库连通性检查，并继续理解异步 SQLAlchemy 的会话生命周期。
