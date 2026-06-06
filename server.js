require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

// Image upload setup
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = crypto.randomBytes(8).toString('hex') + ext;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.UPLOAD_MAX_SIZE) || 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp)$/i;
    const mimeOk = file.mimetype && file.mimetype.startsWith('image/');
    if (allowed.test(path.extname(file.originalname)) && mimeOk) cb(null, true);
    else cb(new Error('只支持图片文件(jpg/png/gif/webp)'));
  }
});

// Password hashing (bcrypt with migration from legacy SHA256)
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;
function hashPassword(password) {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}
function verifyPassword(password, hash) {
  if (hash.length === 64 && /^[a-f0-9]+$/.test(hash)) {
    // Legacy SHA256 hash — verify and return 'migrate' flag
    const legacy = crypto.createHash('sha256').update(password + 'wangye_salt').digest('hex');
    return legacy === hash ? 'migrate' : false;
  }
  return bcrypt.compareSync(password, hash) ? 'ok' : false;
}

// JWT
const JWT_SECRET = crypto.randomBytes(32).toString('hex');
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';
function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

const db = new Database(path.resolve(process.env.DB_PATH || './data.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    avatar TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT DEFAULT '综合',
    likes INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0,
    is_pinned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    parent_id INTEGER DEFAULT NULL,
    content TEXT NOT NULL,
    likes INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (parent_id) REFERENCES comments(id)
  );

  CREATE TABLE IF NOT EXISTS post_likes (
    user_id INTEGER NOT NULL,
    post_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, post_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (post_id) REFERENCES posts(id)
  );

  CREATE TABLE IF NOT EXISTS comment_likes (
    user_id INTEGER NOT NULL,
    comment_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, comment_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (comment_id) REFERENCES comments(id)
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    user_id INTEGER NOT NULL,
    post_id INTEGER NOT NULL,
    folder_id INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, post_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (post_id) REFERENCES posts(id)
  );

  CREATE TABLE IF NOT EXISTS bookmark_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS follows (
    follower_id INTEGER NOT NULL,
    following_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (follower_id, following_id),
    FOREIGN KEY (follower_id) REFERENCES users(id),
    FOREIGN KEY (following_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    from_user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    post_id INTEGER,
    comment_id INTEGER,
    content TEXT DEFAULT '',
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (from_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  );

  CREATE TABLE IF NOT EXISTS post_tags (
    post_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (post_id, tag_id),
    FOREIGN KEY (post_id) REFERENCES posts(id),
    FOREIGN KEY (tag_id) REFERENCES tags(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (receiver_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    post_id INTEGER,
    comment_id INTEGER,
    emoji TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, post_id, comment_id, emoji)
  );

  CREATE TABLE IF NOT EXISTS blocks (
    blocker_id INTEGER NOT NULL,
    blocked_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (blocker_id, blocked_id),
    FOREIGN KEY (blocker_id) REFERENCES users(id),
    FOREIGN KEY (blocked_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, type)
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER NOT NULL,
    post_id INTEGER,
    comment_id INTEGER,
    reason TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reporter_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS collection_posts (
    collection_id INTEGER NOT NULL,
    post_id INTEGER NOT NULL,
    sort_order INTEGER DEFAULT 0,
    PRIMARY KEY (collection_id, post_id),
    FOREIGN KEY (collection_id) REFERENCES collections(id),
    FOREIGN KEY (post_id) REFERENCES posts(id)
  );
`);

// Migrations
try { db.exec('ALTER TABLE comments ADD COLUMN parent_id INTEGER DEFAULT NULL'); } catch(e) {}
try { db.exec('ALTER TABLE posts ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP'); } catch(e) {}
try { db.exec('ALTER TABLE posts ADD COLUMN views INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE posts ADD COLUMN is_pinned INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE posts ADD COLUMN is_featured INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN last_active DATETIME DEFAULT CURRENT_TIMESTAMP'); } catch(e) {}
try { db.exec('ALTER TABLE posts ADD COLUMN scheduled_at DATETIME'); } catch(e) {}
try { db.exec('ALTER TABLE posts ADD COLUMN is_muted INTEGER DEFAULT 0'); } catch(e) {}
try { db.exec('ALTER TABLE bookmarks ADD COLUMN folder_id INTEGER DEFAULT 0'); } catch(e) {}

// New tables for Phase 7
db.exec(`
  CREATE TABLE IF NOT EXISTS comment_votes (
    user_id INTEGER NOT NULL,
    comment_id INTEGER NOT NULL,
    vote INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, comment_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (comment_id) REFERENCES comments(id)
  );

  CREATE TABLE IF NOT EXISTS drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT DEFAULT '',
    content TEXT DEFAULT '',
    category TEXT DEFAULT '综合',
    tags TEXT DEFAULT '[]',
    post_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS post_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    edited_by INTEGER NOT NULL,
    edited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id),
    FOREIGN KEY (edited_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS scheduled_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT DEFAULT '综合',
    tags TEXT DEFAULT '[]',
    scheduled_at DATETIME NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS group_chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS group_chat_members (
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES group_chats(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS group_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES group_chats(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS user_bans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    banned_by INTEGER NOT NULL,
    reason TEXT,
    ban_type TEXT DEFAULT 'ban',
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (banned_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS post_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    image_url TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id)
  );

  CREATE TABLE IF NOT EXISTS tag_subscriptions (
    user_id INTEGER NOT NULL,
    tag_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, tag_name),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Seed demo data
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  const insertUser = db.prepare('INSERT INTO users (username, password, avatar, bio) VALUES (?, ?, ?, ?)');
  const insertPost = db.prepare('INSERT INTO posts (user_id, title, content, category, likes, views) VALUES (?, ?, ?, ?, ?, ?)');
  const insertComment = db.prepare('INSERT INTO comments (post_id, user_id, content, likes, parent_id) VALUES (?, ?, ?, ?, ?)');
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
  const insertPostTag = db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)');
  const insertFollow = db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)');

  const users = [
    ['小明', hashPassword('123456'), '🧑‍💻', '热爱编程的全栈开发者 | 开源爱好者'],
    ['小红', hashPassword('123456'), '👩‍🎨', '设计师 | 生活美学爱好者 | 咖啡控'],
    ['老王', hashPassword('123456'), '👨‍🏫', '十年经验产品经理 | 产品思维分享'],
    ['阿杰', hashPassword('123456'), '🎮', '独立游戏开发者 | 像素风爱好者'],
    ['思思', hashPassword('123456'), '📚', '读书 | 旅行 | 摄影 | 生活记录者'],
  ];

  const userIds = users.map(u => insertUser.run(...u).lastInsertRowid);

  // Follows
  insertFollow.run(userIds[0], userIds[1]);
  insertFollow.run(userIds[0], userIds[2]);
  insertFollow.run(userIds[1], userIds[0]);
  insertFollow.run(userIds[2], userIds[0]);
  insertFollow.run(userIds[3], userIds[0]);
  insertFollow.run(userIds[4], userIds[0]);
  insertFollow.run(userIds[4], userIds[2]);

  const posts = [
    [userIds[0], '分享一个我写的开源项目', '最近用 React + Node.js 写了一个任务管理工具，支持拖拽排序、标签分类、团队协作。代码已开源，欢迎 star 和 PR！\n\n## 主要功能\n\n- 看板视图和列表视图切换\n- 拖拽排序任务\n- 标签和优先级管理\n- 实时协作同步\n\n## 技术栈\n\n```\nReact 18 + TypeScript + Express + PostgreSQL\n```\n\n> 欢迎提 Issue 和 PR！', '技术', 42, 356],
    [userIds[1], '今天的咖啡拉花练习', '终于做出了一个还算像样的郁金香图案！练习了两个月，从最开始的"抽象派"到现在终于有形了。\n\n## 学习心得\n\n1. 牛奶温度控制在60-65度\n2. 拉花缸高度要先高后低\n3. 出图时手腕要稳\n4. **心形图案**是基础，先练好这个\n\n> 明天继续练习天鹅🦢\n\n*配图是今天的成果，虽然还不够完美但进步很大！*', '生活', 28, 189],
    [userIds[2], '产品设计中的用户心理', '做产品这么多年，总结几个利用用户心理提升体验的小技巧：\n\n### 1. 锚定效应\n先展示高价方案，再推荐目标方案\n\n### 2. 损失厌恶\n强调"还剩XX天"比"还有XX天"更有效\n\n### 3. 社会认同\n展示"XX人已购买"增加信任感\n\n### 4. 峰终定律\n重点优化体验的高峰和结尾\n\n---\n\n这些不是用来"套路"用户，而是让体验更顺畅。**好的设计是让用户感觉不到设计。**', '产品', 67, 512],
    [userIds[3], '独立游戏开发日志 #1', '记录一下我的独立游戏开发历程。这是一个**像素风Roguelike**游戏，融合了卡牌构筑元素。\n\n## 目前进度\n\n- [x] 核心战斗系统 80%\n- [x] 卡牌系统 60%\n- [ ] 关卡生成 40%\n- [ ] 美术资源 30%\n\n```javascript\n// 简单的卡牌数据结构\nclass Card {\n  constructor(name, cost, effect) {\n    this.name = name;\n    this.cost = cost;\n    this.effect = effect;\n  }\n}\n```\n\n预计明年Q1可以发布Demo。欢迎关注！🎮', '游戏', 35, 278],
    [userIds[4], '2024年读过的10本好书', '年终总结之读书篇，今年读了36本书，精选10本推荐给大家：\n\n1. 《置身事内》- 理解中国经济的必读书\n2. 《纳瓦尔宝典》- 关于财富和幸福的智慧\n3. 《认知觉醒》- 改变思维模式\n4. 《长安的荔枝》- 历史小说佳作\n5. 《也许你该找个人聊聊》- 心理治愈\n6. 《芯片战争》- 科技史必读\n7. 《被讨厌的勇气》- 阿德勒心理学\n8. 《人类简史》- 重新认识人类\n9. 《刻意练习》- 学习方法论\n10. 《小王子》- 永远的经典\n\n> 每一本都写了详细的读书笔记，感兴趣的可以私信我交流📖', '读书', 89, 634],
    [userIds[0], '聊聊前端框架的选择', '2024年了，前端框架到底该怎么选？我的看法：\n\n## React\n生态最大，适合大型项目，学习曲线适中。`JSX` 的灵活性是优势也是劣势。\n\n## Vue\n上手最快，中文文档友好，适合中小项目。`Composition API` 让代码组织更清晰。\n\n## Svelte\n性能最优，编译时框架，适合追求极致。不需要虚拟 DOM，直接操作真实 DOM。\n\n## Next.js\n全栈首选，SSR/SSG 开箱即用。`App Router` 是未来方向。\n\n---\n\n**没有最好的框架，只有最合适的。** 根据团队情况和项目需求来选。', '技术', 53, 421],
  ];

  const postIds = posts.map(p => insertPost.run(...p).lastInsertRowid);

  // Pin the first post
  db.prepare('UPDATE posts SET is_pinned = 1 WHERE id = ?').run(postIds[0]);

  // Tags
  const tagNames = ['React', 'Node.js', 'TypeScript', '开源', '前端', '后端', '设计', '产品', '咖啡', '生活', '游戏', '独立游戏', 'Roguelike', '读书', '心理学', '框架', 'Vue', 'Svelte'];
  tagNames.forEach(name => insertTag.run(name));

  const getTagId = (name) => db.prepare('SELECT id FROM tags WHERE name = ?').get(name)?.id;
  [[postIds[0], 'React'], [postIds[0], 'Node.js'], [postIds[0], 'TypeScript'], [postIds[0], '开源'],
   [postIds[1], '咖啡'], [postIds[1], '生活'],
   [postIds[2], '设计'], [postIds[2], '产品'], [postIds[2], '心理学'],
   [postIds[3], '游戏'], [postIds[3], '独立游戏'], [postIds[3], 'Roguelike'],
   [postIds[4], '读书'], [postIds[4], '心理学'],
   [postIds[5], '前端'], [postIds[5], 'React'], [postIds[5], 'Vue'], [postIds[5], 'Svelte'], [postIds[5], '框架']
  ].forEach(([pid, tname]) => {
    const tid = getTagId(tname);
    if (tid) insertPostTag.run(pid, tid);
  });

  const c1 = insertComment.run(postIds[0], userIds[1], '不错不错，界面很清爽！请问支持移动端吗？', 5, null).lastInsertRowid;
  insertComment.run(postIds[0], userIds[2], '看起来功能很全，正好我们团队需要这样的工具', 3, null);
  insertComment.run(postIds[0], userIds[4], '已 star！期待后续更新', 2, null);
  insertComment.run(postIds[0], userIds[0], '支持的，已经做了响应式适配 👍', 1, c1);
  insertComment.run(postIds[2], userIds[0], '总结得很到位，峰终定律在产品设计中确实很实用', 8, null);
  insertComment.run(postIds[2], userIds[3], '受教了，请问有没有相关书籍推荐？', 4, null);
  insertComment.run(postIds[2], userIds[2], '推荐《设计心理学》和《用户体验要素》', 2, 5);
  insertComment.run(postIds[4], userIds[0], '推荐的书都很棒，《置身事内》我也读过，强烈推荐！', 6, null);
  insertComment.run(postIds[4], userIds[2], '加了读书笔记功能就更好了', 3, null);
  insertComment.run(postIds[5], userIds[3], 'Svelte 确实越来越火了，编译时框架是趋势', 4, null);
}

// Security & performance middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:"],
    }
  }
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));

