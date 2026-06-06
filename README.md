# Wangye Community

一个功能完整的社区讨论平台，使用 Node.js + SQLite 构建，前后端一体，单文件部署。

## 功能特性

### 内容系统
- 帖子发布与编辑（Markdown 支持，含编辑历史）
- 多图上传（自动压缩至 1920px / JPEG 80%）
- 分类浏览（技术、产品、生活、游戏、读书、综合）
- 标签系统（标签订阅、按标签筛选）
- 帖子置顶、精华、点赞、收藏（支持收藏夹分组）
- 合集功能（将多个帖子归入同一合集）
- 草稿管理（本地 + 服务端双同步）

### 社交互动
- 楼中楼评论（支持回复、编辑、删除）
- 评论投票（赞/踩）
- 关注/拉黑用户
- @提及自动补全
- 8 种表情回应（👍❤️😂😮😢🎉🤔👏）
- 分享功能（生成链接 / 图片卡片）

### 实时通讯
- 私信系统（WebSocket 实时推送）
- 群聊功能
- 消息未读计数

### 通知系统
- 多类型通知：点赞、评论、关注、标签更新、@提及、系统消息
- 类型筛选（全部/点赞/评论/关注/系统）
- 单条 / 全部标记已读

### 用户系统
- JWT 认证（7天有效期）
- bcrypt 密码哈希（自动迁移旧版 SHA256）
- 安全问题找回密码
- 个人资料编辑（头像、简介）
- 用户等级与成就系统
- 账号注销（级联删除所有数据）

### 管理后台
- 管理员批量操作（置顶、删除）
- 举报处理
- 用户封禁
- 社区公告
- 定时发布

### 界面与交互
- 暗色模式
- 键盘快捷键（J/K 切换、L 点赞、B 收藏、/ 搜索）
- 帖子目录导航（TOC）
- 无限滚动加载
- 阅读进度条
- 图片灯箱查看
- 响应式布局
- 搜索建议

## 技术栈

| 组件 | 技术 |
|------|------|
| 后端框架 | Express.js |
| 数据库 | SQLite (better-sqlite3) |
| 实时通讯 | WebSocket (ws) |
| 认证 | JWT (jsonwebtoken) |
| 密码加密 | bcryptjs |
| 安全 | helmet, express-rate-limit |
| 图片处理 | sharp (压缩 + 格式转换) |
| 前端 | 原生 JavaScript，无框架 |

## 快速开始

### 环境要求

- Node.js >= 18
- npm

### 安装

```bash
git clone https://github.com/your-username/wangye-community.git
cd wangye-community
npm install
```

### 配置

创建 `.env` 文件（可选，均有默认值）：

```env
PORT=3000                # 服务端口
DB_PATH=./data.db        # 数据库路径
JWT_EXPIRES=7d           # Token 有效期
BCRYPT_ROUNDS=12         # 密码加密轮数
UPLOAD_MAX_SIZE=5242880  # 上传大小限制 (5MB)
```

### 启动

```bash
npm start
```

访问 `http://localhost:3000`

### 测试账号

| 用户名 | 密码 |
|--------|------|
| 小明 | 123456 |

## 项目结构

```
wangye-community/
├── server.js           # 后端服务（路由、数据库、WebSocket）
├── package.json
├── .env                # 环境变量（不提交到 Git）
├── .gitignore
├── data.db             # SQLite 数据库（运行时生成）
└── public/
    ├── index.html      # 页面结构 + 模态框定义
    ├── app.js          # 前端逻辑（单页应用）
    ├── styles.css      # 样式
    └── uploads/        # 用户上传的图片
```

## API 概览

约 70 个 RESTful 端点，主要包括：

| 模块 | 端点示例 |
|------|----------|
| 认证 | `POST /api/login` `POST /api/register` |
| 帖子 | `GET /api/posts` `POST /api/posts` `PUT /api/posts/:id` |
| 评论 | `GET /api/posts/:id/comments` `POST /api/comments/:id/vote` |
| 用户 | `GET /api/users/:id` `POST /api/users/:id/follow` |
| 私信 | `GET /api/messages/conversations` `POST /api/messages/:userId` |
| 通知 | `GET /api/notifications` `POST /api/notifications/:id/read` |
| 收藏 | `POST /api/posts/:id/bookmark` `GET /api/bookmarks` |
| 管理 | `GET /api/admin/stats` `POST /api/admin/batch-delete` |

所有需认证的端点通过 `Authorization: Bearer <token>` 头传递 JWT。

## License

[MIT](LICENSE)