// Rate limiting
const globalLimiter = rateLimit({ windowMs: 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false, message: { error: '请求过于频繁，请稍后再试' } });
const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: { error: '登录/注册尝试过于频繁，请1分钟后再试' } });
const postLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: '发帖/评论过于频繁，请稍后再试' } });
app.use('/api/', globalLimiter);
app.use('/api/login', authLimiter);
app.use('/api/register', authLimiter);

// Static files with cache
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads'), { maxAge: '7d' }));

// Database indexes for performance
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
  CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
  CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);
  CREATE INDEX IF NOT EXISTS idx_posts_is_pinned ON posts(is_pinned);
  CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
  CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
  CREATE INDEX IF NOT EXISTS idx_follows_follower_id ON follows(follower_id);
  CREATE INDEX IF NOT EXISTS idx_follows_following_id ON follows(following_id);
  CREATE INDEX IF NOT EXISTS idx_messages_receiver_id ON messages(receiver_id);
  CREATE INDEX IF NOT EXISTS idx_bookmarks_user_id ON bookmarks(user_id);
  CREATE INDEX IF NOT EXISTS idx_post_tags_post_id ON post_tags(post_id);
  CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active);
`);

// Auth middleware (JWT-based)
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: '请先登录' });
  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET);
    const user = db.prepare('SELECT id, username, avatar, bio FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ error: '用户不存在' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), JWT_SECRET);
      req.user = db.prepare('SELECT id, username, avatar, bio FROM users WHERE id = ?').get(payload.id);
    } catch (e) {}
  }
  next();
}

function isAdmin(req, res, next) {
  if (!req.user || req.user.id !== 1) return res.status(403).json({ error: '无权访问' });
  next();
}

// Helper: create notification
function createNotification(userId, fromUserId, type, postId = null, commentId = null, content = '') {
  if (userId === fromUserId) return; // Don't notify yourself
  db.prepare('INSERT INTO notifications (user_id, from_user_id, type, post_id, comment_id, content) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, fromUserId, type, postId, commentId, content);
}

// Auth routes
app.post('/api/register', (req, res) => {
  const { username, password, securityQuestion, securityAnswer } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (username.length < 2 || username.length > 20) return res.status(400).json({ error: '用户名需要2-20个字符' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少6个字符' });

  const avatars = ['🧑‍💻', '👩‍🎨', '👨‍🏫', '🎮', '📚', '🌟', '🎯', '🚀', '💡', '🎨', '🦊', '🐱', '🐶', '🐼', '🐨', '🦄', '🐸', '🦋', '🐙', '🎃', '🤖', '👾', '🎪', '🎭', '🌍', '⚡', '🔮', '🎸', '🏆', '💎', '🔥', '🌊'];
  const avatar = avatars[Math.floor(Math.random() * avatars.length)];

  try {
    const result = db.prepare('INSERT INTO users (username, password, avatar, security_question, security_answer) VALUES (?, ?, ?, ?, ?)')
      .run(username, hashPassword(password), avatar, securityQuestion || '', securityAnswer ? hashPassword(securityAnswer) : '');
    const user = { id: result.lastInsertRowid, username, avatar, bio: '' };
    res.json({ ...user, token: signToken(user) });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: '用户名已存在' });
    res.status(500).json({ error: '注册失败' });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT id, username, avatar, bio, password FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });
  const result = verifyPassword(password, user.password);
  if (!result) return res.status(401).json({ error: '用户名或密码错误' });
  // Auto-migrate legacy SHA256 hash to bcrypt
  if (result === 'migrate') {
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(password), user.id);
  }
  const { password: _, ...safeUser } = user;
  res.json({ ...safeUser, token: signToken(safeUser) });
});

// Restore session from JWT token
app.get('/api/me', authMiddleware, (req, res) => {
  res.json(req.user);
});

// Search
app.get('/api/search', optionalAuth, (req, res) => {
  const { q, page = 1 } = req.query;
  if (!q) return res.json({ posts: [], total: 0 });

  const limit = 20;
  const offset = (page - 1) * limit;
  const searchTerm = `%${q}%`;

  const posts = db.prepare(`
    SELECT p.*, u.username, u.avatar,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM posts p JOIN users u ON p.user_id = u.id
    WHERE p.title LIKE ? OR p.content LIKE ?
    ORDER BY p.is_pinned DESC, p.created_at DESC
    LIMIT ? OFFSET ?
  `).all(searchTerm, searchTerm, limit, offset);

  const total = db.prepare('SELECT COUNT(*) as c FROM posts WHERE title LIKE ? OR content LIKE ?').get(searchTerm, searchTerm).c;

  if (req.user) {
    const bookmarked = db.prepare('SELECT post_id FROM bookmarks WHERE user_id = ?').all(req.user.id).map(r => r.post_id);
    posts.forEach(p => p.bookmarked = bookmarked.includes(p.id));
  }

  // Batch fetch tags
  batchFetchTags(posts);

  res.json({ posts, total, page: Number(page), hasMore: offset + limit < total });
});

// Search suggestions endpoint
app.get('/api/search/suggestions', (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 1) return res.json({ suggestions: [] });

  const searchTerm = `%${q}%`;
  const limit = 8;

  // Get matching post titles
  const posts = db.prepare(`
    SELECT DISTINCT title FROM posts
    WHERE title LIKE ? ORDER BY views DESC LIMIT ?
  `).all(searchTerm, limit);

  // Get matching tags
  const tags = db.prepare(`
    SELECT DISTINCT name FROM tags
    WHERE name LIKE ? ORDER BY name LIMIT ?
  `).all(searchTerm, limit);

  // Get matching usernames
  const users = db.prepare(`
    SELECT DISTINCT username FROM users
    WHERE username LIKE ? ORDER BY username LIMIT ?
  `).all(searchTerm, limit);

  const suggestions = [
    ...posts.map(p => ({ type: 'post', text: p.title })),
    ...tags.map(t => ({ type: 'tag', text: t.name })),
    ...users.map(u => ({ type: 'user', text: u.username }))
  ].slice(0, limit);

  res.json({ suggestions });
});

// User search for @mention
app.get('/api/users/search', (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 1) return res.json([]);
  const users = db.prepare('SELECT id, username, avatar FROM users WHERE username LIKE ? ORDER BY username LIMIT 8').all(`%${q}%`);
  res.json(users);
});

app.get('/api/posts/:id', optionalAuth, (req, res) => {
  const post = db.prepare(`
    SELECT p.*, u.username, u.avatar, u.bio as author_bio,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM posts p JOIN users u ON p.user_id = u.id WHERE p.id = ?
  `).get(req.params.id);
  if (!post) return res.status(404).json({ error: '帖子不存在' });

  // Increment views
  db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(req.params.id);
  post.views += 1;

  if (req.user) {
    const bookmarked = db.prepare('SELECT 1 FROM bookmarks WHERE user_id = ? AND post_id = ?').get(req.user.id, req.params.id);
    post.bookmarked = !!bookmarked;

    const liked = db.prepare('SELECT 1 FROM post_likes WHERE user_id = ? AND post_id = ?').get(req.user.id, req.params.id);
    post.liked = !!liked;
  }

  // Attach tags
  post.tags = db.prepare('SELECT t.name FROM tags t JOIN post_tags pt ON t.id = pt.tag_id WHERE pt.post_id = ?').all(post.id).map(t => t.name);

  res.json(post);
});

app.post('/api/posts', authMiddleware, postLimiter, (req, res) => {
  let { title, content, category, tags } = req.body;
  if (!title || !content) return res.status(400).json({ error: '标题和内容不能为空' });
  if (title.length > 100) return res.status(400).json({ error: '标题不能超过100个字符' });

  // Apply sensitive word filter
  title = filterContent(title);
  content = filterContent(content);

  const result = db.prepare('INSERT INTO posts (user_id, title, content, category) VALUES (?, ?, ?, ?)').run(req.user.id, title, content, category || '综合');
  const postId = result.lastInsertRowid;

  // Handle tags
  if (tags && Array.isArray(tags)) {
    const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
    const getTagId = db.prepare('SELECT id FROM tags WHERE name = ?');
    const insertPostTag = db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)');

    tags.forEach(tagName => {
      const name = tagName.trim();
      if (name) {
        insertTag.run(name);
        const tag = getTagId.get(name);
        if (tag) insertPostTag.run(postId, tag.id);
      }
    });
  }

  // Notify followers
  const followers = db.prepare('SELECT follower_id FROM follows WHERE following_id = ?').all(req.user.id);
  followers.forEach(f => {
    createNotification(f.follower_id, req.user.id, 'new_post', postId, null, title);
    notifyUser(f.follower_id, 'notification', `${req.user.username} 发布了新帖子: ${title}`);
  });

  // Notify tag subscribers
  if (tags && Array.isArray(tags)) {
    tags.forEach(tagName => {
      const subscribers = db.prepare('SELECT user_id FROM tag_subscriptions WHERE tag_name = ?').all(tagName.trim());
      subscribers.forEach(s => {
        if (s.user_id !== req.user.id) {
          createNotification(s.user_id, req.user.id, 'tag_post', postId, null, `你订阅的标签「${tagName.trim()}」有新帖子: ${title}`);
          notifyUser(s.user_id, 'notification', `你订阅的标签「${tagName.trim()}」有新帖子: ${title}`);
        }
      });
    });
  }

  // Broadcast new post
  broadcastNewPost({ id: postId, title, username: req.user.username });

  // Parse @mentions
  parseMentions(content, req.user.id, postId);

  // Check achievements
  checkAchievements(req.user.id);

  res.json({ id: postId });
});

app.put('/api/posts/:id', authMiddleware, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '帖子不存在' });
  if (post.user_id !== req.user.id) return res.status(403).json({ error: '只能编辑自己的帖子' });

  // Save edit history
  db.prepare('INSERT INTO post_history (post_id, title, content, edited_by) VALUES (?, ?, ?, ?)')
    .run(post.id, post.title, post.content, req.user.id);

  const { title, content, category, tags } = req.body;
  db.prepare('UPDATE posts SET title = COALESCE(?, title), content = COALESCE(?, content), category = COALESCE(?, category), updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(title, content, category, req.params.id);

  // Update tags
  if (tags && Array.isArray(tags)) {
    db.prepare('DELETE FROM post_tags WHERE post_id = ?').run(req.params.id);
    const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
    const getTagId = db.prepare('SELECT id FROM tags WHERE name = ?');
    const insertPostTag = db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)');

    tags.forEach(tagName => {
      const name = tagName.trim();
      if (name) {
        insertTag.run(name);
        const tag = getTagId.get(name);
        if (tag) insertPostTag.run(req.params.id, tag.id);
      }
    });
  }

  res.json({ success: true });
});

app.delete('/api/posts/:id', authMiddleware, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '帖子不存在' });
  if (post.user_id !== req.user.id && req.user.id !== 1) return res.status(403).json({ error: '只能删除自己的帖子' });

  const deleteAll = db.transaction(() => {
    db.prepare('DELETE FROM post_tags WHERE post_id = ?').run(req.params.id);
    db.prepare('DELETE FROM comment_votes WHERE comment_id IN (SELECT id FROM comments WHERE post_id = ?)').run(req.params.id);
    db.prepare('DELETE FROM comment_likes WHERE comment_id IN (SELECT id FROM comments WHERE post_id = ?)').run(req.params.id);
    db.prepare('DELETE FROM comments WHERE post_id = ?').run(req.params.id);
    db.prepare('DELETE FROM post_likes WHERE post_id = ?').run(req.params.id);
    db.prepare('DELETE FROM bookmarks WHERE post_id = ?').run(req.params.id);
    db.prepare('DELETE FROM notifications WHERE post_id = ?').run(req.params.id);
    db.prepare('DELETE FROM post_history WHERE post_id = ?').run(req.params.id);
    db.prepare('DELETE FROM collection_posts WHERE post_id = ?').run(req.params.id);
    db.prepare('DELETE FROM reports WHERE post_id = ?').run(req.params.id);
    db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  });
  deleteAll();
  res.json({ success: true });
});

app.post('/api/posts/:id/like', authMiddleware, (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;

  const existing = db.prepare('SELECT 1 FROM post_likes WHERE user_id = ? AND post_id = ?').get(userId, postId);
  if (existing) {
    db.prepare('DELETE FROM post_likes WHERE user_id = ? AND post_id = ?').run(userId, postId);
    db.prepare('UPDATE posts SET likes = likes - 1 WHERE id = ?').run(postId);
    res.json({ liked: false });
  } else {
    db.prepare('INSERT INTO post_likes (user_id, post_id) VALUES (?, ?)').run(userId, postId);
    db.prepare('UPDATE posts SET likes = likes + 1 WHERE id = ?').run(postId);

    // Notify post author
    const post = db.prepare('SELECT user_id, title FROM posts WHERE id = ?').get(postId);
    if (post) createNotification(post.user_id, userId, 'like_post', postId, null, post.title);

    res.json({ liked: true });
  }
});

// Pin post (only post author)
app.post('/api/posts/:id/pin', authMiddleware, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '帖子不存在' });
  if (post.user_id !== req.user.id) return res.status(403).json({ error: '只能置顶自己的帖子' });

  const newPinned = post.is_pinned ? 0 : 1;
  db.prepare('UPDATE posts SET is_pinned = ? WHERE id = ?').run(newPinned, req.params.id);
  res.json({ pinned: !!newPinned });
});

// Bookmarks
app.post('/api/posts/:id/bookmark', authMiddleware, (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;

  const existing = db.prepare('SELECT 1 FROM bookmarks WHERE user_id = ? AND post_id = ?').get(userId, postId);
  if (existing) {
    db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?').run(userId, postId);
    res.json({ bookmarked: false });
  } else {
    db.prepare('INSERT INTO bookmarks (user_id, post_id) VALUES (?, ?)').run(userId, postId);
    res.json({ bookmarked: true });
  }
});

app.get('/api/bookmarks', authMiddleware, (req, res) => {
  const { folder_id } = req.query;
  let query = `
    SELECT p.*, u.username, u.avatar, b.folder_id,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM bookmarks b
    JOIN posts p ON b.post_id = p.id
    JOIN users u ON p.user_id = u.id
    WHERE b.user_id = ?
  `;
  const params = [req.user.id];

  if (folder_id !== undefined) {
    query += ' AND b.folder_id = ?';
    params.push(folder_id);
  }

  query += ' ORDER BY b.created_at DESC';

  const posts = db.prepare(query).all(...params);
  posts.forEach(p => { p.bookmarked = true; });
  batchFetchTags(posts);
  res.json(posts);
});

// Bookmark folders
app.get('/api/bookmark-folders', authMiddleware, (req, res) => {
  const folders = db.prepare(`
    SELECT f.*, COUNT(b.post_id) as post_count
    FROM bookmark_folders f
    LEFT JOIN bookmarks b ON f.id = b.folder_id AND b.user_id = f.user_id
    WHERE f.user_id = ?
    GROUP BY f.id
    ORDER BY f.created_at ASC
  `).all(req.user.id);

  const unfoldered = db.prepare('SELECT COUNT(*) as c FROM bookmarks WHERE user_id = ? AND (folder_id = 0 OR folder_id IS NULL)').get(req.user.id);

  res.json({ folders, unfoldered: unfoldered.c });
});

app.post('/api/bookmark-folders', authMiddleware, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '请输入文件夹名称' });

  const result = db.prepare('INSERT INTO bookmark_folders (user_id, name) VALUES (?, ?)').run(req.user.id, name.trim());
  res.json({ id: result.lastInsertRowid, name: name.trim() });
});

app.put('/api/bookmark-folders/:id', authMiddleware, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '请输入文件夹名称' });

  const folder = db.prepare('SELECT * FROM bookmark_folders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!folder) return res.status(404).json({ error: '文件夹不存在' });

  db.prepare('UPDATE bookmark_folders SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
  res.json({ success: true });
});

app.delete('/api/bookmark-folders/:id', authMiddleware, (req, res) => {
  const folder = db.prepare('SELECT * FROM bookmark_folders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!folder) return res.status(404).json({ error: '文件夹不存在' });

  // Move bookmarks in this folder to unfoldered
  db.prepare('UPDATE bookmarks SET folder_id = 0 WHERE folder_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  db.prepare('DELETE FROM bookmark_folders WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.post('/api/bookmarks/:postId/move', authMiddleware, (req, res) => {
  const { folder_id } = req.body;
  const bookmark = db.prepare('SELECT * FROM bookmarks WHERE user_id = ? AND post_id = ?').get(req.user.id, req.params.postId);
  if (!bookmark) return res.status(404).json({ error: '收藏不存在' });

  db.prepare('UPDATE bookmarks SET folder_id = ? WHERE user_id = ? AND post_id = ?').run(folder_id || 0, req.user.id, req.params.postId);
  res.json({ success: true });
});

// Comments routes
app.post('/api/posts/:id/comments', authMiddleware, postLimiter, (req, res) => {
  let { content, parent_id } = req.body;
  if (!content) return res.status(400).json({ error: '评论内容不能为空' });

  // Apply sensitive word filter
  content = filterContent(content);

  const result = db.prepare('INSERT INTO comments (post_id, user_id, content, parent_id) VALUES (?, ?, ?, ?)').run(req.params.id, req.user.id, content, parent_id || null);

  // Notify post author
  const post = db.prepare('SELECT user_id, title FROM posts WHERE id = ?').get(req.params.id);
  if (post) {
    createNotification(post.user_id, req.user.id, 'comment', req.params.id, result.lastInsertRowid, content.substring(0, 50));
    notifyUser(post.user_id, 'notification', `${req.user.username} 评论了你的帖子`);
  }

  // Notify parent comment author if replying
  if (parent_id) {
    const parentComment = db.prepare('SELECT user_id FROM comments WHERE id = ?').get(parent_id);
    if (parentComment) {
      createNotification(parentComment.user_id, req.user.id, 'reply', req.params.id, result.lastInsertRowid, content.substring(0, 50));
      notifyUser(parentComment.user_id, 'notification', `${req.user.username} 回复了你的评论`);
    }
  }

  // Parse @mentions
  parseMentions(content, req.user.id, req.params.id, result.lastInsertRowid);

  // Check achievements
  checkAchievements(req.user.id);

  res.json({ id: result.lastInsertRowid });
});

app.put('/api/comments/:id', authMiddleware, (req, res) => {
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!comment) return res.status(404).json({ error: '评论不存在' });
  if (comment.user_id !== req.user.id) return res.status(403).json({ error: '只能编辑自己的评论' });

  const { content } = req.body;
  if (!content) return res.status(400).json({ error: '评论内容不能为空' });
  db.prepare('UPDATE comments SET content = ? WHERE id = ?').run(content, req.params.id);
  res.json({ success: true });
});

app.delete('/api/comments/:id', authMiddleware, (req, res) => {
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!comment) return res.status(404).json({ error: '评论不存在' });
  if (comment.user_id !== req.user.id) return res.status(403).json({ error: '只能删除自己的评论' });

  db.prepare('DELETE FROM comment_likes WHERE comment_id IN (SELECT id FROM comments WHERE parent_id = ?)').run(req.params.id);
  db.prepare('DELETE FROM comments WHERE parent_id = ?').run(req.params.id);
  db.prepare('DELETE FROM comment_likes WHERE comment_id = ?').run(req.params.id);
  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.post('/api/comments/:id/like', authMiddleware, (req, res) => {
  const commentId = req.params.id;
  const userId = req.user.id;

  const existing = db.prepare('SELECT 1 FROM comment_likes WHERE user_id = ? AND comment_id = ?').get(userId, commentId);
  if (existing) {
    db.prepare('DELETE FROM comment_likes WHERE user_id = ? AND comment_id = ?').run(userId, commentId);
    db.prepare('UPDATE comments SET likes = likes - 1 WHERE id = ?').run(commentId);
    res.json({ liked: false });
  } else {
    db.prepare('INSERT INTO comment_likes (user_id, comment_id) VALUES (?, ?)').run(userId, commentId);
    db.prepare('UPDATE comments SET likes = likes + 1 WHERE id = ?').run(commentId);

    // Notify comment author
    const comment = db.prepare('SELECT user_id, content FROM comments WHERE id = ?').get(commentId);
    if (comment) createNotification(comment.user_id, userId, 'like_comment', null, commentId, comment.content.substring(0, 50));

    res.json({ liked: true });
  }
});

// Follow system
app.post('/api/users/:id/follow', authMiddleware, (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.user.id) return res.status(400).json({ error: '不能关注自己' });

  const existing = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user.id, targetId);
  if (existing) {
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(req.user.id, targetId);
    res.json({ following: false });
  } else {
    db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)').run(req.user.id, targetId);
    createNotification(targetId, req.user.id, 'follow');
    res.json({ following: true });
  }
});

// Notifications
app.get('/api/notifications', authMiddleware, (req, res) => {
  const { type } = req.query;
  let whereClause = 'WHERE n.user_id = ?';
  const params = [req.user.id];
  if (type && type !== 'all') {
    whereClause += ' AND n.type = ?';
    params.push(type);
  }

  const notifications = db.prepare(`
    SELECT n.*, u.username as from_username, u.avatar as from_avatar
    FROM notifications n
    JOIN users u ON n.from_user_id = u.id
    ${whereClause}
    ORDER BY n.created_at DESC
    LIMIT 50
  `).all(...params);

  const unreadCount = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id).c;

  res.json({ notifications, unreadCount });
});

// Mark all as read
app.post('/api/notifications/read', authMiddleware, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ success: true });
});

// Mark single notification as read
app.post('/api/notifications/:id/read', authMiddleware, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.json({ success: true });
});

// Tags
app.get('/api/tags', (req, res) => {
  const tags = db.prepare(`
    SELECT t.*, COUNT(pt.post_id) as post_count
    FROM tags t LEFT JOIN post_tags pt ON t.id = pt.tag_id
    GROUP BY t.id
    ORDER BY post_count DESC
    LIMIT 30
  `).all();
  res.json(tags);
});

// Tag subscriptions
app.get('/api/tag-subscriptions', authMiddleware, (req, res) => {
  const subscriptions = db.prepare('SELECT tag_name FROM tag_subscriptions WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(subscriptions.map(s => s.tag_name));
});

app.post('/api/tag-subscriptions/:tagName', authMiddleware, (req, res) => {
  const tagName = req.params.tagName;
  try {
    db.prepare('INSERT INTO tag_subscriptions (user_id, tag_name) VALUES (?, ?)').run(req.user.id, tagName);
    res.json({ subscribed: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      db.prepare('DELETE FROM tag_subscriptions WHERE user_id = ? AND tag_name = ?').run(req.user.id, tagName);
      res.json({ subscribed: false });
    } else {
      res.status(500).json({ error: '操作失败' });
    }
  }
});

// User routes
app.get('/api/users/:id', optionalAuth, (req, res) => {
  const user = db.prepare('SELECT id, username, avatar, bio, created_at FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const postCount = db.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id = ?').get(req.params.id).c;
  const commentCount = db.prepare('SELECT COUNT(*) as c FROM comments WHERE user_id = ?').get(req.params.id).c;
  const likeCount = db.prepare('SELECT COALESCE(SUM(likes), 0) as c FROM posts WHERE user_id = ?').get(req.params.id).c;
  const followerCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE following_id = ?').get(req.params.id).c;
  const followingCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE follower_id = ?').get(req.params.id).c;

  let isFollowing = false;
  let isBlocked = false;
  let isBlockedBy = false;
  if (req.user && req.user.id !== Number(req.params.id)) {
    isFollowing = !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user.id, req.params.id);
    isBlocked = !!db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(req.user.id, req.params.id);
    isBlockedBy = !!db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(req.params.id, req.user.id);
  }

  res.json({ ...user, postCount, commentCount, likeCount, followerCount, followingCount, isFollowing, isBlocked, isBlockedBy });
});

app.put('/api/users/:id', authMiddleware, (req, res) => {
  if (String(req.user.id) !== String(req.params.id)) return res.status(403).json({ error: '无权修改' });
  const { bio, avatar } = req.body;
  db.prepare('UPDATE users SET bio = COALESCE(?, bio), avatar = COALESCE(?, avatar) WHERE id = ?').run(bio, avatar, req.user.id);
  const updated = db.prepare('SELECT id, username, avatar, bio FROM users WHERE id = ?').get(req.user.id);
  res.json(updated);
});

// Image upload with compression
const sharp = require('sharp');

async function compressImage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.gif' || ext === '.svg') return; // Skip gif/svg
  try {
    const buffer = await sharp(filePath)
      .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
    const outPath = filePath.replace(/\.[^.]+$/, '.jpg');
    await sharp(buffer).toFile(outPath);
    if (outPath !== filePath) fs.unlinkSync(filePath);
    return path.basename(outPath);
  } catch (e) {
    return path.basename(filePath); // Fallback to original
  }
}

app.post('/api/upload', authMiddleware, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择图片' });
  const finalName = await compressImage(req.file.path);
  res.json({ url: `/uploads/${finalName}`, filename: finalName });
});

// Private Messages
app.get('/api/messages/conversations', authMiddleware, (req, res) => {
  const uid = req.user.id;
  // Get distinct conversation partners
  const partners = db.prepare(`
    SELECT DISTINCT CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as other_id
    FROM messages WHERE sender_id = ? OR receiver_id = ?
  `).all(uid, uid, uid);

  const conversations = partners.map(p => {
    const other = db.prepare('SELECT id, username, avatar FROM users WHERE id = ?').get(p.other_id);
    if (!other) return null;
    const lastMsg = db.prepare(`
      SELECT content, created_at FROM messages
      WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
      ORDER BY created_at DESC LIMIT 1
    `).get(uid, p.other_id, p.other_id, uid);
    const unread = db.prepare('SELECT COUNT(*) as c FROM messages WHERE sender_id = ? AND receiver_id = ? AND is_read = 0')
      .get(p.other_id, uid).c;
    return { other_user_id: other.id, username: other.username, avatar: other.avatar, last_message: lastMsg?.content, last_time: lastMsg?.created_at, unread_count: unread };
  }).filter(Boolean).sort((a, b) => new Date(b.last_time) - new Date(a.last_time));

  res.json(conversations);
});

app.get('/api/messages/:userId', authMiddleware, (req, res) => {
  const otherId = Number(req.params.userId);

  // Mark as read
  db.prepare('UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?').run(otherId, req.user.id);

  const messages = db.prepare(`
    SELECT m.*, u.username as sender_name, u.avatar as sender_avatar
    FROM messages m JOIN users u ON m.sender_id = u.id
    WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
    ORDER BY m.created_at ASC
    LIMIT 100
  `).all(req.user.id, otherId, otherId, req.user.id);

  res.json(messages);
});

app.post('/api/messages/:userId', authMiddleware, (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: '消息不能为空' });
  const receiverId = Number(req.params.userId);
  if (receiverId === req.user.id) return res.status(400).json({ error: '不能给自己发消息' });

  const result = db.prepare('INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)').run(req.user.id, receiverId, content);

  // Create notification
  createNotification(receiverId, req.user.id, 'message', null, null, content.substring(0, 50));

  res.json({ id: result.lastInsertRowid });
});

app.get('/api/messages/unread/count', authMiddleware, (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as c FROM messages WHERE receiver_id = ? AND is_read = 0').get(req.user.id).c;
  res.json({ count });
});

// Reactions
app.post('/api/reactions', authMiddleware, (req, res) => {
  const { post_id, comment_id, emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: '请选择表情' });

  try {
    if (post_id) {
      const existing = db.prepare('SELECT id FROM reactions WHERE user_id = ? AND post_id = ? AND emoji = ?').get(req.user.id, post_id, emoji);
      if (existing) {
        db.prepare('DELETE FROM reactions WHERE id = ?').run(existing.id);
        return res.json({ removed: true });
      }
      db.prepare('INSERT INTO reactions (user_id, post_id, emoji) VALUES (?, ?, ?)').run(req.user.id, post_id, emoji);
    } else if (comment_id) {
      const existing = db.prepare('SELECT id FROM reactions WHERE user_id = ? AND comment_id = ? AND emoji = ?').get(req.user.id, comment_id, emoji);
      if (existing) {
        db.prepare('DELETE FROM reactions WHERE id = ?').run(existing.id);
        return res.json({ removed: true });
      }
      db.prepare('INSERT INTO reactions (user_id, comment_id, emoji) VALUES (?, ?, ?)').run(req.user.id, comment_id, emoji);
    }
    res.json({ added: true });
  } catch (e) {
    res.status(400).json({ error: '操作失败' });
  }
});

app.get('/api/reactions/:type/:id', (req, res) => {
  const { type, id } = req.params;
  const column = type === 'post' ? 'post_id' : 'comment_id';
  const reactions = db.prepare(`
    SELECT emoji, COUNT(*) as count, GROUP_CONCAT(u.username) as users
    FROM reactions r JOIN users u ON r.user_id = u.id
    WHERE ${column} = ?
    GROUP BY emoji
    ORDER BY count DESC
  `).all(id);
  res.json(reactions);
});

// @mention parsing and notification
function parseMentions(content, fromUserId, postId = null, commentId = null) {
  const mentionRegex = /@(\w+)/g;
  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    const username = match[1];
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (user && user.id !== fromUserId) {
      createNotification(user.id, fromUserId, 'mention', postId, commentId, content.substring(0, 50));
    }
  }
}

// Blocks
app.post('/api/users/:id/block', authMiddleware, (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.user.id) return res.status(400).json({ error: '不能屏蔽自己' });

  const existing = db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(req.user.id, targetId);
  if (existing) {
    db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.user.id, targetId);
    res.json({ blocked: false });
  } else {
    db.prepare('INSERT INTO blocks (blocker_id, blocked_id) VALUES (?, ?)').run(req.user.id, targetId);
    // Also unfollow
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(req.user.id, targetId);
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(targetId, req.user.id);
    res.json({ blocked: true });
  }
});

// Achievements
function checkAchievements(userId) {
  const achievements = [];
  const postCount = db.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id = ?').get(userId).c;
  const commentCount = db.prepare('SELECT COUNT(*) as c FROM comments WHERE user_id = ?').get(userId).c;
  const likeCount = db.prepare('SELECT COALESCE(SUM(likes), 0) as c FROM posts WHERE user_id = ?').get(userId).c;
  const followerCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE following_id = ?').get(userId).c;

  if (postCount >= 1) achievements.push({ type: 'first_post', name: '初出茅庐', icon: '✍️' });
  if (postCount >= 5) achievements.push({ type: 'post_5', name: '小有成就', icon: '📝' });
  if (postCount >= 10) achievements.push({ type: 'post_10', name: '笔耕不辍', icon: '📚' });
  if (commentCount >= 1) achievements.push({ type: 'first_comment', name: '畅所欲言', icon: '💬' });
  if (commentCount >= 10) achievements.push({ type: 'comment_10', name: '热心网友', icon: '🗣️' });
  if (likeCount >= 10) achievements.push({ type: 'like_10', name: '初受欢迎', icon: '❤️' });
  if (likeCount >= 50) achievements.push({ type: 'like_50', name: '广受好评', icon: '🔥' });
  if (likeCount >= 100) achievements.push({ type: 'like_100', name: '万人迷', icon: '⭐' });
  if (followerCount >= 1) achievements.push({ type: 'first_follower', name: '初露头角', icon: '👥' });
  if (followerCount >= 5) achievements.push({ type: 'follower_5', name: '小有名气', icon: '🌟' });
  if (followerCount >= 10) achievements.push({ type: 'follower_10', name: '网红达人', icon: '👑' });

  const insert = db.prepare('INSERT OR IGNORE INTO achievements (user_id, type, name, icon) VALUES (?, ?, ?, ?)');
  achievements.forEach(a => insert.run(userId, a.type, a.name, a.icon));
}

app.get('/api/users/:id/achievements', (req, res) => {
  const achievements = db.prepare('SELECT * FROM achievements WHERE user_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(achievements);
});

// Change password
app.put('/api/users/:id/password', authMiddleware, (req, res) => {
  if (String(req.user.id) !== String(req.params.id)) return res.status(403).json({ error: '无权修改' });
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error: '请填写完整' });
  if (newPassword.length < 6) return res.status(400).json({ error: '新密码至少6个字符' });

  const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(oldPassword, user.password)) return res.status(400).json({ error: '原密码错误' });

  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
  res.json({ success: true });
});

// Security question migration
try { db.exec("ALTER TABLE users ADD COLUMN security_question TEXT DEFAULT ''"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN security_answer TEXT DEFAULT ''"); } catch(e) {}

// Password reset via security question
app.post('/api/reset-password', authLimiter, (req, res) => {
  const { username, answer, newPassword } = req.body;
  if (!username || !answer || !newPassword) return res.status(400).json({ error: '请填写完整' });
  if (newPassword.length < 6) return res.status(400).json({ error: '新密码至少6个字符' });

  const user = db.prepare('SELECT id, security_question, security_answer FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (!user.security_question) return res.status(400).json({ error: '该用户未设置安全问题' });
  if (!verifyPassword(answer, user.security_answer)) return res.status(400).json({ error: '安全问题答案错误' });

  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(newPassword), user.id);
  res.json({ success: true });
});

// Get security question for reset
app.post('/api/get-security-question', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: '请输入用户名' });
  const user = db.prepare('SELECT security_question FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (!user.security_question) return res.status(400).json({ error: '该用户未设置安全问题' });
  res.json({ question: user.security_question });
});

// Set security question
app.put('/api/users/:id/security-question', authMiddleware, (req, res) => {
  if (String(req.user.id) !== String(req.params.id)) return res.status(403).json({ error: '无权修改' });
  const { question, answer } = req.body;
  if (!question || !answer) return res.status(400).json({ error: '请填写完整' });
  db.prepare('UPDATE users SET security_question = ?, security_answer = ? WHERE id = ?')
    .run(question, hashPassword(answer), req.user.id);
  res.json({ success: true });
});

// Account deletion
app.delete('/api/users/:id', authMiddleware, (req, res) => {
  if (String(req.user.id) !== String(req.params.id)) return res.status(403).json({ error: '只能注销自己的账号' });
  const userId = req.user.id;

  const deleteAccount = db.transaction(() => {
    // Delete user's posts and related data
    const postIds = db.prepare('SELECT id FROM posts WHERE user_id = ?').all(userId).map(p => p.id);
    for (const pid of postIds) {
      db.prepare('DELETE FROM post_tags WHERE post_id = ?').run(pid);
      db.prepare('DELETE FROM post_likes WHERE post_id = ?').run(pid);
      db.prepare('DELETE FROM post_history WHERE post_id = ?').run(pid);
      db.prepare('DELETE FROM comments WHERE post_id = ?').run(pid);
    }
    db.prepare('DELETE FROM posts WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM comments WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM comment_likes WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM post_likes WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM bookmarks WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM follows WHERE follower_id = ? OR following_id = ?').run(userId, userId);
    db.prepare('DELETE FROM notifications WHERE user_id = ? OR from_user_id = ?').run(userId, userId);
    db.prepare('DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?').run(userId, userId);
    db.prepare('DELETE FROM reports WHERE reporter_id = ?').run(userId);
    db.prepare('DELETE FROM drafts WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM achievements WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM reactions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM collection_posts WHERE post_id IN (SELECT id FROM collections WHERE user_id = ?)').run(userId);
    db.prepare('DELETE FROM collections WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM tag_subscriptions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM bookmark_folders WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });

  try {
    deleteAccount();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '注销失败' });
  }
});

// Activity timeline
app.get('/api/users/:id/activity', (req, res) => {
  const userId = Number(req.params.id);
  const limit = 20;

  const posts = db.prepare(`
    SELECT 'post' as type, id, title as content, created_at, category FROM posts WHERE user_id = ?
  `).all(userId);

  const comments = db.prepare(`
    SELECT 'comment' as type, c.id, c.content, c.created_at, p.title as post_title, p.id as post_id
    FROM comments c JOIN posts p ON c.post_id = p.id WHERE c.user_id = ?
  `).all(userId);

  const likes = db.prepare(`
    SELECT 'like' as type, pl.post_id, p.title as post_title, p.created_at
    FROM post_likes pl JOIN posts p ON pl.post_id = p.id WHERE pl.user_id = ?
  `).all(userId);

  const follows = db.prepare(`
    SELECT 'follow' as type, f.following_id, u.username, f.created_at
    FROM follows f JOIN users u ON f.following_id = u.id WHERE f.follower_id = ?
  `).all(userId);

  const all = [...posts, ...comments, ...likes, ...follows]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);

  res.json(all);
});

// Reports
app.post('/api/reports', authMiddleware, (req, res) => {
  const { post_id, comment_id, reason, description } = req.body;
  if (!reason) return res.status(400).json({ error: '请填写举报原因' });
  if (!post_id && !comment_id) return res.status(400).json({ error: '请选择举报内容' });

  // Check if already reported
  const existing = db.prepare('SELECT id FROM reports WHERE reporter_id = ? AND (post_id = ? OR comment_id = ?)').get(req.user.id, post_id, comment_id);
  if (existing) return res.status(400).json({ error: '已经举报过了' });

  db.prepare('INSERT INTO reports (reporter_id, post_id, comment_id, reason, description) VALUES (?, ?, ?, ?, ?)').run(req.user.id, post_id, comment_id, reason, description || null);
  res.json({ success: true });
});

app.get('/api/reports', authMiddleware, (req, res) => {
  // Simple admin check - first user is admin
  if (req.user.id !== 1) return res.status(403).json({ error: '无权访问' });

  const reports = db.prepare(`
    SELECT r.*, u.username as reporter_name,
      p.title as post_title, p.content as post_content,
      c.content as comment_content
    FROM reports r
    JOIN users u ON r.reporter_id = u.id
    LEFT JOIN posts p ON r.post_id = p.id
    LEFT JOIN comments c ON r.comment_id = c.id
    ORDER BY r.created_at DESC
    LIMIT 50
  `).all();

  res.json(reports);
});

app.put('/api/reports/:id', authMiddleware, (req, res) => {
  if (req.user.id !== 1) return res.status(403).json({ error: '无权操作' });
  const { status } = req.body;
  db.prepare('UPDATE reports SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ success: true });
});

// Trending topics
app.get('/api/trending', (req, res) => {
  const trending = cached('trending', 60000, () => db.prepare(`
    SELECT t.name, COUNT(pt.post_id) as post_count,
      COALESCE(SUM(p.likes), 0) as total_likes,
      COALESCE(SUM(p.views), 0) as total_views
    FROM tags t
    JOIN post_tags pt ON t.id = pt.tag_id
    JOIN posts p ON pt.post_id = p.id
    WHERE p.created_at > datetime('now', '-7 days')
    GROUP BY t.id
    ORDER BY (total_likes * 2 + total_views + post_count * 10) DESC
    LIMIT 10
  `).all());
  res.json(trending);
});

// Announcements
app.get('/api/announcements', (req, res) => {
  const announcements = db.prepare('SELECT * FROM announcements WHERE is_active = 1 ORDER BY created_at DESC LIMIT 5').all();
  res.json(announcements);
});

app.post('/api/announcements', authMiddleware, (req, res) => {
  if (req.user.id !== 1) return res.status(403).json({ error: '只有管理员可以发布公告' });
  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: '标题和内容不能为空' });

  db.prepare('INSERT INTO announcements (title, content) VALUES (?, ?)').run(title, content);
  res.json({ success: true });
});

app.delete('/api/announcements/:id', authMiddleware, (req, res) => {
  if (req.user.id !== 1) return res.status(403).json({ error: '只有管理员可以删除公告' });
  db.prepare('UPDATE announcements SET is_active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Collections
app.get('/api/collections', (req, res) => {
  const { user_id } = req.query;
  let query = 'SELECT c.*, u.username, (SELECT COUNT(*) FROM collection_posts WHERE collection_id = c.id) as post_count FROM collections c JOIN users u ON c.user_id = u.id';
  const params = [];

  if (user_id) {
    query += ' WHERE c.user_id = ?';
    params.push(user_id);
  }

  query += ' ORDER BY c.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

app.get('/api/collections/:id', (req, res) => {
  const collection = db.prepare(`
    SELECT c.*, u.username FROM collections c JOIN users u ON c.user_id = u.id WHERE c.id = ?
  `).get(req.params.id);
  if (!collection) return res.status(404).json({ error: '合集不存在' });

  const posts = db.prepare(`
    SELECT p.*, u.username, u.avatar, cp.sort_order
    FROM collection_posts cp
    JOIN posts p ON cp.post_id = p.id
    JOIN users u ON p.user_id = u.id
    WHERE cp.collection_id = ?
    ORDER BY cp.sort_order ASC
  `).all(req.params.id);

  res.json({ ...collection, posts });
});

app.post('/api/collections', authMiddleware, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: '请输入合集名称' });

  const result = db.prepare('INSERT INTO collections (user_id, name, description) VALUES (?, ?, ?)').run(req.user.id, name, description || '');
  res.json({ id: result.lastInsertRowid });
});

app.post('/api/collections/:id/posts', authMiddleware, (req, res) => {
  const { post_id } = req.body;
  const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(req.params.id);
  if (!collection) return res.status(404).json({ error: '合集不存在' });
  if (collection.user_id !== req.user.id) return res.status(403).json({ error: '只能管理自己的合集' });

  try {
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM collection_posts WHERE collection_id = ?').get(req.params.id).m || 0;
    db.prepare('INSERT INTO collection_posts (collection_id, post_id, sort_order) VALUES (?, ?, ?)').run(req.params.id, post_id, maxOrder + 1);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: '帖子已在合集中' });
  }
});

app.delete('/api/collections/:id/posts/:postId', authMiddleware, (req, res) => {
  const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(req.params.id);
  if (!collection) return res.status(404).json({ error: '合集不存在' });
  if (collection.user_id !== req.user.id) return res.status(403).json({ error: '只能管理自己的合集' });

  db.prepare('DELETE FROM collection_posts WHERE collection_id = ? AND post_id = ?').run(req.params.id, req.params.postId);
  res.json({ success: true });
});

// User level system
function calculateUserLevel(userId) {
  const postCount = db.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id = ?').get(userId).c;
  const commentCount = db.prepare('SELECT COUNT(*) as c FROM comments WHERE user_id = ?').get(userId).c;
  const likeCount = db.prepare('SELECT COALESCE(SUM(likes), 0) as c FROM posts WHERE user_id = ?').get(userId).c;
  const followerCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE following_id = ?').get(userId).c;

  const score = postCount * 10 + commentCount * 3 + likeCount * 2 + followerCount * 15;

  let level = 1;
  let title = '新手上路';
  let icon = '🌱';

  if (score >= 500) { level = 6; title = '社区元老'; icon = '👑'; }
  else if (score >= 300) { level = 5; title = '意见领袖'; icon = '⭐'; }
  else if (score >= 150) { level = 4; title = '活跃达人'; icon = '🔥'; }
  else if (score >= 80) { level = 3; title = '资深用户'; icon = '💎'; }
  else if (score >= 30) { level = 2; title = '进阶用户'; icon = '🌿'; }

  return { level, title, icon, score };
}

app.get('/api/users/:id/level', (req, res) => {
  const level = calculateUserLevel(Number(req.params.id));
  res.json(level);
});

// Sensitive word filter
const SENSITIVE_WORDS = ['傻逼', '操你', '去死', '垃圾', '废物', '白痴', '混蛋'];

function filterContent(text) {
  let filtered = text;
  SENSITIVE_WORDS.forEach(word => {
    const regex = new RegExp(word, 'gi');
    filtered = filtered.replace(regex, '*'.repeat(word.length));
  });
  return filtered;
}

// Following feed
app.get('/api/feed', authMiddleware, (req, res) => {
  const { page = 1 } = req.query;
  const limit = 20;
  const offset = (page - 1) * limit;

  const posts = db.prepare(`
    SELECT p.*, u.username, u.avatar,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `).all(req.user.id, limit, offset);

  const total = db.prepare(`
    SELECT COUNT(*) as c FROM posts WHERE user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
  `).get(req.user.id).c;

  const bookmarked = db.prepare('SELECT post_id FROM bookmarks WHERE user_id = ?').all(req.user.id).map(r => r.post_id);
  posts.forEach(p => {
    p.bookmarked = bookmarked.includes(p.id);
  });
  batchFetchTags(posts);

  res.json({ posts, total, page: Number(page), hasMore: offset + limit < total });
});

// Check new posts (for polling)
app.get('/api/check-new', optionalAuth, (req, res) => {
  const { after } = req.query;
  if (!after) return res.json({ newPosts: 0, newNotifications: 0 });

  const newPosts = db.prepare('SELECT COUNT(*) as c FROM posts WHERE created_at > ?').get(after).c;
  let newNotifications = 0;
  if (req.user) {
    newNotifications = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0 AND created_at > ?').get(req.user.id, after).c;
  }

  res.json({ newPosts, newNotifications });
});

// Stats
// Batch fetch tags for a list of posts (avoids N+1 queries)
function batchFetchTags(posts) {
  if (!posts || posts.length === 0) return;
  const postIds = posts.map(p => p.id);
  const placeholders = postIds.map(() => '?').join(',');
  const tagRows = db.prepare(`
    SELECT pt.post_id, t.name FROM tags t
    JOIN post_tags pt ON t.id = pt.tag_id
    WHERE pt.post_id IN (${placeholders})
  `).all(...postIds);
  const tagMap = {};
  tagRows.forEach(r => { if (!tagMap[r.post_id]) tagMap[r.post_id] = []; tagMap[r.post_id].push(r.name); });
  posts.forEach(p => p.tags = tagMap[p.id] || []);
}

// Simple in-memory cache
const cache = new Map();
function cached(key, ttlMs, fn) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.time < ttlMs) return entry.value;
  const value = fn();
  cache.set(key, { value, time: Date.now() });
  return value;
}

app.get('/api/stats', (req, res) => {
  const data = cached('stats', 30000, () => ({
    users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    posts: db.prepare('SELECT COUNT(*) as c FROM posts').get().c,
    comments: db.prepare('SELECT COUNT(*) as c FROM comments').get().c,
    totalViews: db.prepare('SELECT COALESCE(SUM(views), 0) as c FROM posts').get().c,
  }));
  res.json(data);
});

// ==================== Phase 7 Features ====================

// Update user last active timestamp
app.post('/api/heartbeat', authMiddleware, (req, res) => {
  db.prepare('UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = ?').run(req.user.id);
  res.json({ success: true });
});

// Get user online status
app.get('/api/users/:id/status', (req, res) => {
  const user = db.prepare('SELECT last_active FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const lastActive = new Date(user.last_active + 'Z');
  const now = new Date();
  const diffMinutes = (now - lastActive) / 1000 / 60;

  let status = 'offline';
  if (diffMinutes < 5) status = 'online';
  else if (diffMinutes < 30) status = 'away';

  res.json({ status, last_active: user.last_active });
});

// Get online users count and list
app.get('/api/online-users', (req, res) => {
  const onlineUsers = db.prepare(`
    SELECT id, username, avatar, last_active
    FROM users
    WHERE last_active > datetime('now', '-5 minutes')
    ORDER BY last_active DESC
  `).all();

  const awayUsers = db.prepare(`
    SELECT id, username, avatar, last_active
    FROM users
    WHERE last_active > datetime('now', '-30 minutes')
    AND last_active <= datetime('now', '-5 minutes')
    ORDER BY last_active DESC
  `).all();

  res.json({
    online: onlineUsers.length,
    away: awayUsers.length,
    total: onlineUsers.length + awayUsers.length,
    users: onlineUsers
  });
});

// Comment voting (upvote/downvote)
app.post('/api/comments/:id/vote', authMiddleware, (req, res) => {
  const { vote } = req.body; // 1 for upvote, -1 for downvote
  const commentId = req.params.id;
  const userId = req.user.id;

  if (vote !== 1 && vote !== -1) return res.status(400).json({ error: '无效的投票值' });

  const existing = db.prepare('SELECT vote FROM comment_votes WHERE user_id = ? AND comment_id = ?').get(userId, commentId);

  if (existing) {
    if (existing.vote === vote) {
      // Remove vote
      db.prepare('DELETE FROM comment_votes WHERE user_id = ? AND comment_id = ?').run(userId, commentId);
      db.prepare('UPDATE comments SET likes = likes - ? WHERE id = ?').run(vote, commentId);
      res.json({ action: 'removed', vote: 0 });
    } else {
      // Change vote
      db.prepare('UPDATE comment_votes SET vote = ? WHERE user_id = ? AND comment_id = ?').run(vote, userId, commentId);
      db.prepare('UPDATE comments SET likes = likes + ? WHERE id = ?').run(vote * 2, commentId);
      res.json({ action: 'changed', vote });
    }
  } else {
    // New vote
    db.prepare('INSERT INTO comment_votes (user_id, comment_id, vote) VALUES (?, ?, ?)').run(userId, commentId, vote);
    db.prepare('UPDATE comments SET likes = likes + ? WHERE id = ?').run(vote, commentId);
    res.json({ action: 'added', vote });
  }
});

// Get comment votes for current user
app.get('/api/comments/votes', authMiddleware, (req, res) => {
  const votes = db.prepare('SELECT comment_id, vote FROM comment_votes WHERE user_id = ?').all(req.user.id);
  res.json(votes);
});

// Featured/Essence posts
app.put('/api/posts/:id/featured', authMiddleware, (req, res) => {
  if (req.user.id !== 1) return res.status(403).json({ error: '只有管理员可以设置精华帖' });

  const post = db.prepare('SELECT is_featured FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '帖子不存在' });

  const newFeatured = post.is_featured ? 0 : 1;
  db.prepare('UPDATE posts SET is_featured = ? WHERE id = ?').run(newFeatured, req.params.id);
  res.json({ is_featured: newFeatured });
});

// Drafts API
app.get('/api/drafts', authMiddleware, (req, res) => {
  const drafts = db.prepare('SELECT * FROM drafts WHERE user_id = ? ORDER BY updated_at DESC').all(req.user.id);
  res.json(drafts);
});

app.post('/api/drafts', authMiddleware, (req, res) => {
  const { title, content, category, tags, post_id } = req.body;

  if (post_id) {
    // Update existing draft
    const existing = db.prepare('SELECT id FROM drafts WHERE user_id = ? AND post_id = ?').get(req.user.id, post_id);
    if (existing) {
      db.prepare('UPDATE drafts SET title = ?, content = ?, category = ?, tags = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(title, content, category, JSON.stringify(tags || []), existing.id);
      return res.json({ id: existing.id });
    }
  }

  const result = db.prepare('INSERT INTO drafts (user_id, title, content, category, tags, post_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.user.id, title || '', content || '', category || '综合', JSON.stringify(tags || []), post_id || null);
  res.json({ id: result.lastInsertRowid });
});

app.delete('/api/drafts/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM drafts WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

// Enhanced comments with vote info
app.get('/api/posts/:id/comments', optionalAuth, (req, res) => {
  const { sort } = req.query;
  let orderBy = 'c.created_at ASC';
  if (sort === 'hot') orderBy = 'c.likes DESC, c.created_at ASC';
  if (sort === 'new') orderBy = 'c.created_at DESC';

  const comments = db.prepare(`
    SELECT c.*, u.username, u.avatar,
      (SELECT last_active FROM users WHERE id = c.user_id) as user_last_active
    FROM comments c JOIN users u ON c.user_id = u.id
    WHERE c.post_id = ? ORDER BY ${orderBy}
  `).all(req.params.id);

  if (req.user) {
    const likedComments = db.prepare('SELECT comment_id FROM comment_likes WHERE user_id = ?').all(req.user.id).map(r => r.comment_id);
    const votedComments = db.prepare('SELECT comment_id, vote FROM comment_votes WHERE user_id = ?').all(req.user.id);
    const voteMap = {};
    votedComments.forEach(v => voteMap[v.comment_id] = v.vote);

    comments.forEach(c => {
      c.liked = likedComments.includes(c.id);
      c.userVote = voteMap[c.id] || 0;
    });
  }

  res.json(comments);
});

// Enhanced posts list with featured
app.get('/api/posts', optionalAuth, (req, res) => {
  const { category = '全部', sort = 'new', page = 1, tag, search } = req.query;
  const limit = 20;
  const offset = (page - 1) * limit;

  let query = `
    SELECT p.*, u.username, u.avatar,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM posts p JOIN users u ON p.user_id = u.id
  `;
  const params = [];
  const conditions = [];

  if (category && category !== '全部') {
    conditions.push('p.category = ?');
    params.push(category);
  }

  if (tag) {
    query = `
      SELECT p.*, u.username, u.avatar,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
      FROM posts p JOIN users u ON p.user_id = u.id
      JOIN post_tags pt ON p.id = pt.post_id
      JOIN tags t ON pt.tag_id = t.id
    `;
    conditions.push('t.name = ?');
    params.push(tag);
  }

  if (search) {
    conditions.push('(p.title LIKE ? OR p.content LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  // Block filter
  if (req.user) {
    conditions.push(`p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)`);
    params.push(req.user.id);
  }

  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');

  let orderBy = 'p.is_pinned DESC, p.created_at DESC';
  if (sort === 'hot') orderBy = 'p.is_pinned DESC, (p.likes * 2 + p.views) DESC';
  else if (sort === 'views') orderBy = 'p.is_pinned DESC, p.views DESC';
  else if (sort === 'featured') orderBy = 'p.is_featured DESC, p.is_pinned DESC, p.created_at DESC';

  query += ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const posts = db.prepare(query).all(...params);

  // Count total
  let countQuery = 'SELECT COUNT(*) as c FROM posts p';
  const countParams = [];
  const countConditions = [];

  if (tag) {
    countQuery = 'SELECT COUNT(*) as c FROM posts p JOIN post_tags pt ON p.id = pt.post_id JOIN tags t ON pt.tag_id = t.id';
    countConditions.push('t.name = ?');
    countParams.push(tag);
  }

  if (category && category !== '全部') {
    countConditions.push('p.category = ?');
    countParams.push(category);
  }

  if (search) {
    countConditions.push('(p.title LIKE ? OR p.content LIKE ?)');
    countParams.push(`%${search}%`, `%${search}%`);
  }

  if (req.user) {
    countConditions.push(`p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)`);
    countParams.push(req.user.id);
  }

  if (countConditions.length > 0) countQuery += ' WHERE ' + countConditions.join(' AND ');

  const total = db.prepare(countQuery).get(...countParams).c;

  // Add bookmarked status and tags
  if (req.user) {
    const bookmarked = db.prepare('SELECT post_id FROM bookmarks WHERE user_id = ?').all(req.user.id).map(r => r.post_id);
    posts.forEach(p => p.bookmarked = bookmarked.includes(p.id));
  }

  // Batch fetch tags for all posts
  batchFetchTags(posts);

  res.json({ posts, total, page: Number(page), hasMore: offset + limit < total });
});

// ==================== Phase 8 Features ====================

// Post edit history
app.get('/api/posts/:id/history', (req, res) => {
  const history = db.prepare(`
    SELECT h.*, u.username
    FROM post_history h JOIN users u ON h.edited_by = u.id
    WHERE h.post_id = ? ORDER BY h.edited_at DESC
  `).all(req.params.id);
  res.json(history);
});

// Post stats for trend chart
app.get('/api/posts/:id/stats', (req, res) => {
  const post = db.prepare('SELECT views, likes, created_at FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '帖子不存在' });

  // Get like history from post_likes
  const likeHistory = db.prepare(`
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM post_likes WHERE post_id = ?
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all(req.params.id);

  // Generate mock view history based on current views and creation date
  const createdDate = new Date(post.created_at);
  const now = new Date();
  const daysDiff = Math.max(1, Math.ceil((now - createdDate) / (1000 * 60 * 60 * 24)));

  // Distribute views across days with some randomness
  const viewHistory = [];
  let remainingViews = post.views;
  for (let i = 0; i < daysDiff && remainingViews > 0; i++) {
    const date = new Date(createdDate);
    date.setDate(date.getDate() + i);
    const dayViews = Math.min(remainingViews, Math.floor(Math.random() * (post.views / daysDiff * 2)));
    remainingViews -= dayViews;
    viewHistory.push({
      date: date.toISOString().split('T')[0],
      views: dayViews
    });
  }

  // Like history from actual data
  const likesByDate = {};
  likeHistory.forEach(l => { likesByDate[l.date] = l.count; });

  res.json({
    totalViews: post.views,
    totalLikes: post.likes,
    viewHistory,
    likeHistory: likeHistory
  });
});

// Scheduled posts
app.get('/api/scheduled', authMiddleware, (req, res) => {
  const posts = db.prepare('SELECT * FROM scheduled_posts WHERE user_id = ? AND status = ? ORDER BY scheduled_at ASC')
    .all(req.user.id, 'pending');
  res.json(posts);
});

app.post('/api/scheduled', authMiddleware, (req, res) => {
  const { title, content, category, tags, scheduled_at } = req.body;
  if (!title || !content || !scheduled_at) return res.status(400).json({ error: '标题、内容和发布时间不能为空' });

  const result = db.prepare('INSERT INTO scheduled_posts (user_id, title, content, category, tags, scheduled_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.user.id, title, content, category || '综合', JSON.stringify(tags || []), scheduled_at);
  res.json({ id: result.lastInsertRowid });
});

app.delete('/api/scheduled/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM scheduled_posts WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

// Group chat
app.get('/api/groups', authMiddleware, (req, res) => {
  const groups = db.prepare(`
    SELECT g.*, u.username as creator_name,
      (SELECT COUNT(*) FROM group_chat_members WHERE group_id = g.id) as member_count,
      (SELECT content FROM group_messages WHERE group_id = g.id ORDER BY created_at DESC LIMIT 1) as last_message
    FROM group_chats g
    JOIN users u ON g.created_by = u.id
    WHERE g.id IN (SELECT group_id FROM group_chat_members WHERE user_id = ?)
    ORDER BY g.created_at DESC
  `).all(req.user.id);
  res.json(groups);
});

app.post('/api/groups', authMiddleware, (req, res) => {
  const { name, members } = req.body;
  if (!name) return res.status(400).json({ error: '请输入群名称' });

  const result = db.prepare('INSERT INTO group_chats (name, created_by) VALUES (?, ?)').run(name, req.user.id);
  const groupId = result.lastInsertRowid;

  // Add creator as member
  db.prepare('INSERT INTO group_chat_members (group_id, user_id) VALUES (?, ?)').run(groupId, req.user.id);

  // Add other members
  if (members && Array.isArray(members)) {
    const insertMember = db.prepare('INSERT OR IGNORE INTO group_chat_members (group_id, user_id) VALUES (?, ?)');
    members.forEach(userId => insertMember.run(groupId, userId));
  }

  res.json({ id: groupId });
});

app.get('/api/groups/:id/messages', authMiddleware, (req, res) => {
  const { page = 1 } = req.query;
  const limit = 50;
  const offset = (page - 1) * limit;

  // Check if user is member
  const member = db.prepare('SELECT 1 FROM group_chat_members WHERE group_id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!member) return res.status(403).json({ error: '你不是群成员' });

  const messages = db.prepare(`
    SELECT m.*, u.username, u.avatar
    FROM group_messages m JOIN users u ON m.user_id = u.id
    WHERE m.group_id = ?
    ORDER BY m.created_at DESC
    LIMIT ? OFFSET ?
  `).all(req.params.id, limit, offset);

  res.json(messages.reverse());
});

app.post('/api/groups/:id/messages', authMiddleware, (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: '消息不能为空' });

  // Check if user is member
  const member = db.prepare('SELECT 1 FROM group_chat_members WHERE group_id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!member) return res.status(403).json({ error: '你不是群成员' });

  const result = db.prepare('INSERT INTO group_messages (group_id, user_id, content) VALUES (?, ?, ?)')
    .run(req.params.id, req.user.id, content);

  // Notify group members
  const members = db.prepare('SELECT user_id FROM group_chat_members WHERE group_id = ? AND user_id != ?')
    .all(req.params.id, req.user.id);
  members.forEach(m => {
    notifyUser(m.user_id, 'group_message', `新群消息`, { groupId: parseInt(req.params.id) });
  });

  res.json({ id: result.lastInsertRowid });
});

// User ban/mute (admin)
app.post('/api/users/:id/ban', authMiddleware, (req, res) => {
  if (req.user.id !== 1) return res.status(403).json({ error: '无权操作' });
  const { reason, ban_type, duration_hours } = req.body;

  const expiresAt = duration_hours ?
    new Date(Date.now() + duration_hours * 60 * 60 * 1000).toISOString() : null;

  db.prepare('INSERT INTO user_bans (user_id, banned_by, reason, ban_type, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.params.id, req.user.id, reason || '', ban_type || 'ban', expiresAt);
  res.json({ success: true });
});

app.delete('/api/users/:id/ban', authMiddleware, (req, res) => {
  if (req.user.id !== 1) return res.status(403).json({ error: '无权操作' });
  db.prepare('DELETE FROM user_bans WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime(\'now\'))')
    .run(req.params.id);
  res.json({ success: true });
});

app.get('/api/users/:id/ban-status', (req, res) => {
  const ban = db.prepare('SELECT * FROM user_bans WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime(\'now\')) ORDER BY created_at DESC LIMIT 1')
    .get(req.params.id);
  res.json({ banned: !!ban, ban });
});

// Admin statistics
app.get('/api/admin/stats', authMiddleware, (req, res) => {
  if (req.user.id !== 1) return res.status(403).json({ error: '无权访问' });

  const today = new Date().toISOString().split('T')[0];

  const stats = {
    totalUsers: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    totalPosts: db.prepare('SELECT COUNT(*) as c FROM posts').get().c,
    totalComments: db.prepare('SELECT COUNT(*) as c FROM comments').get().c,
    totalViews: db.prepare('SELECT COALESCE(SUM(views), 0) as c FROM posts').get().c,
    todayUsers: db.prepare('SELECT COUNT(*) as c FROM users WHERE DATE(created_at) = ?').get(today).c,
    todayPosts: db.prepare('SELECT COUNT(*) as c FROM posts WHERE DATE(created_at) = ?').get(today).c,
    todayComments: db.prepare('SELECT COUNT(*) as c FROM comments WHERE DATE(created_at) = ?').get(today).c,
    activeUsers: db.prepare('SELECT COUNT(*) as c FROM users WHERE last_active > datetime(\'now\', \'-7 days\')').get().c,
    pendingReports: db.prepare('SELECT COUNT(*) as c FROM reports WHERE status = \'pending\'').get().c,
    bannedUsers: db.prepare('SELECT COUNT(*) as c FROM user_bans WHERE expires_at IS NULL OR expires_at > datetime(\'now\')').get().c,
    topPosts: db.prepare('SELECT id, title, likes, views FROM posts ORDER BY likes DESC LIMIT 5').all(),
    topUsers: db.prepare('SELECT u.id, u.username, u.avatar, COUNT(p.id) as post_count FROM users u LEFT JOIN posts p ON u.id = p.user_id GROUP BY u.id ORDER BY post_count DESC LIMIT 5').all(),
    categoryStats: db.prepare('SELECT category, COUNT(*) as count FROM posts GROUP BY category ORDER BY count DESC').all(),
  };

  res.json(stats);
});

// Batch operations (admin)
app.post('/api/admin/batch-delete', authMiddleware, (req, res) => {
  if (req.user.id !== 1) return res.status(403).json({ error: '无权操作' });
  const { post_ids } = req.body;
  if (!post_ids || !Array.isArray(post_ids)) return res.status(400).json({ error: '请选择帖子' });

  const deletePost = db.prepare('DELETE FROM posts WHERE id = ?');
  const transaction = db.transaction(() => {
    post_ids.forEach(id => deletePost.run(id));
  });
  transaction();
  res.json({ success: true, deleted: post_ids.length });
});

app.post('/api/admin/batch-pin', authMiddleware, (req, res) => {
  if (req.user.id !== 1) return res.status(403).json({ error: '无权操作' });
  const { post_ids, pin } = req.body;
  if (!post_ids || !Array.isArray(post_ids)) return res.status(400).json({ error: '请选择帖子' });

  const updatePin = db.prepare('UPDATE posts SET is_pinned = ? WHERE id = ?');
  const transaction = db.transaction(() => {
    post_ids.forEach(id => updatePin.run(pin ? 1 : 0, id));
  });
  transaction();
  res.json({ success: true, updated: post_ids.length });
});

// Multi-image upload with compression
app.post('/api/upload/multiple', authMiddleware, upload.array('images', 9), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: '请选择图片' });

  const urls = [];
  for (const file of req.files) {
    const finalName = await compressImage(file.path);
    urls.push(`/uploads/${finalName}`);
  }
  res.json({ urls });
});

// Check scheduled posts (called by cron or interval)
setInterval(() => {
  const now = new Date().toISOString();
  const scheduled = db.prepare('SELECT * FROM scheduled_posts WHERE status = ? AND scheduled_at <= ?')
    .all('pending', now);

  scheduled.forEach(post => {
    const result = db.prepare('INSERT INTO posts (user_id, title, content, category) VALUES (?, ?, ?, ?)')
      .run(post.user_id, post.title, post.content, post.category);

    // Handle tags
    try {
      const tags = JSON.parse(post.tags);
      if (Array.isArray(tags)) {
        const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
        const getTagId = db.prepare('SELECT id FROM tags WHERE name = ?');
        const insertPostTag = db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)');

        tags.forEach(tagName => {
          const name = tagName.trim();
          if (name) {
            insertTag.run(name);
            const tag = getTagId.get(name);
            if (tag) insertPostTag.run(result.lastInsertRowid, tag.id);
          }
        });
      }
    } catch(e) {}

    db.prepare('UPDATE scheduled_posts SET status = ? WHERE id = ?').run('published', post.id);
  });
}, 60000); // Check every minute

// WebSocket handling
const clients = new Map(); // userId -> WebSocket

// WebSocket heartbeat — ping every 30s, clean up dead connections
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('connection', (ws) => {
  ws.isAlive = true;
  let userId = null;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'auth' && data.token) {
        // Verify JWT token instead of trusting client userId
        try {
          const payload = jwt.verify(data.token, JWT_SECRET);
          userId = payload.id;
          clients.set(userId, ws);
        } catch (e) { /* invalid token */ }
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    if (userId) clients.delete(userId);
  });
});

// Broadcast notification to user
function notifyUser(userId, type, message, extra = {}) {
  const ws = clients.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, message, ...extra }));
  }
}

// Broadcast new post to all connected users
function broadcastNewPost(post) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'new_post', post }));
    }
  });
}

// Override app.listen to use server.listen
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
