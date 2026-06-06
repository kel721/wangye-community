let currentUser = null;
let currentCategory = '全部';
let currentSort = 'new';
let currentPage = 1;
let hasMore = true;
let isLoadingMore = false;
let currentView = 'list';
let currentPostId = null;
let editingPostId = null;
let selectedAvatar = '';
let searchQuery = '';
let currentTag = '';
let postTags = [];
let infiniteObserver = null;
let focusedPostIndex = -1;
let postCards = [];
let commentSort = 'new';
let pollInterval = null;
let lastCheckTime = new Date().toISOString();
let draftTimer = null;

function initDarkMode() {
  const saved = localStorage.getItem('darkMode');
  if (saved === 'true' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
}

function toggleDarkMode() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
  localStorage.setItem('darkMode', !isDark);
  updateThemeButton();
}

function updateThemeButton() {
  const btn = document.querySelector('.btn-icon');
  if (btn) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    btn.textContent = isDark ? '☀️' : '🌙';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initDarkMode();
  updateThemeButton();
  restoreSession();
  loadPosts();
  loadStats();
  loadHotPosts();
  loadTags();
  setupInfiniteScroll();
  setupKeyboardShortcuts();
  startPolling();
});

// Restore session from JWT token
async function restoreSession() {
  const token = localStorage.getItem('token');
  if (!token) return;
  try {
    const res = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) {
      currentUser = await res.json();
      currentUser.token = token;
      updateHeader();
    } else {
      localStorage.removeItem('token');
      localStorage.removeItem('currentUser');
    }
  } catch (e) {
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
  }
}

async function api(url, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token');
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
  return res.json();
}

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function showAuthModal(tab = 'login') {
  document.getElementById('authModal').classList.add('active');
  switchAuthTab(tab);
}

function showNewPostModal(editId = null) {
  if (!currentUser) return showAuthModal();
  editingPostId = editId;
  document.getElementById('postModalTitle').textContent = editId ? '编辑帖子' : '发布新帖子';
  document.getElementById('postSubmitBtn').textContent = editId ? '保存' : '发布';
  postTags = [];

  if (editId) {
    api(`/api/posts/${editId}`).then(post => {
      document.getElementById('postTitle').value = post.title;
      document.getElementById('postContent').value = post.content;
      document.getElementById('postCategory').value = post.category;
      postTags = post.tags || [];
      renderTagInput();
    });
  } else {
    document.getElementById('postTitle').value = '';
    document.getElementById('postContent').value = '';
    renderTagInput();
  }

  document.getElementById('postError').style.display = 'none';
  document.getElementById('newPostModal').classList.add('active');
}

function insertFormat(before, after) {
  const textarea = document.getElementById('postContent');
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const selected = text.substring(start, end);
  textarea.value = text.substring(0, start) + before + selected + after + text.substring(end);
  textarea.focus();
  textarea.selectionStart = start + before.length;
  textarea.selectionEnd = start + before.length + selected.length;
}

function handleTagInput(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const input = e.target;
    const tag = input.value.trim();
    if (tag && !postTags.includes(tag) && postTags.length < 5) {
      postTags.push(tag);
      input.value = '';
      renderTagInput();
    }
  }
}

function removeTag(index) {
  postTags.splice(index, 1);
  renderTagInput();
}

function renderTagInput() {
  const wrapper = document.getElementById('tagInputWrapper');
  const input = document.getElementById('tagInput');
  wrapper.innerHTML = '';
  postTags.forEach((tag, i) => {
    const el = document.createElement('span');
    el.className = 'tag-input-tag';
    el.innerHTML = `${escapeHtml(tag)} <button onclick="removeTag(${i})">×</button>`;
    wrapper.appendChild(el);
  });
  wrapper.appendChild(input);
}

function showProfileEditModal() {
  if (!currentUser) return;
  selectedAvatar = currentUser.avatar;
  document.getElementById('editBio').value = currentUser.bio || '';
  const avatars = ['🧑‍💻', '👩‍🎨', '👨‍🏫', '🎮', '📚', '🌟', '🎯', '🚀', '💡', '🎨', '🦊', '🐱', '🐶', '🐼', '🐨', '🦄', '🐸', '🦋', '🐙', '🎃', '🤖', '👾', '🎪', '🎭', '🌍', '⚡', '🔮', '🎸', '🏆', '💎', '🔥', '🌊'];
  const grid = document.getElementById('avatarGrid');
  grid.innerHTML = avatars.map(a => `<div class="avatar-option ${a === selectedAvatar ? 'selected' : ''}" onclick="selectAvatar(this, '${a}')">${a}</div>`).join('');
  document.getElementById('profileModal').classList.add('active');
}

function selectAvatar(el, avatar) {
  document.querySelectorAll('.avatar-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  selectedAvatar = avatar;
}

async function saveProfile() {
  const bio = document.getElementById('editBio').value.trim();
  const res = await api(`/api/users/${currentUser.id}`, { method: 'PUT', body: JSON.stringify({ bio, avatar: selectedAvatar }) });
  if (res.error) { showToast(res.error); return; }
  currentUser = { ...currentUser, ...res };
  localStorage.setItem('currentUser', JSON.stringify(currentUser));
  updateHeader();
  closeModal('profileModal');
  showToast('资料已更新');
  if (currentView === 'detail') showPostDetail(currentPostId);
}

function showConfirm(title, text, onConfirm) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmText').textContent = text;
  document.getElementById('confirmBtn').onclick = () => { onConfirm(); closeModal('confirmModal'); };
  document.getElementById('confirmModal').classList.add('active');
}

function closeModal(id) { document.getElementById(id).classList.remove('active'); }

document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('active'); });
});

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t, i) => {
    t.classList.toggle('active', (tab === 'login' && i === 0) || (tab === 'register' && i === 1));
  });
  document.getElementById('loginForm').classList.toggle('active', tab === 'login');
  document.getElementById('registerForm').classList.toggle('active', tab === 'register');
}

async function doLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  if (!username || !password) { errEl.textContent = '请输入用户名和密码'; errEl.style.display = 'block'; return; }
  const res = await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
  if (res.error) { errEl.textContent = res.error; errEl.style.display = 'block'; }
  else {
    const { token, ...user } = res;
    currentUser = user;
    localStorage.setItem('token', token);
    localStorage.setItem('currentUser', JSON.stringify(user));
    closeModal('authModal');
    updateHeader();
    showToast('登录成功！');
    if (currentView === 'detail') showPostDetail(currentPostId);
    else loadPosts();
  }
}

async function doRegister() {
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value;
  const secQuestion = document.getElementById('regSecQuestion').value;
  const secAnswer = document.getElementById('regSecAnswer').value.trim();
  const errEl = document.getElementById('regError');
  if (!username || !password) { errEl.textContent = '请输入用户名和密码'; errEl.style.display = 'block'; return; }
  if (secQuestion && !secAnswer) { errEl.textContent = '请输入安全问题答案'; errEl.style.display = 'block'; return; }
  const body = { username, password };
  if (secQuestion && secAnswer) { body.securityQuestion = secQuestion; body.securityAnswer = secAnswer; }
  const res = await api('/api/register', { method: 'POST', body: JSON.stringify(body) });
  if (res.error) { errEl.textContent = res.error; errEl.style.display = 'block'; }
  else {
    const { token, ...user } = res;
    currentUser = user;
    localStorage.setItem('token', token);
    localStorage.setItem('currentUser', JSON.stringify(user));
    closeModal('authModal');
    updateHeader();
    showToast('注册成功！欢迎加入社区');
  }
}

// Toggle security answer field on registration
document.addEventListener('DOMContentLoaded', () => {
  const secQ = document.getElementById('regSecQuestion');
  if (secQ) secQ.addEventListener('change', () => {
    document.getElementById('regSecAnswerGroup').style.display = secQ.value ? 'block' : 'none';
  });
});

// Password reset flow
function showResetPassword() {
  closeModal('authModal');
  document.getElementById('resetStep1').style.display = 'block';
  document.getElementById('resetStep2').style.display = 'none';
  document.getElementById('resetStep3').style.display = 'none';
  document.getElementById('resetUsername').value = '';
  document.getElementById('resetError1').style.display = 'none';
  document.getElementById('resetError2').style.display = 'none';
  document.getElementById('resetPasswordModal').classList.add('active');
}

async function resetStep1() {
  const username = document.getElementById('resetUsername').value.trim();
  const errEl = document.getElementById('resetError1');
  if (!username) { errEl.textContent = '请输入用户名'; errEl.style.display = 'block'; return; }
  const res = await api('/api/get-security-question', { method: 'POST', body: JSON.stringify({ username }) });
  if (res.error) { errEl.textContent = res.error; errEl.style.display = 'block'; return; }
  document.getElementById('resetQuestion').textContent = res.question;
  document.getElementById('resetStep1').style.display = 'none';
  document.getElementById('resetStep2').style.display = 'block';
}

async function resetStep2() {
  const username = document.getElementById('resetUsername').value.trim();
  const answer = document.getElementById('resetAnswer').value.trim();
  const newPassword = document.getElementById('resetNewPassword').value;
  const errEl = document.getElementById('resetError2');
  if (!answer || !newPassword) { errEl.textContent = '请填写完整'; errEl.style.display = 'block'; return; }
  if (newPassword.length < 6) { errEl.textContent = '新密码至少6个字符'; errEl.style.display = 'block'; return; }
  const res = await api('/api/reset-password', { method: 'POST', body: JSON.stringify({ username, answer, newPassword }) });
  if (res.error) { errEl.textContent = res.error; errEl.style.display = 'block'; return; }
  document.getElementById('resetStep2').style.display = 'none';
  document.getElementById('resetStep3').style.display = 'block';
}

function logout() {
  currentUser = null;
  localStorage.removeItem('currentUser');
  localStorage.removeItem('token');
  updateHeader();
  showToast('已退出登录');
  if (currentView !== 'list') goHome();
}

function updateHeader() {
  const actions = document.getElementById('headerActions');
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const themeIcon = isDark ? '☀️' : '🌙';

  if (currentUser) {
    actions.innerHTML = `
      <button class="btn-icon" onclick="toggleDarkMode()" title="切换主题">${themeIcon}</button>
      <div style="position:relative;">
        <button class="btn-icon" onclick="toggleNotifications()" title="通知">🔔<span class="badge" id="notifBadge" style="display:none;"></span></button>
        <div class="notifications-dropdown" id="notificationsDropdown"></div>
      </div>
      <button class="btn-icon" onclick="toggleMessages()" title="私信">✉️<span class="badge" id="msgBadge" style="display:none;"></span></button>
      <button class="btn btn-primary" onclick="showNewPostModal()">✏️ 发帖</button>
      <div class="dropdown">
        <div class="user-menu" onclick="toggleDropdown(this)">
          <div class="user-avatar">${currentUser.avatar}</div>
          <span class="user-name">${currentUser.username}</span>
        </div>
        <div class="dropdown-menu">
          <button class="dropdown-item" onclick="showProfile(${currentUser.id})">👤 个人主页</button>
          <button class="dropdown-item" onclick="showBookmarks()">⭐ 我的收藏</button>
          <button class="dropdown-item" onclick="showDraftsModal()">📝 草稿箱</button>
          <button class="dropdown-item" onclick="showSettingsPage()">⚙️ 设置</button>
          ${currentUser.id === 1 ? `
          <div class="dropdown-divider"></div>
          <button class="dropdown-item" onclick="showAdminPanel()">🛡️ 管理后台</button>
          ` : ''}
          <div class="dropdown-divider"></div>
          <button class="dropdown-item" onclick="logout()">🚪 退出登录</button>
        </div>
      </div>
    `;
    loadNotifications();
    loadUnreadMessages();
  } else {
    actions.innerHTML = `
      <button class="btn-icon" onclick="toggleDarkMode()" title="切换主题">${themeIcon}</button>
      <button class="btn btn-ghost" onclick="showAuthModal()">登录</button>
      <button class="btn btn-primary" onclick="showAuthModal('register')">注册</button>
    `;
  }
}

function toggleDropdown(el) {
  const menu = el.nextElementSibling;
  menu.classList.toggle('show');
  setTimeout(() => {
    const close = (e) => { if (!menu.contains(e.target)) { menu.classList.remove('show'); document.removeEventListener('click', close); } };
    document.addEventListener('click', close);
  }, 0);
}

let notifFilter = 'all';

async function toggleNotifications() {
  const dropdown = document.getElementById('notificationsDropdown');
  const isOpen = dropdown.classList.contains('show');

  if (isOpen) {
    dropdown.classList.remove('show');
    return;
  }

  notifFilter = 'all';
  await loadNotificationList(dropdown);
}

async function loadNotificationList(dropdown) {
  dropdown = dropdown || document.getElementById('notificationsDropdown');
  const params = notifFilter !== 'all' ? `?type=${notifFilter}` : '';
  const res = await api(`/api/notifications${params}`);
  dropdown.classList.add('show');

  const filterTabs = [
    { key: 'all', label: '全部' },
    { key: 'like_post', label: '点赞' },
    { key: 'comment', label: '评论' },
    { key: 'follow', label: '关注' },
    { key: 'new_post', label: '新帖' },
  ];

  if (res.notifications.length === 0) {
    dropdown.innerHTML = `
      <div class="notifications-header">通知
        <button class="btn btn-sm btn-ghost" onclick="markAllRead()">全部已读</button>
      </div>
      <div class="notif-filter-tabs">${filterTabs.map(f => `<span class="notif-filter-tab ${notifFilter === f.key ? 'active' : ''}" onclick="filterNotifications('${f.key}')">${f.label}</span>`).join('')}</div>
      <div class="notification-empty">暂无通知</div>`;
  } else {
    dropdown.innerHTML = `
      <div class="notifications-header">通知
        <button class="btn btn-sm btn-ghost" onclick="markAllRead()">全部已读</button>
      </div>
      <div class="notif-filter-tabs">${filterTabs.map(f => `<span class="notif-filter-tab ${notifFilter === f.key ? 'active' : ''}" onclick="filterNotifications('${f.key}')">${f.label}</span>`).join('')}</div>
      ${res.notifications.map(n => {
        let text = '';
        if (n.type === 'like_post') text = `赞了你的帖子 <strong>${escapeHtml(n.content)}</strong>`;
        else if (n.type === 'like_comment') text = `赞了你的评论`;
        else if (n.type === 'comment') text = `评论了你的帖子：<strong>${escapeHtml(n.content)}</strong>`;
        else if (n.type === 'reply') text = `回复了你的评论：<strong>${escapeHtml(n.content)}</strong>`;
        else if (n.type === 'follow') text = `关注了你`;
        else if (n.type === 'new_post') text = `发布了新帖子：<strong>${escapeHtml(n.content)}</strong>`;
        else if (n.type === 'tag_post') text = `发布了你关注标签的帖子：<strong>${escapeHtml(n.content)}</strong>`;
        else if (n.type === 'message') text = `发来了私信`;
        else if (n.type === 'mention') text = `在帖子中提到了你`;
        else text = `发来了一条通知`;
        return `
          <div class="notification-item ${n.is_read ? '' : 'unread'}" onclick="handleNotificationClick(${n.id}, ${n.post_id}, ${n.is_read})">
            <div class="notification-avatar">${n.from_avatar}</div>
            <div class="notification-content">
              <div class="notification-text"><strong>${escapeHtml(n.from_username)}</strong> ${text}</div>
              <div class="notification-time">${formatTime(n.created_at)}</div>
            </div>
          </div>
        `;
      }).join('')}
    `;
  }

  setTimeout(() => {
    const close = (e) => { if (!dropdown.contains(e.target) && !e.target.closest('.btn-icon')) { dropdown.classList.remove('show'); document.removeEventListener('click', close); } };
    document.addEventListener('click', close);
  }, 0);
}

function filterNotifications(type) {
  notifFilter = type;
  loadNotificationList();
}

async function loadNotifications() {
  if (!currentUser) return;
  const res = await api('/api/notifications');
  const badge = document.getElementById('notifBadge');
  if (badge) {
    if (res.unreadCount > 0) {
      badge.style.display = 'flex';
      badge.textContent = res.unreadCount > 9 ? '9+' : res.unreadCount;
    } else {
      badge.style.display = 'none';
    }
  }
}

async function markAllRead() {
  await api('/api/notifications/read', { method: 'POST' });
  loadNotifications();
  const dropdown = document.getElementById('notificationsDropdown');
  dropdown.querySelectorAll('.notification-item.unread').forEach(el => el.classList.remove('unread'));
}

async function handleNotificationClick(notifId, postId, isRead) {
  if (!isRead) {
    await api(`/api/notifications/${notifId}/read`, { method: 'POST' });
    loadNotifications();
  }
  document.getElementById('notificationsDropdown').classList.remove('show');
  if (postId) showPostDetail(postId);
}

// Markdown parser
function parseMarkdown(text) {
  if (!text) return '';
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
      // XSS防护：只允许安全协议
      if (/^(javascript|data|vbscript):/i.test(url.trim())) return text;
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    })
    .replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^---$/gm, '<hr>')
    .replace(/^- \[x\]\s+(.+)$/gm, '<div><input type="checkbox" checked disabled> $1</div>')
    .replace(/^- \[ \]\s+(.+)$/gm, '<div><input type="checkbox" disabled> $1</div>');

  const lines = html.split('\n');
  let result = [];
  let inList = false;
  let listType = '';

  for (let line of lines) {
    const ulMatch = line.match(/^[-*]\s+(.+)/);
    const olMatch = line.match(/^\d+\.\s+(.+)/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') { if (inList) result.push(`</${listType}>`); result.push('<ul>'); inList = true; listType = 'ul'; }
      result.push(`<li>${ulMatch[1]}</li>`);
    } else if (olMatch) {
      if (!inList || listType !== 'ol') { if (inList) result.push(`</${listType}>`); result.push('<ol>'); inList = true; listType = 'ol'; }
      result.push(`<li>${olMatch[1]}</li>`);
    } else {
      if (inList) { result.push(`</${listType}>`); inList = false; }
      result.push(line);
    }
  }
  if (inList) result.push(`</${listType}>`);

  html = result.join('\n').replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>');
  html = html.replace(/<\/blockquote><blockquote>/g, '');
  return `<p>${html}</p>`;
}

// Posts
async function loadPosts(append = false) {
  if (!append) currentPage = 1;
  const params = new URLSearchParams({ category: currentCategory, sort: currentSort, page: currentPage });
  if (currentTag) params.set('tag', currentTag);

  const res = await api(`/api/posts?${params}`);
  hasMore = res.hasMore;

  const container = document.getElementById('postList');
  if (!append) container.innerHTML = '';

  if (res.posts.length === 0 && !append) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📝</div><p>还没有帖子，来发布第一条吧！</p></div>';
    return;
  }

  res.posts.forEach(post => {
    const div = document.createElement('div');
    div.className = 'post-card' + (post.is_pinned ? ' pinned' : '');
    div.onclick = () => showPostDetail(post.id);
    div.innerHTML = `
      <div class="post-meta">
        <div class="post-avatar">${post.avatar}</div>
        <span class="post-author">${escapeHtml(post.username)}</span>
        <span class="post-category">${post.category}</span>
        ${post.is_featured ? '<span class="featured-badge">💎 精华</span>' : ''}
        <span>${formatTime(post.created_at)}</span>
        ${post.is_pinned ? '<span class="pin-badge">📌 置顶</span>' : ''}
      </div>
      <div class="post-title">${escapeHtml(post.title)}</div>
      <div class="post-excerpt">${escapeHtml(post.content).replace(/\n/g, ' ')}</div>
      ${post.tags && post.tags.length > 0 ? `<div class="post-tags">${post.tags.map(t => `<span class="tag" onclick="event.stopPropagation();filterByTag('${escapeHtml(t)}')">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      <div class="post-footer">
        <button class="post-action ${post.bookmarked ? 'bookmarked' : ''}" onclick="event.stopPropagation();bookmarkPost(${post.id}, this)" title="收藏">${post.bookmarked ? '⭐' : '☆'}</button>
        <button class="post-action" onclick="event.stopPropagation();likePost(${post.id}, this)">❤️ ${post.likes}</button>
        <span class="post-action">💬 ${post.comment_count}</span>
        <span class="post-action">👁️ ${post.views || 0}</span>
        ${currentUser && post.user_id === currentUser.id ? `
          <button class="post-action" onclick="event.stopPropagation();togglePin(${post.id})" title="${post.is_pinned ? '取消置顶' : '置顶'}">${post.is_pinned ? '📌' : '📍'}</button>
          <button class="post-action" onclick="event.stopPropagation();showNewPostModal(${post.id})" title="编辑">✏️</button>
          <button class="post-action" onclick="event.stopPropagation();deletePost(${post.id})" title="删除">🗑️</button>
        ` : ''}
        ${currentUser && currentUser.id === 1 && !post.is_featured ? `<button class="post-action" onclick="event.stopPropagation();toggleFeatured(${post.id})" title="设为精华">💎</button>` : ''}
      </div>
    `;
    container.appendChild(div);
  });

  isLoadingMore = false;
}

function setupInfiniteScroll() {
  const sentinel = document.getElementById('infiniteScrollSentinel');
  if (!sentinel) return;

  infiniteObserver = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && hasMore && !isLoadingMore && currentView === 'list') {
      isLoadingMore = true;
      currentPage++;
      loadPosts(true);
    }
  }, { rootMargin: '200px' });

  infiniteObserver.observe(sentinel);
}

function selectCategory(el) {
  document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  currentCategory = el.dataset.category;
  currentTag = '';
  searchQuery = '';
  document.getElementById('searchInput').value = '';
  goHome();
}

function selectSort(el) {
  document.querySelectorAll('.sort-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  currentSort = el.dataset.sort;
  goHome();
}

function filterByTag(tag) {
  currentTag = tag;
  currentCategory = '全部';
  searchQuery = '';
  goHome();
}

// Tag subscription
async function toggleTagSubscription(tagName, btn) {
  if (!currentUser) { showToast('请先登录'); return; }

  try {
    const result = await api(`/api/tag-subscriptions/${encodeURIComponent(tagName)}`, { method: 'POST' });
    if (result.subscribed) {
      btn.classList.add('subscribed');
      btn.innerHTML = '🔔 已订阅';
      showToast(`已订阅标签「${tagName}」`);
    } else {
      btn.classList.remove('subscribed');
      btn.innerHTML = '🔕 订阅';
      showToast(`已取消订阅标签「${tagName}」`);
    }
  } catch (e) {
    showToast('操作失败');
  }
}

async function loadTagSubscriptions() {
  if (!currentUser) return [];
  try {
    return await api('/api/tag-subscriptions');
  } catch (e) {
    return [];
  }
}

// Post Detail
async function showPostDetail(id) {
  currentView = 'detail';
  currentPostId = id;

  const [post, comments] = await Promise.all([
    api(`/api/posts/${id}`),
    api(`/api/posts/${id}/comments`)
  ]);

  const commentMap = {};
  const rootComments = [];
  comments.forEach(c => { c.children = []; commentMap[c.id] = c; });
  comments.forEach(c => {
    if (c.parent_id && commentMap[c.parent_id]) commentMap[c.parent_id].children.push(c);
    else rootComments.push(c);
  });

  const container = document.getElementById('mainContent');
  container.innerHTML = `
    <button class="back-btn" onclick="goHome()">← 返回列表</button>
    <div class="post-detail">
      <div class="post-meta">
        <div class="post-avatar">${post.avatar}</div>
        <span class="post-author" style="cursor:pointer;" onclick="event.stopPropagation();showProfile(${post.user_id})">${escapeHtml(post.username)}${getOnlineStatusHtml(post.user_id)}</span>
        <span class="post-category">${post.category}</span>
        ${post.is_featured ? '<span class="featured-badge">💎 精华</span>' : ''}
        <span>${formatTime(post.created_at)}</span>
        ${post.is_pinned ? '<span class="pin-badge">📌 置顶</span>' : ''}
      </div>
      ${post.tags && post.tags.length > 0 ? `<div class="post-tags" style="margin-bottom:12px;">${post.tags.map(t => `<span class="tag" onclick="filterByTag('${escapeHtml(t)}')">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      <div class="post-detail-title">${escapeHtml(post.title)}</div>
      <div class="post-detail-content">${parseMarkdown(post.content)}</div>
      <div class="post-info-bar">
        <span>👁️ ${post.views} 浏览</span>
        <span>❤️ ${post.likes} 点赞</span>
        <span>💬 ${comments.length} 评论</span>
      </div>
      <div class="post-actions-bar">
        <button class="post-action ${post.bookmarked ? 'bookmarked' : ''}" onclick="bookmarkPost(${post.id}, this)">${post.bookmarked ? '⭐ 已收藏' : '☆ 收藏'}</button>
        <button class="post-action ${post.liked ? 'active' : ''}" onclick="likePost(${post.id}, this)">❤️ ${post.likes}</button>
        <button class="post-action" onclick="sharePost(${post.id})">🔗 分享</button>
        ${currentUser ? `<button class="add-to-collection-btn" onclick="showAddToCollectionModal(${post.id})">📁 收入合集</button>` : ''}
        <span style="flex:1;"></span>
        ${currentUser && post.user_id !== currentUser.id ? `<button class="report-btn" onclick="showReportModal('post', ${post.id})">⚠️ 举报</button>` : ''}
        ${currentUser && post.user_id === currentUser.id ? `
          <button class="btn btn-sm btn-outline" onclick="togglePin(${post.id})">${post.is_pinned ? '取消置顶' : '📌 置顶'}</button>
          <button class="btn btn-sm btn-outline" onclick="showNewPostModal(${post.id})">✏️ 编辑</button>
          <button class="btn btn-sm btn-danger" onclick="deletePost(${post.id})">🗑️ 删除</button>
        ` : ''}
        ${currentUser && currentUser.id === 1 ? `<button class="btn btn-sm ${post.is_featured ? 'btn-primary' : 'btn-outline'}" onclick="toggleFeatured(${post.id})">${post.is_featured ? '💎 取消精华' : '💎 设为精华'}</button>` : ''}
      </div>
    </div>

    <div class="comments-section">
      <div class="comments-title">💬 评论 (${comments.length})</div>
      <div class="comment-form">
        <textarea id="commentInput" placeholder="${currentUser ? '写下你的评论...' : '登录后即可评论'}"></textarea>
        <button class="btn btn-primary" onclick="submitComment(${post.id})" style="align-self:flex-end;">发送</button>
      </div>
      <div id="commentsList">
        ${rootComments.length === 0 ? '<div style="text-align:center;padding:20px;color:var(--text-secondary);">暂无评论，来抢沙发吧！</div>' : ''}
        ${rootComments.map(c => renderComment(c, post.user_id)).join('')}
      </div>
    </div>
  `;

  document.getElementById('categoryTabs').style.display = 'none';
  document.querySelector('.sort-tabs').style.display = 'none';

  // Generate TOC for long posts
  generateTOC();

  // Setup @mention autocomplete on comment textarea
  const commentInput = document.getElementById('commentInput');
  if (commentInput) setupMentionAutocomplete(commentInput);

  // Load online status for commenters
  const userIds = [...new Set(comments.map(c => c.user_id))];
  loadOnlineStatus(userIds);
}

function renderComment(comment, postAuthorId, depth = 0) {
  const isOwner = currentUser && comment.user_id === currentUser.id;
  const hasChildren = comment.children.length > 0;
  const isDeep = depth >= 3;
  const replyHtml = hasChildren ? `<div class="comment-replies ${isDeep ? 'collapsed' : ''}" id="replies-${comment.id}">${comment.children.map(c => renderComment(c, postAuthorId, depth + 1)).join('')}</div>` : '';

  return `
    <div class="comment-item" id="comment-${comment.id}">
      <div class="comment-header">
        <div class="comment-avatar">${comment.avatar}</div>
        <span class="comment-author">${escapeHtml(comment.username)}${getOnlineStatusHtml(comment.user_id)}</span>
        ${comment.user_id === postAuthorId ? '<span style="font-size:11px;background:var(--primary-light);color:var(--primary);padding:1px 6px;border-radius:4px;">作者</span>' : ''}
        <span class="comment-time">${formatTime(comment.created_at)}</span>
        ${hasChildren ? `<button class="comment-collapse-btn" onclick="toggleCommentReplies(${comment.id})" title="折叠/展开回复">▼ ${comment.children.length}条回复</button>` : ''}
      </div>
      <div class="comment-content" id="comment-content-${comment.id}">${escapeHtml(comment.content)}</div>
      <div class="comment-actions">
        ${renderVoteButtons(comment)}
        ${currentUser ? `<button class="post-action" onclick="showReplyForm(${comment.id})">💬 回复</button>` : ''}
        ${isOwner ? `<button class="post-action" onclick="editComment(${comment.id})">✏️</button><button class="post-action" onclick="deleteComment(${comment.id})">🗑️</button>` : ''}
        ${currentUser && !isOwner ? `<button class="report-btn" onclick="showReportModal('comment', ${comment.id})">⚠️ 举报</button>` : ''}
      </div>
      <div id="reply-form-${comment.id}" style="display:none;"></div>
      ${replyHtml}
    </div>
  `;
}

function toggleCommentReplies(commentId) {
  const repliesEl = document.getElementById(`replies-${commentId}`);
  const btn = document.querySelector(`#comment-${commentId} .comment-collapse-btn`);
  if (!repliesEl || !btn) return;

  if (repliesEl.classList.contains('collapsed')) {
    repliesEl.classList.remove('collapsed');
    btn.textContent = btn.textContent.replace('▶', '▼');
  } else {
    repliesEl.classList.add('collapsed');
    btn.textContent = btn.textContent.replace('▼', '▶');
  }
}

function showReplyForm(commentId) {
  const container = document.getElementById(`reply-form-${commentId}`);
  if (container.innerHTML) { container.innerHTML = ''; container.style.display = 'none'; return; }
  container.style.display = 'block';
  container.innerHTML = `<div class="reply-form"><textarea id="reply-input-${commentId}" placeholder="回复..."></textarea><button class="btn btn-primary btn-sm" onclick="submitReply(${commentId})" style="align-self:flex-end;">回复</button></div>`;
  const replyInput = document.getElementById(`reply-input-${commentId}`);
  replyInput.focus();
  setupMentionAutocomplete(replyInput);
}

async function submitReply(parentId) {
  const input = document.getElementById(`reply-input-${parentId}`);
  const content = input.value.trim();
  if (!content) return;
  await api(`/api/posts/${currentPostId}/comments`, { method: 'POST', body: JSON.stringify({ content, parent_id: parentId }) });
  showToast('回复成功！');
  showPostDetail(currentPostId);
}

function editComment(commentId) {
  const contentEl = document.getElementById(`comment-content-${commentId}`);
  const originalContent = contentEl.textContent;
  contentEl.innerHTML = `<div class="comment-form" style="margin:0;"><textarea id="edit-comment-${commentId}" style="height:60px;">${originalContent}</textarea><div style="display:flex;gap:6px;align-self:flex-end;"><button class="btn btn-primary btn-sm" onclick="saveComment(${commentId})">保存</button><button class="btn btn-ghost btn-sm" onclick="showPostDetail(${currentPostId})">取消</button></div></div>`;
}

async function saveComment(commentId) {
  const content = document.getElementById(`edit-comment-${commentId}`).value.trim();
  if (!content) return;
  await api(`/api/comments/${commentId}`, { method: 'PUT', body: JSON.stringify({ content }) });
  showToast('评论已更新');
  showPostDetail(currentPostId);
}

function deleteComment(commentId) {
  showConfirm('删除评论', '确定要删除这条评论吗？', async () => {
    await api(`/api/comments/${commentId}`, { method: 'DELETE' });
    showToast('评论已删除');
    showPostDetail(currentPostId);
  });
}

function goHome() {
  currentView = 'list';
  currentPostId = null;
  searchQuery = '';
  rebuildMainContent();
  loadPosts();
  setupInfiniteScroll();
}

function rebuildMainContent() {
  document.getElementById('mainContent').innerHTML = `
    <div class="announcements-banner" id="announcementsBanner">
      <div class="announcement-title">📢 社区公告</div>
      <div id="announcementsList"></div>
    </div>
    <div class="category-tabs" id="categoryTabs">
      <div class="category-tab ${currentCategory === '全部' ? 'active' : ''}" data-category="全部" onclick="selectCategory(this)">全部</div>
      ${currentUser ? `<div class="category-tab ${currentCategory === '关注' ? 'active' : ''}" data-category="关注" onclick="selectCategory(this)">👥 关注</div>` : ''}
      <div class="category-tab ${currentCategory === '技术' ? 'active' : ''}" data-category="技术" onclick="selectCategory(this)">💻 技术</div>
      <div class="category-tab ${currentCategory === '产品' ? 'active' : ''}" data-category="产品" onclick="selectCategory(this)">📱 产品</div>
      <div class="category-tab ${currentCategory === '生活' ? 'active' : ''}" data-category="生活" onclick="selectCategory(this)">🌿 生活</div>
      <div class="category-tab ${currentCategory === '游戏' ? 'active' : ''}" data-category="游戏" onclick="selectCategory(this)">🎮 游戏</div>
      <div class="category-tab ${currentCategory === '读书' ? 'active' : ''}" data-category="读书" onclick="selectCategory(this)">📚 读书</div>
      <div class="category-tab ${currentCategory === '综合' ? 'active' : ''}" data-category="综合" onclick="selectCategory(this)">💬 综合</div>
    </div>
    <div class="sort-tabs">
      <button class="sort-tab ${currentSort === 'new' ? 'active' : ''}" data-sort="new" onclick="selectSort(this)">最新</button>
      <button class="sort-tab ${currentSort === 'hot' ? 'active' : ''}" data-sort="hot" onclick="selectSort(this)">最热</button>
      <button class="sort-tab ${currentSort === 'views' ? 'active' : ''}" data-sort="views" onclick="selectSort(this)">最多浏览</button>
      <button class="sort-tab ${currentSort === 'featured' ? 'active' : ''}" data-sort="featured" onclick="selectSort(this)">💎 精华</button>
      ${currentUser ? `<button class="sort-tab ${currentSort === 'feed' ? 'active' : ''}" data-sort="feed" onclick="selectSort(this)">👥 关注</button>` : ''}
    </div>
    ${currentTag ? `<div style="margin-bottom:12px;display:flex;align-items:center;gap:8px;"><span style="font-size:14px;color:var(--text-secondary);">标签：</span><span class="tag" style="cursor:pointer;" onclick="currentTag='';goHome();">${escapeHtml(currentTag)} ×</span><button class="btn btn-sm btn-outline" id="tagSubscribeBtn" onclick="toggleTagSubscription('${escapeHtml(currentTag)}', this)">🔕 订阅</button></div>` : ''}
    <div id="postList"><div class="loading"><div class="spinner"></div>加载中...</div></div>
    <div id="infiniteScrollSentinel" class="infinite-scroll-sentinel"></div>
  `;
  loadAnnouncements();
  if (currentTag) checkTagSubscription(currentTag);
}

async function checkTagSubscription(tagName) {
  if (!currentUser) return;
  const subscriptions = await loadTagSubscriptions();
  const btn = document.getElementById('tagSubscribeBtn');
  if (btn && subscriptions.includes(tagName)) {
    btn.classList.add('subscribed');
    btn.innerHTML = '🔔 已订阅';
  }
}

// Profile
async function showProfile(userId) {
  currentView = 'detail';
  const [user, level] = await Promise.all([
    api(`/api/users/${userId}`),
    api(`/api/users/${userId}/level`)
  ]);

  document.getElementById('mainContent').innerHTML = `
    <button class="back-btn" onclick="goHome()">← 返回列表</button>
    <div class="profile-header">
      <div class="profile-avatar">${user.avatar}</div>
      <div class="profile-info">
        <div class="profile-name">
          ${escapeHtml(user.username)}
          <span class="user-level-badge level-${level.level}">${level.icon} Lv.${level.level} ${level.title}</span>
        </div>
        <div class="profile-bio">${user.bio ? escapeHtml(user.bio) : '这个人很懒，什么都没写~'}</div>
        <div class="profile-stats">
          <span><span class="profile-stat-num">${user.postCount}</span> 帖子</span>
          <span><span class="profile-stat-num">${user.commentCount}</span> 评论</span>
          <span><span class="profile-stat-num">${user.likeCount}</span> 获赞</span>
          <span><span class="profile-stat-num">${user.followerCount}</span> 粉丝</span>
          <span><span class="profile-stat-num">${user.followingCount}</span> 关注</span>
          <span><span class="profile-stat-num">${level.score}</span> 积分</span>
        </div>
      </div>
      <div style="display:flex;gap:8px;">
        ${currentUser && currentUser.id === userId ? `<button class="btn btn-outline" onclick="showProfileEditModal()">编辑资料</button>` : ''}
        ${currentUser && currentUser.id !== userId ? `<button class="btn ${user.isFollowing ? 'btn-ghost' : 'btn-primary'}" onclick="toggleFollow(${userId}, this)">${user.isFollowing ? '已关注' : '+ 关注'}</button>` : ''}
      </div>
    </div>
    <div class="profile-tabs">
      <button class="profile-tab active" onclick="showProfileTab(this, 'posts', ${userId})">📝 帖子</button>
      <button class="profile-tab" onclick="showProfileTab(this, 'collections', ${userId})">📁 合集</button>
      <button class="profile-tab" onclick="showProfileTab(this, 'activity', ${userId})">📊 动态</button>
      <button class="profile-tab" onclick="showProfileTab(this, 'achievements', ${userId})">🏆 成就</button>
    </div>
    <div id="postList"></div>
    <div id="collectionsContainer" style="display:none;"></div>
    <div id="activityContainer" style="display:none;"></div>
    <div id="achievementsContainer" style="display:none;">
      <div class="sidebar-card">
        <div class="sidebar-title">🏆 成就徽章</div>
        <div id="achievementsList">加载中...</div>
      </div>
    </div>
  `;

  document.getElementById('categoryTabs').style.display = 'none';
  document.querySelector('.sort-tabs').style.display = 'none';

  const postsRes = await api(`/api/posts?category=全部&sort=new&page=1`);
  const container = document.getElementById('postList');
  const filtered = postsRes.posts.filter(p => p.user_id === userId);

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📝</div><p>还没有发布过帖子</p></div>';
    return;
  }

  filtered.forEach(post => {
    const div = document.createElement('div');
    div.className = 'post-card';
    div.onclick = () => showPostDetail(post.id);
    div.innerHTML = `
      <div class="post-meta">
        <div class="post-avatar">${post.avatar}</div>
        <span class="post-author">${escapeHtml(post.username)}</span>
        <span class="post-category">${post.category}</span>
        <span>${formatTime(post.created_at)}</span>
      </div>
      <div class="post-title">${escapeHtml(post.title)}</div>
      <div class="post-excerpt">${escapeHtml(post.content).replace(/\n/g, ' ')}</div>
      <div class="post-footer">
        <button class="post-action" onclick="event.stopPropagation();likePost(${post.id}, this)">❤️ ${post.likes}</button>
        <span class="post-action">💬 ${post.comment_count}</span>
        <span class="post-action">👁️ ${post.views || 0}</span>
      </div>
    `;
    container.appendChild(div);
  });
}

async function toggleFollow(userId, btn) {
  if (!currentUser) return showAuthModal();
  const res = await api(`/api/users/${userId}/follow`, { method: 'POST' });
  if (res.following) {
    btn.className = 'btn btn-ghost';
    btn.textContent = '已关注';
    showToast('关注成功');
  } else {
    btn.className = 'btn btn-primary';
    btn.textContent = '+ 关注';
    showToast('已取消关注');
  }
}

// Bookmarks
async function showBookmarks() {
  if (!currentUser) return showAuthModal();
  currentView = 'detail';
  window._currentBookmarkFolder = null;

  document.getElementById('mainContent').innerHTML = `
    <button class="back-btn" onclick="goHome()">← 返回列表</button>
    <h2 style="margin-bottom:16px;">⭐ 我的收藏</h2>
    <div id="bookmarkFolders"></div>
    <div id="postList"></div>
  `;

  document.getElementById('categoryTabs').style.display = 'none';
  document.querySelector('.sort-tabs').style.display = 'none';

  await loadBookmarkFolders();
  await loadBookmarkPosts();
}

async function loadBookmarkFolders() {
  const data = await api('/api/bookmark-folders');
  const container = document.getElementById('bookmarkFolders');

  container.innerHTML = `
    <div class="bookmark-folders">
      <div class="bookmark-folder ${window._currentBookmarkFolder === null ? 'active' : ''}" onclick="filterBookmarks(null)">
        📁 全部 <span class="count">(${(data.folders.reduce((s, f) => s + f.post_count, 0) + data.unfoldered)})</span>
      </div>
      <div class="bookmark-folder ${window._currentBookmarkFolder === 0 ? 'active' : ''}" onclick="filterBookmarks(0)">
        📋 未分类 <span class="count">(${data.unfoldered})</span>
      </div>
      ${data.folders.map(f => `
        <div class="bookmark-folder ${window._currentBookmarkFolder === f.id ? 'active' : ''}" onclick="filterBookmarks(${f.id})">
          📂 ${escapeHtml(f.name)} <span class="count">(${f.post_count})</span>
          <span class="folder-actions">
            <button onclick="event.stopPropagation();renameBookmarkFolder(${f.id}, '${escapeHtml(f.name)}')" title="重命名">✏️</button>
            <button onclick="event.stopPropagation();deleteBookmarkFolder(${f.id})" title="删除">🗑️</button>
          </span>
        </div>
      `).join('')}
      <button class="bookmark-folder-add" onclick="createBookmarkFolder()">+ 新建文件夹</button>
    </div>
  `;
}

async function loadBookmarkPosts() {
  const folderParam = window._currentBookmarkFolder !== null ? `?folder_id=${window._currentBookmarkFolder}` : '';
  const posts = await api(`/api/bookmarks${folderParam}`);
  const container = document.getElementById('postList');
  container.innerHTML = '';

  if (posts.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">⭐</div><p>该文件夹暂无收藏</p></div>';
    return;
  }

  posts.forEach(post => {
    const div = document.createElement('div');
    div.className = 'post-card';
    div.onclick = () => showPostDetail(post.id);
    div.innerHTML = `
      <div class="post-meta">
        <div class="post-avatar">${post.avatar}</div>
        <span class="post-author">${escapeHtml(post.username)}</span>
        <span class="post-category">${post.category}</span>
        <span>${formatTime(post.created_at)}</span>
      </div>
      <div class="post-title">${escapeHtml(post.title)}</div>
      <div class="post-excerpt">${escapeHtml(post.content).replace(/\n/g, ' ')}</div>
      <div class="post-footer">
        <button class="post-action bookmarked" onclick="event.stopPropagation();bookmarkPost(${post.id}, this)">⭐</button>
        <button class="post-action" onclick="event.stopPropagation();likePost(${post.id}, this)">❤️ ${post.likes}</button>
        <span class="post-action">💬 ${post.comment_count}</span>
        <button class="post-action" onclick="event.stopPropagation();moveBookmark(${post.id})" title="移动到文件夹">📂</button>
      </div>
    `;
    container.appendChild(div);
  });
}

async function filterBookmarks(folderId) {
  window._currentBookmarkFolder = folderId;
  await loadBookmarkFolders();
  await loadBookmarkPosts();
}

async function createBookmarkFolder() {
  const name = prompt('请输入文件夹名称：');
  if (!name || !name.trim()) return;

  await api('/api/bookmark-folders', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
  showToast('文件夹已创建');
  await loadBookmarkFolders();
}

async function renameBookmarkFolder(id, currentName) {
  const name = prompt('请输入新名称：', currentName);
  if (!name || !name.trim() || name.trim() === currentName) return;

  await api(`/api/bookmark-folders/${id}`, { method: 'PUT', body: JSON.stringify({ name: name.trim() }) });
  showToast('文件夹已重命名');
  await loadBookmarkFolders();
}

async function deleteBookmarkFolder(id) {
  if (!confirm('确定删除此文件夹？文件夹内的收藏将移至"未分类"。')) return;

  await api(`/api/bookmark-folders/${id}`, { method: 'DELETE' });
  showToast('文件夹已删除');
  window._currentBookmarkFolder = null;
  await loadBookmarkFolders();
  await loadBookmarkPosts();
}

async function moveBookmark(postId) {
  const data = await api('/api/bookmark-folders');
  const folders = data.folders;

  if (folders.length === 0) {
    showToast('请先创建文件夹');
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.id = 'moveBookmarkModal';
  overlay.innerHTML = `
    <div class="modal" style="max-width:350px;">
      <div class="modal-header">
        <div class="modal-title">移动到文件夹</div>
        <button class="modal-close" onclick="document.getElementById('moveBookmarkModal').remove()">×</button>
      </div>
      <div class="modal-body">
        <div class="bookmark-folder" style="display:block;text-align:center;margin-bottom:8px;" onclick="doMoveBookmark(${postId}, 0)">📋 未分类</div>
        ${folders.map(f => `
          <div class="bookmark-folder" style="display:block;text-align:center;margin-bottom:8px;" onclick="doMoveBookmark(${postId}, ${f.id})">📂 ${escapeHtml(f.name)}</div>
        `).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function doMoveBookmark(postId, folderId) {
  await api(`/api/bookmarks/${postId}/move`, { method: 'POST', body: JSON.stringify({ folder_id: folderId }) });
  document.getElementById('moveBookmarkModal')?.remove();
  showToast('已移动');
  await loadBookmarkFolders();
  await loadBookmarkPosts();
}

// Search
function handleSearch(e) {
  if (e.key === 'Enter') {
    const q = e.target.value.trim();
    if (q) { searchQuery = q; performSearch(q); }
  }
}

async function performSearch(q) {
  currentView = 'detail';
  const res = await api(`/api/search?q=${encodeURIComponent(q)}`);

  document.getElementById('mainContent').innerHTML = `
    <button class="back-btn" onclick="goHome()">← 返回列表</button>
    <div class="search-header">搜索 "<strong>${escapeHtml(q)}</strong>" 的结果：共 ${res.total} 条</div>
    <div id="postList"></div>
  `;

  document.getElementById('categoryTabs').style.display = 'none';
  document.querySelector('.sort-tabs').style.display = 'none';

  const container = document.getElementById('postList');
  if (res.posts.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p>没有找到相关帖子</p></div>';
    return;
  }

  res.posts.forEach(post => {
    const div = document.createElement('div');
    div.className = 'post-card';
    div.onclick = () => showPostDetail(post.id);
    div.innerHTML = `
      <div class="post-meta">
        <div class="post-avatar">${post.avatar}</div>
        <span class="post-author">${escapeHtml(post.username)}</span>
        <span class="post-category">${post.category}</span>
        <span>${formatTime(post.created_at)}</span>
      </div>
      <div class="post-title">${escapeHtml(post.title)}</div>
      <div class="post-excerpt">${escapeHtml(post.content).replace(/\n/g, ' ')}</div>
      ${post.tags && post.tags.length > 0 ? `<div class="post-tags">${post.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      <div class="post-footer">
        <button class="post-action" onclick="event.stopPropagation();likePost(${post.id}, this)">❤️ ${post.likes}</button>
        <span class="post-action">💬 ${post.comment_count}</span>
      </div>
    `;
    container.appendChild(div);
  });
}

function sharePost(postId) {
  const url = window.location.origin + '?post=' + postId;
  navigator.clipboard.writeText(url).then(() => showToast('链接已复制')).catch(() => showToast('复制失败'));
}

// Actions
async function likePost(id, btn) {
  if (!currentUser) return showAuthModal();
  const res = await api(`/api/posts/${id}/like`, { method: 'POST' });
  const count = parseInt(btn.textContent.match(/\d+/)[0]);
  btn.textContent = `❤️ ${res.liked ? count + 1 : count - 1}`;
  btn.classList.toggle('active', res.liked);
}

async function bookmarkPost(id, btn) {
  if (!currentUser) return showAuthModal();
  const res = await api(`/api/posts/${id}/bookmark`, { method: 'POST' });
  if (res.bookmarked) { btn.classList.add('bookmarked'); btn.innerHTML = btn.innerHTML.replace('☆', '⭐'); showToast('已收藏'); }
  else { btn.classList.remove('bookmarked'); btn.innerHTML = btn.innerHTML.replace('⭐', '☆'); showToast('已取消收藏'); }
}

async function likeComment(id, btn) {
  if (!currentUser) return showAuthModal();
  const res = await api(`/api/comments/${id}/like`, { method: 'POST' });
  const count = parseInt(btn.textContent.match(/\d+/)[0]);
  btn.textContent = `❤️ ${res.liked ? count + 1 : count - 1}`;
  btn.classList.toggle('active', res.liked);
}

async function togglePin(id) {
  const res = await api(`/api/posts/${id}/pin`, { method: 'POST' });
  showToast(res.pinned ? '已置顶' : '已取消置顶');
  if (currentView === 'detail') showPostDetail(id);
  else loadPosts();
}

async function submitPost() {
  const title = document.getElementById('postTitle').value.trim();
  const content = document.getElementById('postContent').value.trim();
  const category = document.getElementById('postCategory').value;
  const errEl = document.getElementById('postError');

  if (!title || !content) { errEl.textContent = '标题和内容不能为空'; errEl.style.display = 'block'; return; }

  let res;
  if (editingPostId) {
    res = await api(`/api/posts/${editingPostId}`, { method: 'PUT', body: JSON.stringify({ title, content, category, tags: postTags }) });
  } else {
    res = await api('/api/posts', { method: 'POST', body: JSON.stringify({ title, content, category, tags: postTags }) });
  }

  if (res.error) { errEl.textContent = res.error; errEl.style.display = 'block'; }
  else {
    closeModal('newPostModal');
    const wasEditing = editingPostId;
    editingPostId = null;
    // Clear draft after successful publish
    if (!wasEditing) {
      localStorage.removeItem('draft');
      api('/api/drafts', { method: 'POST', body: JSON.stringify({ title: '', content: '', category: '', tags: [] }) }).catch(() => {});
    }
    showToast(wasEditing ? '帖子已更新' : '发布成功！');
    if (currentView === 'detail' && wasEditing) showPostDetail(wasEditing);
    else goHome();
  }
}

function deletePost(id) {
  showConfirm('删除帖子', '确定要删除这篇帖子吗？删除后无法恢复。', async () => {
    await api(`/api/posts/${id}`, { method: 'DELETE' });
    showToast('帖子已删除');
    goHome();
  });
}

async function submitComment(postId) {
  if (!currentUser) return showAuthModal();
  const input = document.getElementById('commentInput');
  const content = input.value.trim();
  if (!content) return;
  await api(`/api/posts/${postId}/comments`, { method: 'POST', body: JSON.stringify({ content }) });
  showToast('评论成功！');
  showPostDetail(postId);
}

// Stats, Hot Posts, Tags
async function loadStats() {
  const stats = await api('/api/stats');
  document.getElementById('statUsers').textContent = stats.users;
  document.getElementById('statPosts').textContent = stats.posts;
  document.getElementById('statComments').textContent = stats.comments;
  document.getElementById('statViews').textContent = stats.totalViews > 1000 ? (stats.totalViews / 1000).toFixed(1) + 'k' : stats.totalViews;
}

async function loadHotPosts() {
  const res = await api('/api/posts?sort=hot&page=1');
  const container = document.getElementById('hotPosts');
  container.innerHTML = res.posts.slice(0, 5).map((p, i) => `
    <div class="hot-topic" onclick="showPostDetail(${p.id})">
      <div class="hot-rank ${i < 3 ? 'top' : ''}">${i + 1}</div>
      <div class="hot-title">${escapeHtml(p.title)}</div>
      <div class="hot-likes">❤️ ${p.likes}</div>
    </div>
  `).join('');
}

async function loadTags() {
  const tags = await api('/api/tags');
  const container = document.getElementById('tagCloud');
  container.innerHTML = tags.map(t => `<span class="tag" onclick="filterByTag('${escapeHtml(t.name)}')">${escapeHtml(t.name)} (${t.post_count})</span>`).join('');
}

// Helpers
function formatTime(dateStr) {
  const date = new Date(dateStr + 'Z');
  const now = new Date();
  const diff = (now - date) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
  if (diff < 604800) return Math.floor(diff / 86400) + '天前';
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Image upload
async function uploadImage(input) {
  const file = input.files[0];
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    showToast('图片不能超过5MB');
    return;
  }

  const formData = new FormData();
  formData.append('image', file);

  const toolbar = input.closest('.editor-wrapper').querySelector('.upload-progress') || (() => {
    const el = document.createElement('div');
    el.className = 'upload-progress';
    input.closest('.editor-wrapper').appendChild(el);
    return el;
  })();

  toolbar.textContent = '上传中...';

  try {
    const headers = {};
    if (currentUser) headers['X-User-Id'] = currentUser.id;

    const res = await fetch('/api/upload', {
      method: 'POST',
      headers,
      body: formData
    });

    const data = await res.json();
    if (data.url) {
      insertFormat(`\n![${file.name}](${data.url})\n`, '');
      toolbar.textContent = '上传成功';
      setTimeout(() => toolbar.textContent = '', 2000);
    } else {
      toolbar.textContent = '上传失败: ' + (data.error || '未知错误');
    }
  } catch (e) {
    toolbar.textContent = '上传失败';
  }

  input.value = '';
}

// Lightbox
function openLightbox(src) {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightbox').classList.add('show');
}

// TOC generation
function generateTOC(content) {
  const headings = [];
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    const match = line.match(/^(#{1,3})\s+(.+)/);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      const id = 'heading-' + i;
      headings.push({ level, text, id });
    }
  });
  return headings;
}

// Keyboard shortcuts
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Don't trigger when typing in input/textarea
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    // ? - Toggle shortcuts help
    if (e.key === '?') {
      e.preventDefault();
      document.getElementById('shortcutsHelp').classList.toggle('show');
      return;
    }

    // / - Focus search
    if (e.key === '/') {
      e.preventDefault();
      document.getElementById('searchInput').focus();
      return;
    }

    // N - New post
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      showNewPostModal();
      return;
    }

    // Esc - Go back or close modal
    if (e.key === 'Escape') {
      e.preventDefault();
      const openModal = document.querySelector('.modal-overlay.active');
      if (openModal) {
        openModal.classList.remove('show');
      } else if (currentView !== 'list') {
        goHome();
      }
      document.getElementById('shortcutsHelp').classList.remove('show');
      return;
    }

    // Only in list view
    if (currentView === 'list') {
      postCards = document.querySelectorAll('.post-card');

      // J - Next post
      if (e.key === 'j') {
        e.preventDefault();
        focusedPostIndex = Math.min(focusedPostIndex + 1, postCards.length - 1);
        focusPost(focusedPostIndex);
        return;
      }

      // K - Previous post
      if (e.key === 'k') {
        e.preventDefault();
        focusedPostIndex = Math.max(focusedPostIndex - 1, 0);
        focusPost(focusedPostIndex);
        return;
      }

      // Enter - Open focused post
      if (e.key === 'Enter' && focusedPostIndex >= 0) {
        e.preventDefault();
        postCards[focusedPostIndex].click();
        return;
      }

      // L - Like focused post
      if (e.key === 'l' && focusedPostIndex >= 0) {
        e.preventDefault();
        const likeBtn = postCards[focusedPostIndex].querySelector('.post-action');
        if (likeBtn) likeBtn.click();
        return;
      }

      // B - Bookmark focused post
      if (e.key === 'b' && focusedPostIndex >= 0) {
        e.preventDefault();
        const bookmarkBtn = postCards[focusedPostIndex].querySelector('.post-action.bookmarked, .post-action:not(.active)');
        if (bookmarkBtn) bookmarkBtn.click();
        return;
      }
    }
  });
}

function focusPost(index) {
  postCards.forEach(c => c.classList.remove('focused'));
  if (postCards[index]) {
    postCards[index].classList.add('focused');
    postCards[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// Draft auto-save
function saveDraft() {
  const title = document.getElementById('postTitle').value;
  const content = document.getElementById('postContent').value;
  const category = document.getElementById('postCategory').value;

  if (title || content) {
    localStorage.setItem('draft', JSON.stringify({ title, content, category, tags: postTags }));
    // Also sync to server
    api('/api/drafts', { method: 'POST', body: JSON.stringify({ title, content, category, tags: postTags }) });
  }
}

function loadDraft() {
  const draft = localStorage.getItem('draft');
  if (draft) {
    const { title, content, category, tags } = JSON.parse(draft);
    document.getElementById('postTitle').value = title || '';
    document.getElementById('postContent').value = content || '';
    document.getElementById('postCategory').value = category || '综合';
    postTags = tags || [];
    renderTagInput();
    showToast('已恢复草稿');
  }
}

function clearDraft() {
  localStorage.removeItem('draft');
}

// Polling for new posts
function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(async () => {
    if (currentView !== 'list') return;
    try {
      const res = await api(`/api/check-new?after=${encodeURIComponent(lastCheckTime)}`);
      if (res.newPosts > 0) {
        const banner = document.querySelector('.new-post-banner');
        if (banner) {
          banner.style.display = 'block';
          banner.textContent = `📢 有 ${res.newPosts} 条新帖子，点击刷新`;
        }
      }
      if (res.newNotifications > 0 && currentUser) {
        loadNotifications();
      }
    } catch (e) {}
  }, 30000); // Check every 30 seconds
}

// Override showNewPostModal to add draft support, schedule button, multi-image upload, and templates
const _originalShowNewPostModal = showNewPostModal;
showNewPostModal = function(editId = null) {
  _originalShowNewPostModal(editId);
  if (!editId) {
    // Add draft load button
    const draft = localStorage.getItem('draft');
    if (draft) {
      const titleEl = document.getElementById('postTitle');
      if (!titleEl.value) {
        setTimeout(() => loadDraft(), 100);
      }
    }

    // Setup auto-save
    setTimeout(() => {
      const titleEl = document.getElementById('postTitle');
      const contentEl = document.getElementById('postContent');
      if (titleEl && contentEl) {
        titleEl.addEventListener('input', () => {
          clearTimeout(draftTimer);
          draftTimer = setTimeout(saveDraft, 2000);
        });
        contentEl.addEventListener('input', () => {
          clearTimeout(draftTimer);
          draftTimer = setTimeout(saveDraft, 2000);
        });
      }
    }, 200);
  }

  // Add schedule button, multi-image upload, and template button
  setTimeout(() => {
    const modal = document.getElementById('postModal');
    if (!modal) return;

    const submitBtn = document.getElementById('postSubmitBtn');
    if (submitBtn && !document.getElementById('scheduleBtn')) {
      const scheduleBtn = document.createElement('button');
      scheduleBtn.id = 'scheduleBtn';
      scheduleBtn.className = 'btn btn-outline';
      scheduleBtn.style.marginLeft = '8px';
      scheduleBtn.textContent = '⏰ 定时发布';
      scheduleBtn.onclick = showScheduleModal;
      submitBtn.parentNode.insertBefore(scheduleBtn, submitBtn.nextSibling);
    }

    // Add template button
    if (submitBtn && !document.getElementById('templateBtn')) {
      const templateBtn = document.createElement('button');
      templateBtn.id = 'templateBtn';
      templateBtn.className = 'btn btn-ghost';
      templateBtn.style.marginLeft = '8px';
      templateBtn.textContent = '📋 模板';
      templateBtn.onclick = showTemplateMenu;
      submitBtn.parentNode.insertBefore(templateBtn, submitBtn.nextSibling);
    }

    // Add multi-image upload area
    const contentInput = document.getElementById('postContent');
    if (contentInput && !document.getElementById('imageUploadArea')) {
      const uploadHtml = `
        <div class="image-upload-area" id="imageUploadArea">
          📷 点击或拖拽上传图片（最多9张）
          <input type="file" id="multiImageInput" multiple accept="image/*" style="display:none;">
        </div>
        <div class="image-preview-grid" id="imagePreviewGrid"></div>
      `;
      contentInput.insertAdjacentHTML('beforebegin', uploadHtml);
      setupMultiImageUpload();
    }
  }, 100);
};

// Override submitPost to clear draft
const _originalSubmitPost = submitPost;
submitPost = async function() {
  await _originalSubmitPost();
  clearDraft();
};

// Override parseMarkdown to add syntax highlighting, image click, and video embed
const _originalParseMarkdown = parseMarkdown;
parseMarkdown = function(text) {
  let html = _originalParseMarkdown(text);

  // Make images clickable
  html = html.replace(/<img src="([^"]+)" alt="([^"]*)">/g, '<img src="$1" alt="$2" onclick="openLightbox(\'$1\')" style="cursor:pointer;">');

  // Parse video embeds
  html = parseVideoEmbeds(html);

  return html;
};

// Override showPostDetail to add TOC, comment sorting, and code highlighting
const _originalShowPostDetail = showPostDetail;
showPostDetail = async function(id) {
  await _originalShowPostDetail(id);

  // Add TOC
  const post = await api(`/api/posts/${id}`);
  const headings = generateTOC(post.content);
  const contentEl = document.querySelector('.post-detail-content');

  if (headings.length >= 3 && contentEl) {
    const toc = document.createElement('div');
    toc.className = 'toc';
    toc.innerHTML = `<div class="toc-title">📑 目录</div>` +
      headings.map(h => `<a class="toc-h${h.level}" href="#${h.id}" onclick="event.preventDefault();document.getElementById('${h.id}').scrollIntoView({behavior:'smooth'})">${escapeHtml(h.text)}</a>`).join('');
    contentEl.insertBefore(toc, contentEl.firstChild);

    // Add IDs to headings in content
    const headingElements = contentEl.querySelectorAll('h1, h2, h3');
    headingElements.forEach((el, i) => {
      if (headings[i]) el.id = headings[i].id;
    });
  }

  // Add comment sorting
  const commentsTitle = document.querySelector('.comments-title');
  if (commentsTitle) {
    commentsTitle.innerHTML = `💬 评论
      <div style="display:inline-flex;gap:4px;margin-left:12px;">
        <button class="btn btn-sm ${commentSort === 'new' ? 'btn-primary' : 'btn-ghost'}" onclick="changeCommentSort('new', ${id})">最新</button>
        <button class="btn btn-sm ${commentSort === 'hot' ? 'btn-primary' : 'btn-ghost'}" onclick="changeCommentSort('hot', ${id})">最热</button>
      </div>`;
  }

  // Highlight code blocks
  document.querySelectorAll('.post-detail-content pre code, .comment-content pre code').forEach(block => {
    if (window.hljs) hljs.highlightElement(block);
  });

  // Add history button for post owner
  if (currentUser) {
    if (post.user_id === currentUser.id || currentUser.id === 1) {
      const actionsBar = document.querySelector('.post-actions-bar');
      if (actionsBar && !document.getElementById('historyBtn')) {
        const historyBtn = document.createElement('button');
        historyBtn.id = 'historyBtn';
        historyBtn.className = 'post-action';
        historyBtn.textContent = '📝 历史';
        historyBtn.onclick = () => showPostHistory(id);
        actionsBar.appendChild(historyBtn);
      }
    }

    // Add ban button for admin
    if (currentUser.id === 1 && post.user_id !== currentUser.id) {
      const actionsBar = document.querySelector('.post-actions-bar');
      if (actionsBar && !document.getElementById('banBtn')) {
        const banBtn = document.createElement('button');
        banBtn.id = 'banBtn';
        banBtn.className = 'report-btn';
        banBtn.textContent = '🚫 封禁';
        banBtn.onclick = () => showBanModal(post.user_id, post.username);
        actionsBar.appendChild(banBtn);
      }
    }
  }

  // Setup lazy loading for images
  setupLazyLoading();
};

async function changeCommentSort(sort, postId) {
  commentSort = sort;
  const comments = await api(`/api/posts/${postId}/comments?sort=${sort}`);

  const commentMap = {};
  const rootComments = [];
  comments.forEach(c => { c.children = []; commentMap[c.id] = c; });
  comments.forEach(c => {
    if (c.parent_id && commentMap[c.parent_id]) commentMap[c.parent_id].children.push(c);
    else rootComments.push(c);
  });

  const container = document.getElementById('commentsList');
  if (container) {
    container.innerHTML = rootComments.length === 0
      ? '<div style="text-align:center;padding:20px;color:var(--text-secondary);">暂无评论</div>'
      : rootComments.map(c => renderComment(c, 0)).join('');
  }

  // Update sort buttons
  document.querySelectorAll('.comments-title .btn-sm').forEach(btn => {
    btn.className = `btn btn-sm btn-ghost`;
  });
  event.target.className = `btn btn-sm btn-primary`;
}

// Override rebuildMainContent to add "关注" tab
const _originalRebuildMainContent = rebuildMainContent;
rebuildMainContent = function() {
  _originalRebuildMainContent();
  // Add new post banner
  const postList = document.getElementById('postList');
  if (postList) {
    const banner = document.createElement('div');
    banner.className = 'new-post-banner';
    banner.onclick = () => { loadPosts(); banner.style.display = 'none'; lastCheckTime = new Date().toISOString(); };
    postList.parentNode.insertBefore(banner, postList);
  }
};

// Override loadPosts to handle "关注" feed
const _originalLoadPosts = loadPosts;
loadPosts = async function(append = false) {
  if (currentCategory === '关注') {
    if (!currentUser) { showAuthModal(); return; }
    if (!append) currentPage = 1;

    const res = await api(`/api/feed?page=${currentPage}`);
    hasMore = res.hasMore;

    const container = document.getElementById('postList');
    if (!append) container.innerHTML = '';

    if (res.posts.length === 0 && !append) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><p>还没有关注任何人，或关注的人还没有发帖</p></div>';
      return;
    }

    res.posts.forEach(post => {
      const div = document.createElement('div');
      div.className = 'post-card';
      div.onclick = () => showPostDetail(post.id);
      div.innerHTML = `
        <div class="post-meta">
          <div class="post-avatar">${post.avatar}</div>
          <span class="post-author">${escapeHtml(post.username)}</span>
          <span class="post-category">${post.category}</span>
          <span>${formatTime(post.created_at)}</span>
        </div>
        <div class="post-title">${escapeHtml(post.title)}</div>
        <div class="post-excerpt">${escapeHtml(post.content).replace(/\n/g, ' ')}</div>
        ${post.tags && post.tags.length > 0 ? `<div class="post-tags">${post.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        <div class="post-footer">
          <button class="post-action ${post.bookmarked ? 'bookmarked' : ''}" onclick="event.stopPropagation();bookmarkPost(${post.id}, this)">${post.bookmarked ? '⭐' : '☆'}</button>
          <button class="post-action" onclick="event.stopPropagation();likePost(${post.id}, this)">❤️ ${post.likes}</button>
          <span class="post-action">💬 ${post.comment_count}</span>
          <span class="post-action">👁️ ${post.views || 0}</span>
        </div>
      `;
      container.appendChild(div);
    });

    isLoadingMore = false;
  } else {
    await _originalLoadPosts(append);
  }

  // Update focused index
  postCards = document.querySelectorAll('.post-card');
  focusedPostIndex = -1;

  // Load announcements and trending
  loadAnnouncements();
  loadTrendingTopics();
};

// Private Messages
let currentChatUser = null;

function toggleMessages() {
  const panel = document.getElementById('messagesPanel');
  panel.classList.toggle('show');
  if (panel.classList.contains('show')) loadConversations();
}

async function loadConversations() {
  const conversations = await api('/api/messages/conversations');
  const container = document.getElementById('conversationsList');
  const chatView = document.getElementById('chatView');

  chatView.classList.remove('show');
  container.style.display = 'block';

  if (conversations.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-secondary);">暂无私信</div>';
    return;
  }

  container.innerHTML = conversations.map(c => `
    <div class="conversation-item" onclick="openChat(${c.other_user_id}, '${escapeHtml(c.username)}', '${c.avatar}')">
      <div class="conversation-avatar">${c.avatar}</div>
      <div class="conversation-info">
        <div class="conversation-name">${escapeHtml(c.username)}</div>
        <div class="conversation-preview">${escapeHtml(c.last_message || '')}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
        <div class="conversation-time">${formatTime(c.last_time)}</div>
        ${c.unread_count > 0 ? `<div class="unread-badge">${c.unread_count}</div>` : ''}
      </div>
    </div>
  `).join('');
}

async function openChat(userId, username, avatar) {
  currentChatUser = { id: userId, username, avatar };
  document.getElementById('conversationsList').style.display = 'none';
  document.getElementById('chatView').classList.add('show');
  document.getElementById('chatPartnerName').textContent = username;

  const messages = await api(`/api/messages/${userId}`);
  const container = document.getElementById('chatMessages');

  container.innerHTML = messages.map(m => `
    <div>
      <div class="message-bubble ${m.sender_id === currentUser.id ? 'sent' : 'received'}">${escapeHtml(m.content)}</div>
      <div class="message-time ${m.sender_id === currentUser.id ? 'sent' : ''}">${formatTime(m.created_at)}</div>
    </div>
  `).join('');

  container.scrollTop = container.scrollHeight;
  document.getElementById('chatInput').focus();
  loadUnreadMessages();
}

function showConversations() {
  document.getElementById('chatView').classList.remove('show');
  loadConversations();
}

async function sendMessage() {
  const input = document.getElementById('chatInput');
  const content = input.value.trim();
  if (!content || !currentChatUser) return;

  await api(`/api/messages/${currentChatUser.id}`, {
    method: 'POST',
    body: JSON.stringify({ content })
  });

  input.value = '';

  // Add message to UI
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.innerHTML = `
    <div class="message-bubble sent">${escapeHtml(content)}</div>
    <div class="message-time sent">刚刚</div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function loadUnreadMessages() {
  if (!currentUser) return;
  const res = await api('/api/messages/unread/count');
  const badge = document.getElementById('msgBadge');
  if (badge) {
    if (res.count > 0) {
      badge.style.display = 'flex';
      badge.textContent = res.count > 9 ? '9+' : res.count;
    } else {
      badge.style.display = 'none';
    }
  }
}

function showMessageToUser(userId, username) {
  if (!currentUser) return showAuthModal();
  toggleMessages();
  setTimeout(() => openChat(userId, username, ''), 100);
}

// Reactions
const EMOJI_LIST = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🤔', '👏'];

async function loadReactions(type, id, container) {
  const reactions = await api(`/api/reactions/${type}/${id}`);
  if (reactions.length === 0) return;

  const bar = document.createElement('div');
  bar.className = 'reactions-bar';

  reactions.forEach(r => {
    const usernames = r.users ? r.users.split(',') : [];
    const isActive = currentUser && usernames.includes(currentUser.username);
    const btn = document.createElement('button');
    btn.className = `reaction ${isActive ? 'active' : ''}`;
    btn.title = usernames.join(', ');
    btn.innerHTML = `${r.emoji} ${r.count}`;
    btn.onclick = () => toggleReaction(type, id, r.emoji, btn);
    bar.appendChild(btn);
  });

  container.appendChild(bar);
}

function showReactionPicker(type, id, container) {
  if (!currentUser) return;

  // Remove existing picker
  const existing = container.querySelector('.reaction-picker');
  if (existing) { existing.remove(); return; }

  const picker = document.createElement('div');
  picker.className = 'reaction-picker';
  EMOJI_LIST.forEach(emoji => {
    const btn = document.createElement('button');
    btn.textContent = emoji;
    btn.onclick = async (e) => {
      e.stopPropagation();
      await api('/api/reactions', {
        method: 'POST',
        body: JSON.stringify({ [type === 'post' ? 'post_id' : 'comment_id']: id, emoji })
      });
      picker.remove();
      // Reload reactions
      const bar = container.querySelector('.reactions-bar');
      if (bar) bar.remove();
      loadReactions(type, id, container);
    };
    picker.appendChild(btn);
  });

  container.appendChild(picker);
}

async function toggleReaction(type, id, emoji, btn) {
  if (!currentUser) return showAuthModal();
  await api('/api/reactions', {
    method: 'POST',
    body: JSON.stringify({ [type === 'post' ? 'post_id' : 'comment_id']: id, emoji })
  });

  const container = btn.closest('.post-detail') || btn.closest('.comment-item');
  const bar = container.querySelector('.reactions-bar');
  if (bar) bar.remove();
  loadReactions(type, id, container);
}

// Achievements
async function loadAchievements(userId, container) {
  const achievements = await api(`/api/users/${userId}/achievements`);
  if (achievements.length === 0) return;

  container.innerHTML = `
    <div class="sidebar-title">🏆 成就徽章</div>
    <div class="achievements-grid">
      ${achievements.map(a => `
        <div class="achievement" title="${a.name}">
          <span class="achievement-icon">${a.icon}</span>
          <span>${a.name}</span>
        </div>
      `).join('')}
    </div>
  `;
}

// Activity Timeline
async function loadActivity(userId, container) {
  const activities = await api(`/api/users/${userId}/activity`);
  if (activities.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-secondary);">暂无动态</div>';
    return;
  }

  container.innerHTML = activities.map(a => {
    let icon = '', text = '';
    if (a.type === 'post') {
      icon = '📝';
      text = `发布了帖子 <strong>${escapeHtml(a.content)}</strong>`;
    } else if (a.type === 'comment') {
      icon = '💬';
      text = `评论了帖子 <strong>${escapeHtml(a.post_title)}</strong>`;
    } else if (a.type === 'like') {
      icon = '❤️';
      text = `赞了帖子 <strong>${escapeHtml(a.post_title)}</strong>`;
    } else if (a.type === 'follow') {
      icon = '👥';
      text = `关注了 <strong>${escapeHtml(a.username)}</strong>`;
    }

    return `
      <div class="activity-item">
        <div class="activity-icon">${icon}</div>
        <div class="activity-content">
          <div class="activity-text">${text}</div>
          <div class="activity-time">${formatTime(a.created_at)}</div>
        </div>
      </div>
    `;
  }).join('');
}

// Change Password
function showPasswordModal() {
  document.getElementById('oldPassword').value = '';
  document.getElementById('newPassword').value = '';
  document.getElementById('confirmPassword').value = '';
  document.getElementById('passwordError').style.display = 'none';
  document.getElementById('passwordModal').classList.add('active');
}

async function changePassword() {
  const oldPassword = document.getElementById('oldPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  const errEl = document.getElementById('passwordError');

  if (!oldPassword || !newPassword) {
    errEl.textContent = '请填写完整';
    errEl.style.display = 'block';
    return;
  }

  if (newPassword !== confirmPassword) {
    errEl.textContent = '两次输入的密码不一致';
    errEl.style.display = 'block';
    return;
  }

  const res = await api(`/api/users/${currentUser.id}/password`, {
    method: 'PUT',
    body: JSON.stringify({ oldPassword, newPassword })
  });

  if (res.error) {
    errEl.textContent = res.error;
    errEl.style.display = 'block';
  } else {
    closeModal('passwordModal');
    showToast('密码修改成功');
  }
}

// Block User
async function toggleBlock(userId, btn) {
  if (!currentUser) return showAuthModal();
  const res = await api(`/api/users/${userId}/block`, { method: 'POST' });
  if (res.blocked) {
    btn.className = 'btn btn-danger';
    btn.textContent = '已屏蔽';
    showToast('已屏蔽该用户');
  } else {
    btn.className = 'btn btn-outline';
    btn.textContent = '屏蔽';
    showToast('已取消屏蔽');
  }
}

// Override showProfile to add achievements, activity, and block button
const _originalShowProfile = showProfile;
showProfile = async function(userId) {
  await _originalShowProfile(userId);

  // Add achievements and activity tabs
  const profileHeader = document.querySelector('.profile-header');
  if (!profileHeader) return;

  const user = await api(`/api/users/${userId}`);

  // Add message and block buttons
  const buttonArea = profileHeader.querySelector('div:last-child');
  if (currentUser && currentUser.id !== userId) {
    const msgBtn = document.createElement('button');
    msgBtn.className = 'btn btn-outline';
    msgBtn.textContent = '✉️ 私信';
    msgBtn.onclick = () => showMessageToUser(userId, user.username);
    buttonArea.insertBefore(msgBtn, buttonArea.firstChild);

    const blockBtn = document.createElement('button');
    blockBtn.className = `btn ${user.isBlocked ? 'btn-danger' : 'btn-outline'}`;
    blockBtn.textContent = user.isBlocked ? '已屏蔽' : '屏蔽';
    blockBtn.onclick = () => toggleBlock(userId, blockBtn);
    buttonArea.appendChild(blockBtn);
  }

  // Add tabs for posts, activity, achievements
  const postList = document.getElementById('postList');
  if (!postList) return;

  const tabs = document.createElement('div');
  tabs.className = 'profile-tabs';
  tabs.innerHTML = `
    <button class="profile-tab active" onclick="showProfileTab(this, 'posts', ${userId})">📝 帖子</button>
    <button class="profile-tab" onclick="showProfileTab(this, 'activity', ${userId})">📅 动态</button>
    <button class="profile-tab" onclick="showProfileTab(this, 'achievements', ${userId})">🏆 成就</button>
  `;
  postList.parentNode.insertBefore(tabs, postList);

  // Add achievements container (hidden initially)
  const achievementsDiv = document.createElement('div');
  achievementsDiv.id = 'achievementsContainer';
  achievementsDiv.style.display = 'none';
  postList.parentNode.insertBefore(achievementsDiv, postList.nextSibling);

  // Add activity container (hidden initially)
  const activityDiv = document.createElement('div');
  activityDiv.id = 'activityContainer';
  activityDiv.style.display = 'none';
  postList.parentNode.insertBefore(activityDiv, postList.nextSibling);

  // Load achievements
  loadAchievements(userId, achievementsDiv);
};

async function showProfileTab(btn, tab, userId) {
  document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  const postList = document.getElementById('postList');
  const collectionsContainer = document.getElementById('collectionsContainer');
  const activityContainer = document.getElementById('activityContainer');
  const achievementsContainer = document.getElementById('achievementsContainer');

  postList.style.display = 'none';
  collectionsContainer.style.display = 'none';
  activityContainer.style.display = 'none';
  achievementsContainer.style.display = 'none';

  if (tab === 'posts') {
    postList.style.display = 'block';
  } else if (tab === 'collections') {
    collectionsContainer.style.display = 'block';
    await loadCollections(userId, collectionsContainer);
  } else if (tab === 'activity') {
    activityContainer.style.display = 'block';
    await loadActivity(userId, activityContainer);
  } else if (tab === 'achievements') {
    achievementsContainer.style.display = 'block';
  }
}

// @mention autocomplete
function setupMentionAutocomplete(textarea) {
  const dropdown = document.createElement('div');
  dropdown.className = 'mention-dropdown';
  textarea.parentNode.style.position = 'relative';
  textarea.parentNode.appendChild(dropdown);

  textarea.addEventListener('input', async (e) => {
    const value = textarea.value;
    const cursorPos = textarea.selectionStart;
    const textBefore = value.substring(0, cursorPos);
    const mentionMatch = textBefore.match(/@(\w*)$/);

    if (mentionMatch) {
      const query = mentionMatch[1];
      if (query.length >= 1) {
        // Search users
        const users = await searchUsers(query);
        if (users.length > 0) {
          dropdown.innerHTML = users.map(u => `
            <div class="mention-item" onclick="insertMention('${escapeHtml(u.username)}', this)">
              <span>${u.avatar}</span>
              <span>${escapeHtml(u.username)}</span>
            </div>
          `).join('');
          dropdown.classList.add('show');

          // Position dropdown
          const rect = textarea.getBoundingClientRect();
          dropdown.style.top = (textarea.offsetTop + textarea.offsetHeight) + 'px';
          dropdown.style.left = '0';
        } else {
          dropdown.classList.remove('show');
        }
      } else {
        dropdown.classList.remove('show');
      }
    } else {
      dropdown.classList.remove('show');
    }
  });
}

async function searchUsers(query) {
  if (!query || query.length < 1) return [];
  return await api(`/api/users/search?q=${encodeURIComponent(query)}`);
}

function insertMention(username, el) {
  const textarea = el.closest('.comment-form, .reply-form')?.querySelector('textarea') || document.getElementById('commentInput');
  if (!textarea) return;

  const value = textarea.value;
  const cursorPos = textarea.selectionStart;
  const textBefore = value.substring(0, cursorPos);
  const textAfter = value.substring(cursorPos);

  const mentionMatch = textBefore.match(/@(\w*)$/);
  if (mentionMatch) {
    const beforeMention = textBefore.substring(0, mentionMatch.index);
    textarea.value = beforeMention + '@' + username + ' ' + textAfter;
    textarea.focus();
    const newPos = beforeMention.length + username.length + 2;
    textarea.selectionStart = textarea.selectionEnd = newPos;
  }

  const dropdown = el.closest('.mention-dropdown');
  if (dropdown) dropdown.classList.remove('show');
}

// Polling enhancement - also check messages
const _originalStartPolling = startPolling;
startPolling = function() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(async () => {
    try {
      const res = await api(`/api/check-new?after=${encodeURIComponent(lastCheckTime)}`);
      if (res.newPosts > 0 && currentView === 'list') {
        const banner = document.querySelector('.new-post-banner');
        if (banner) {
          banner.style.display = 'block';
          banner.textContent = `📢 有 ${res.newPosts} 条新帖子，点击刷新`;
        }
      }
      if (currentUser) {
        if (res.newNotifications > 0) loadNotifications();
        loadUnreadMessages();
      }
    } catch (e) {}
  }, 30000);
};

// Check URL for shared post
const urlParams = new URLSearchParams(window.location.search);
const sharedPostId = urlParams.get('post');
if (sharedPostId) showPostDetail(sharedPostId);

// ==================== Phase 6 Features ====================

// Load announcements
async function loadAnnouncements() {
  try {
    const announcements = await api('/api/announcements');
    const banner = document.getElementById('announcementsBanner');
    const list = document.getElementById('announcementsList');

    if (announcements.length > 0) {
      banner.classList.add('has-announcements');
      list.innerHTML = announcements.map(a => `
        <div class="announcement-item">
          ${escapeHtml(a.content)}
          <span class="time">${formatTime(a.created_at)}</span>
        </div>
      `).join('');
    } else {
      banner.classList.remove('has-announcements');
    }
  } catch (e) {}
}

// Load trending topics
async function loadTrendingTopics() {
  try {
    const trending = await api('/api/trending');
    const container = document.getElementById('trendingTopics');

    if (trending.length === 0) {
      container.innerHTML = '<div style="font-size:13px;color:var(--text-secondary);padding:10px 0;">暂无热门话题</div>';
      return;
    }

    container.innerHTML = trending.map((t, i) => `
      <div class="trending-item" onclick="filterByTag('${escapeHtml(t.name)}')">
        <span class="trending-rank ${i < 3 ? 'top3' : ''}">${i + 1}</span>
        <div class="trending-info">
          <div class="trending-name">${escapeHtml(t.name)}</div>
          <div class="trending-stats">${t.post_count} 帖子 · ${t.total_likes} 赞 · ${t.total_views} 浏览</div>
        </div>
      </div>
    `).join('');
  } catch (e) {}
}

// Load online users
async function loadOnlineUsers() {
  try {
    const data = await api('/api/online-users');
    const countEl = document.getElementById('onlineCount');
    const listEl = document.getElementById('onlineUsersList');

    if (countEl) countEl.textContent = data.online;

    if (listEl && data.users.length > 0) {
      listEl.innerHTML = data.users.slice(0, 12).map(u => `
        <div class="online-user-avatar" title="${escapeHtml(u.username)}" onclick="showProfile(${u.id})" style="cursor:pointer;">
          ${u.avatar}
        </div>
      `).join('') + (data.users.length > 12 ? `<span style="font-size:12px;color:var(--text-secondary);">+${data.users.length - 12}</span>` : '');
    }
  } catch (e) {}
}

// Refresh online users every 30 seconds
setInterval(loadOnlineUsers, 30000);

// Report modal
function showReportModal(type, id) {
  if (!currentUser) { showToast('请先登录'); return; }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.id = 'reportModal';
  overlay.innerHTML = `
    <div class="modal" style="max-width:400px;">
      <div class="modal-header">
        <div class="modal-title">举报${type === 'post' ? '帖子' : '评论'}</div>
        <button class="modal-close" onclick="document.getElementById('reportModal').remove()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">举报原因</label>
          <select class="form-input" id="reportReason">
            <option value="spam">垃圾广告</option>
            <option value="inappropriate">不当内容</option>
            <option value="harassment">骚扰/霸凌</option>
            <option value="false">虚假信息</option>
            <option value="other">其他</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">详细说明（可选）</label>
          <textarea class="form-input" id="reportDescription" rows="3" placeholder="请描述具体问题..."></textarea>
        </div>
        <button class="btn btn-primary" style="width:100%;" onclick="submitReport('${type}', ${id})">提交举报</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

async function submitReport(type, id) {
  const reason = document.getElementById('reportReason').value;
  const description = document.getElementById('reportDescription').value;

  const body = { reason, description };
  if (type === 'post') body.post_id = id;
  else body.comment_id = id;

  const res = await api('/api/reports', {
    method: 'POST',
    body: JSON.stringify(body)
  });

  if (res.error) {
    showToast(res.error);
  } else {
    showToast('举报已提交，感谢你的反馈');
    document.getElementById('reportModal').remove();
  }
}

// Collections
async function loadCollections(userId, container) {
  const collections = await api(`/api/collections?user_id=${userId}`);

  if (collections.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📁</div>
        <p>还没有创建合集</p>
        ${currentUser && currentUser.id === userId ? '<button class="btn btn-primary" style="margin-top:12px;" onclick="showCreateCollectionModal()">创建合集</button>' : ''}
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="collections-section">
      ${currentUser && currentUser.id === userId ? '<button class="btn btn-primary btn-sm" style="margin-bottom:12px;" onclick="showCreateCollectionModal()">+ 新建合集</button>' : ''}
      ${collections.map(c => `
        <div class="collection-card" onclick="showCollectionDetail(${c.id})">
          <div class="collection-name">${escapeHtml(c.name)}</div>
          ${c.description ? `<div class="collection-desc">${escapeHtml(c.description)}</div>` : ''}
          <div class="collection-meta">${c.post_count} 篇文章 · ${formatTime(c.created_at)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function showCreateCollectionModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.id = 'collectionModal';
  overlay.innerHTML = `
    <div class="modal" style="max-width:400px;">
      <div class="modal-header">
        <div class="modal-title">创建合集</div>
        <button class="modal-close" onclick="document.getElementById('collectionModal').remove()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">合集名称</label>
          <input class="form-input" id="collectionName" placeholder="输入合集名称">
        </div>
        <div class="form-group">
          <label class="form-label">描述（可选）</label>
          <textarea class="form-input" id="collectionDesc" rows="3" placeholder="描述合集内容..."></textarea>
        </div>
        <button class="btn btn-primary" style="width:100%;" onclick="createCollection()">创建</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

async function createCollection() {
  const name = document.getElementById('collectionName').value.trim();
  const description = document.getElementById('collectionDesc').value.trim();

  if (!name) { showToast('请输入合集名称'); return; }

  const res = await api('/api/collections', {
    method: 'POST',
    body: JSON.stringify({ name, description })
  });

  if (res.error) {
    showToast(res.error);
  } else {
    showToast('合集创建成功');
    document.getElementById('collectionModal').remove();
    if (currentView === 'detail') showProfile(currentUser.id);
  }
}

async function showCollectionDetail(collectionId) {
  currentView = 'detail';
  const collection = await api(`/api/collections/${collectionId}`);

  document.getElementById('mainContent').innerHTML = `
    <button class="back-btn" onclick="goHome()">← 返回列表</button>
    <div class="post-detail">
      <h2 style="margin-bottom:8px;">📁 ${escapeHtml(collection.name)}</h2>
      ${collection.description ? `<p style="color:var(--text-secondary);margin-bottom:12px;">${escapeHtml(collection.description)}</p>` : ''}
      <div style="font-size:13px;color:var(--text-secondary);">由 ${escapeHtml(collection.username)} 创建 · ${collection.posts.length} 篇文章</div>
    </div>
    <div id="postList" style="margin-top:16px;"></div>
  `;

  document.getElementById('categoryTabs').style.display = 'none';
  document.querySelector('.sort-tabs').style.display = 'none';

  const container = document.getElementById('postList');
  if (collection.posts.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📝</div><p>合集中还没有帖子</p></div>';
    return;
  }

  collection.posts.forEach(post => {
    const div = document.createElement('div');
    div.className = 'post-card';
    div.onclick = () => showPostDetail(post.id);
    div.innerHTML = `
      <div class="post-meta">
        <div class="post-avatar">${post.avatar}</div>
        <span class="post-author">${escapeHtml(post.username)}</span>
        <span>${formatTime(post.created_at)}</span>
      </div>
      <div class="post-title">${escapeHtml(post.title)}</div>
    `;
    container.appendChild(div);
  });
}

function showAddToCollectionModal(postId) {
  if (!currentUser) { showToast('请先登录'); return; }

  api(`/api/collections?user_id=${currentUser.id}`).then(collections => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.id = 'addToCollectionModal';

    if (collections.length === 0) {
      overlay.innerHTML = `
        <div class="modal" style="max-width:400px;">
          <div class="modal-header">
            <div class="modal-title">收入合集</div>
            <button class="modal-close" onclick="document.getElementById('addToCollectionModal').remove()">×</button>
          </div>
          <div class="modal-body">
            <p style="text-align:center;color:var(--text-secondary);margin-bottom:16px;">你还没有创建合集</p>
            <button class="btn btn-primary" style="width:100%;" onclick="document.getElementById('addToCollectionModal').remove();showCreateCollectionModal();">创建合集</button>
          </div>
        </div>
      `;
    } else {
      overlay.innerHTML = `
        <div class="modal" style="max-width:400px;">
          <div class="modal-header">
            <div class="modal-title">选择合集</div>
            <button class="modal-close" onclick="document.getElementById('addToCollectionModal').remove()">×</button>
          </div>
          <div class="modal-body">
            ${collections.map(c => `
              <div class="collection-card" onclick="addToCollection(${c.id}, ${postId})" style="cursor:pointer;">
                <div class="collection-name">${escapeHtml(c.name)}</div>
                <div class="collection-meta">${c.post_count} 篇文章</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  });
}

async function addToCollection(collectionId, postId) {
  const res = await api(`/api/collections/${collectionId}/posts`, {
    method: 'POST',
    body: JSON.stringify({ post_id: postId })
  });

  if (res.error) {
    showToast(res.error);
  } else {
    showToast('已添加到合集');
    document.getElementById('addToCollectionModal').remove();
  }
}

// Admin panel
async function showAdminPanel() {
  if (!currentUser || currentUser.id !== 1) { showToast('无权限'); return; }

  currentView = 'detail';
  const [reports, announcements] = await Promise.all([
    api('/api/reports'),
    api('/api/announcements')
  ]);

  const pendingReports = reports.filter(r => r.status === 'pending');
  const resolvedReports = reports.filter(r => r.status !== 'pending');

  document.getElementById('mainContent').innerHTML = `
    <button class="back-btn" onclick="goHome()">← 返回列表</button>
    <div class="post-detail">
      <h2 style="margin-bottom:16px;">🛡️ 管理后台</h2>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px;">
        <div style="background:var(--bg);border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:24px;font-weight:700;color:var(--danger);">${pendingReports.length}</div>
          <div style="font-size:13px;color:var(--text-secondary);">待处理举报</div>
        </div>
        <div style="background:var(--bg);border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:24px;font-weight:700;color:var(--success);">${resolvedReports.length}</div>
          <div style="font-size:13px;color:var(--text-secondary);">已处理</div>
        </div>
        <div style="background:var(--bg);border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:24px;font-weight:700;color:var(--primary);">${announcements.length}</div>
          <div style="font-size:13px;color:var(--text-secondary);">公告数量</div>
        </div>
      </div>

      <div style="margin-bottom:24px;">
        <h3 style="margin-bottom:12px;">📢 社区公告</h3>
        <div style="display:flex;gap:8px;margin-bottom:12px;">
          <input class="form-input" id="newAnnouncement" placeholder="输入公告内容..." style="flex:1;">
          <button class="btn btn-primary" onclick="addAnnouncement()">发布公告</button>
        </div>
        ${announcements.length > 0 ? announcements.map(a => `
          <div class="announcement-item" style="display:flex;justify-content:space-between;align-items:center;">
            <span>${escapeHtml(a.content)}</span>
            <button class="btn btn-sm btn-danger" onclick="deleteAnnouncement(${a.id})">删除</button>
          </div>
        `).join('') : '<p style="color:var(--text-secondary);font-size:13px;">暂无公告</p>'}
      </div>

      <div>
        <h3 style="margin-bottom:12px;">⚠️ 举报队列 ${pendingReports.length > 0 ? `<span style="color:var(--danger);font-size:14px;">(${pendingReports.length}条待处理)</span>` : ''}</h3>
        ${reports.length === 0 ? '<p style="color:var(--text-secondary);font-size:13px;">暂无举报</p>' : ''}
        ${reports.map(r => `
          <div style="background:var(--bg);border:1px solid ${r.status === 'pending' ? 'var(--danger)' : 'var(--border)'};border-radius:8px;padding:12px;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <span style="font-weight:500;">${r.reporter_name || '用户'}</span>
                <span style="color:var(--text-secondary);font-size:13px;"> 举报了 ${r.type === 'post' ? '帖子' : '评论'} #${r.target_id}</span>
              </div>
              <span class="user-level-badge level-${r.status === 'pending' ? '4' : r.status === 'resolved' ? '1' : '2'}">${r.status === 'pending' ? '待处理' : r.status === 'resolved' ? '已处理' : '已忽略'}</span>
            </div>
            <div style="font-size:13px;color:var(--text-secondary);margin-top:4px;">原因: ${r.reason}${r.description ? ' - ' + escapeHtml(r.description) : ''}</div>
            <div style="display:flex;gap:8px;margin-top:8px;">
              ${r.type === 'post' ? `<button class="btn btn-sm btn-ghost" onclick="showPostDetail(${r.target_id})">查看帖子</button>` : ''}
              ${r.status === 'pending' ? `
                <button class="btn btn-sm btn-primary" onclick="handleReport(${r.id}, 'resolved')">处理</button>
                <button class="btn btn-sm btn-outline" onclick="handleReport(${r.id}, 'dismissed')">忽略</button>
                ${r.type === 'post' ? `<button class="btn btn-sm btn-danger" onclick="deleteReportedPost(${r.target_id}, ${r.id})">删除帖子</button>` : ''}
              ` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  document.getElementById('categoryTabs').style.display = 'none';
  document.querySelector('.sort-tabs').style.display = 'none';
}

async function deleteReportedPost(postId, reportId) {
  if (!confirm('确定删除此帖子？')) return;
  await api(`/api/posts/${postId}`, { method: 'DELETE' });
  await api(`/api/reports/${reportId}`, { method: 'PUT', body: JSON.stringify({ status: 'resolved' }) });
  showToast('帖子已删除');
  showAdminPanel();
}

async function addAnnouncement() {
  const input = document.getElementById('newAnnouncement');
  const content = input.value.trim();
  if (!content) { showToast('请输入公告内容'); return; }

  const res = await api('/api/announcements', {
    method: 'POST',
    body: JSON.stringify({ title: '公告', content })
  });

  if (res.error) {
    showToast(res.error);
  } else {
    showToast('公告已发布');
    showAdminPanel();
  }
}

async function deleteAnnouncement(id) {
  await api(`/api/announcements/${id}`, { method: 'DELETE' });
  showToast('公告已删除');
  showAdminPanel();
}

async function handleReport(id, status) {
  await api(`/api/reports/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ status })
  });
  showToast(status === 'resolved' ? '举报已处理' : '举报已忽略');
  showAdminPanel();
}

// Load announcements on init
loadAnnouncements();
loadTrendingTopics();
loadOnlineUsers();

// ==================== Phase 7 Features ====================

// Online status heartbeat
let heartbeatInterval;
function startHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(async () => {
    if (currentUser) {
      try { await api('/api/heartbeat', { method: 'POST' }); } catch(e) {}
    }
  }, 60000); // Every minute
}

// Get online status HTML
function getOnlineStatusHtml(userId) {
  return `<span class="online-status offline" id="status-${userId}" data-userid="${userId}"></span>`;
}

// Load online status for visible users
async function loadOnlineStatus(userIds) {
  for (const userId of userIds) {
    try {
      const res = await api(`/api/users/${userId}/status`);
      const el = document.getElementById(`status-${userId}`);
      if (el) {
        el.className = `online-status ${res.status}`;
        el.title = res.status === 'online' ? '在线' : res.status === 'away' ? '离开' : '离线';
      }
    } catch(e) {}
  }
}

// Comment voting
async function voteComment(commentId, vote, btn) {
  if (!currentUser) { showToast('请先登录'); return; }

  const res = await api(`/api/comments/${commentId}/vote`, {
    method: 'POST',
    body: JSON.stringify({ vote })
  });

  if (res.error) { showToast(res.error); return; }

  // Update UI
  const container = btn.closest('.vote-buttons');
  const upBtn = container.querySelector('.vote-up');
  const downBtn = container.querySelector('.vote-down');
  const countEl = container.querySelector('.vote-count');

  upBtn.classList.remove('upvoted');
  downBtn.classList.remove('downvoted');

  const currentVote = res.vote;
  if (currentVote === 1) upBtn.classList.add('upvoted');
  if (currentVote === -1) downBtn.classList.add('upvoted');

  // Update count
  const currentCount = parseInt(countEl.textContent) || 0;
  const newCount = currentCount + (res.action === 'added' ? vote : res.action === 'removed' ? -vote : vote * 2);
  countEl.textContent = newCount;
  countEl.className = `vote-count ${newCount > 0 ? 'positive' : newCount < 0 ? 'negative' : ''}`;
}

function renderVoteButtons(comment) {
  const voteCount = comment.likes || 0;
  const userVote = comment.userVote || 0;

  return `
    <div class="vote-buttons">
      <button class="vote-btn vote-up ${userVote === 1 ? 'upvoted' : ''}" onclick="voteComment(${comment.id}, 1, this)" title="赞">▲</button>
      <span class="vote-count ${voteCount > 0 ? 'positive' : voteCount < 0 ? 'negative' : ''}">${voteCount}</span>
      <button class="vote-btn vote-down ${userVote === -1 ? 'downvoted' : ''}" onclick="voteComment(${comment.id}, -1, this)" title="踩">▼</button>
    </div>
  `;
}

// Table of Contents generation
function generateTOC() {
  const contentEl = document.querySelector('.post-detail-content');
  if (!contentEl) return;

  const headings = contentEl.querySelectorAll('h1, h2, h3');
  if (headings.length < 3) {
    document.getElementById('toc').style.display = 'none';
    return;
  }

  const toc = document.getElementById('toc');
  let html = '<div class="toc-title">目录</div>';

  headings.forEach((h, i) => {
    const id = `heading-${i}`;
    h.id = id;
    const level = h.tagName.toLowerCase();
    const indent = level === 'h3' ? 'toc-h3' : '';
    html += `<a href="#${id}" class="${indent}" onclick="event.preventDefault();document.getElementById('${id}').scrollIntoView({behavior:'smooth'})">${h.textContent}</a>`;
  });

  toc.innerHTML = html;
  toc.style.display = 'block';

  // Highlight current section on scroll
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        toc.querySelectorAll('a').forEach(a => a.classList.remove('active'));
        toc.querySelector(`a[href="#${id}"]`)?.classList.add('active');
      }
    });
  }, { rootMargin: '-80px 0px -80% 0px' });

  headings.forEach(h => observer.observe(h));
}

// Draft management
let draftSaveTimeout;
function setupDraftAutoSave() {
  const titleInput = document.getElementById('postTitle');
  const contentInput = document.getElementById('postContent');

  if (!titleInput || !contentInput) return;

  const saveDraft = () => {
    clearTimeout(draftSaveTimeout);
    draftSaveTimeout = setTimeout(async () => {
      if (!currentUser) return;

      const title = titleInput.value.trim();
      const content = contentInput.value.trim();

      if (!title && !content) return;

      const indicator = document.getElementById('draftIndicator');
      indicator.classList.add('show');

      await api('/api/drafts', {
        method: 'POST',
        body: JSON.stringify({
          title,
          content,
          category: document.getElementById('postCategory')?.value || '综合',
          post_id: currentEditPostId || null
        })
      });

      setTimeout(() => indicator.classList.remove('show'), 2000);
    }, 3000);
  };

  titleInput.addEventListener('input', saveDraft);
  contentInput.addEventListener('input', saveDraft);
}

// Load drafts list
async function loadDrafts() {
  if (!currentUser) {
    // Not logged in — return localStorage draft only
    const local = localStorage.getItem('draft');
    if (local) {
      const d = JSON.parse(local);
      return [{ id: 'local', title: d.title, content: d.content, category: d.category, updated_at: new Date().toISOString() }];
    }
    return [];
  }
  const serverDrafts = await api('/api/drafts');
  // Also check localStorage for unsynced draft
  const local = localStorage.getItem('draft');
  if (local) {
    const d = JSON.parse(local);
    // Check if this draft is already on server (by matching title+content)
    const exists = serverDrafts.some(s => s.title === d.title && s.content === d.content);
    if (!exists && (d.title || d.content)) {
      serverDrafts.unshift({ id: 'local', title: d.title, content: d.content, category: d.category, tags: d.tags, updated_at: new Date().toISOString() });
    }
  }
  return serverDrafts;
}

// Show drafts modal
async function showDraftsModal() {
  const drafts = await loadDrafts();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.id = 'draftsModal';

  if (drafts.length === 0) {
    overlay.innerHTML = `
      <div class="modal" style="max-width:400px;">
        <div class="modal-header">
          <div class="modal-title">📝 草稿箱</div>
          <button class="modal-close" onclick="document.getElementById('draftsModal').remove()">×</button>
        </div>
        <div class="modal-body">
          <div class="empty-state">
            <div class="empty-icon">📭</div>
            <p>没有保存的草稿</p>
          </div>
        </div>
      </div>
    `;
  } else {
    overlay.innerHTML = `
      <div class="modal" style="max-width:500px;">
        <div class="modal-header">
          <div class="modal-title">📝 草稿箱</div>
          <button class="modal-close" onclick="document.getElementById('draftsModal').remove()">×</button>
        </div>
        <div class="modal-body">
          ${drafts.map(d => `
            <div class="collection-card" style="display:flex;justify-content:space-between;align-items:center;">
              <div onclick="loadDraft('${d.id}')" style="flex:1;cursor:pointer;">
                <div class="collection-name">${escapeHtml(d.title || '无标题草稿')}</div>
                <div class="collection-meta">${formatTime(d.updated_at)}</div>
              </div>
              <button class="btn btn-sm btn-danger" onclick="deleteDraft('${d.id}')">🗑️</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

async function loadDraft(draftId) {
  let draft;
  if (draftId === 'local') {
    const local = localStorage.getItem('draft');
    if (local) draft = JSON.parse(local);
  } else {
    const drafts = await api('/api/drafts');
    draft = drafts.find(d => d.id === Number(draftId));
  }
  if (!draft) return;

  document.getElementById('draftsModal').remove();
  showNewPostModal();

  setTimeout(() => {
    document.getElementById('postTitle').value = draft.title || '';
    document.getElementById('postContent').value = draft.content || '';
    if (draft.category) document.getElementById('postCategory').value = draft.category;
    if (draft.tags) { postTags = draft.tags; renderTagInput(); }
  }, 100);
}

async function deleteDraft(draftId) {
  if (draftId === 'local') {
    localStorage.removeItem('draft');
  } else {
    await api(`/api/drafts/${draftId}`, { method: 'DELETE' });
  }
  showToast('草稿已删除');
  document.getElementById('draftsModal').remove();
  showDraftsModal();
}

// Featured post toggle (admin)
async function toggleFeatured(postId) {
  if (!currentUser || currentUser.id !== 1) return;

  const res = await api(`/api/posts/${postId}/featured`, { method: 'PUT' });
  if (res.error) { showToast(res.error); return; }

  showToast(res.is_featured ? '已设为精华帖' : '已取消精华');
  showPostDetail(postId);
}

// Following feed
async function loadFollowingFeed() {
  if (!currentUser) { showToast('请先登录'); return; }

  currentView = 'list';
  currentCategory = '全部';
  currentSort = 'feed';

  document.getElementById('categoryTabs').style.display = 'none';

  const container = document.getElementById('postList');
  container.innerHTML = '<div class="loading"><div class="spinner"></div>加载中...</div>';

  const res = await api('/api/feed?page=1');
  container.innerHTML = '';

  if (res.posts.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><p>关注的用户还没有发布帖子</p><p style="font-size:13px;color:var(--text-secondary);margin-top:8px;">去发现更多有趣的人吧！</p></div>';
    return;
  }

  res.posts.forEach(post => {
    const div = document.createElement('div');
    div.className = 'post-card';
    div.onclick = () => showPostDetail(post.id);
    div.innerHTML = renderPostCard(post);
    container.appendChild(div);
  });
}

// Render post card helper
function renderPostCard(post) {
  return `
    <div class="post-meta">
      <div class="post-avatar">${post.avatar}</div>
      <span class="post-author">${escapeHtml(post.username)}</span>
      <span class="post-category">${post.category}</span>
      ${post.is_featured ? '<span class="featured-badge">💎 精华</span>' : ''}
      <span>${formatTime(post.created_at)}</span>
      ${post.is_pinned ? '<span class="pin-badge">📌 置顶</span>' : ''}
    </div>
    ${post.tags && post.tags.length > 0 ? `<div class="post-tags">${post.tags.map(t => `<span class="tag" onclick="event.stopPropagation();filterByTag('${escapeHtml(t)}')">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
    <div class="post-title">${escapeHtml(post.title)}</div>
    <div class="post-stats">
      <span>❤️ ${post.likes}</span>
      <span>💬 ${post.comment_count}</span>
      <span>👁️ ${post.views}</span>
      ${post.bookmarked ? '<span>⭐ 已收藏</span>' : ''}
    </div>
  `;
}

// Override selectSort to handle feed sort
const _originalSelectSort = selectSort;
selectSort = function(el) {
  const sort = el.dataset.sort;
  if (sort === 'feed') {
    document.querySelectorAll('.sort-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    loadFollowingFeed();
    return;
  }
  _originalSelectSort(el);
};

// Start heartbeat on login
const _originalDoLogin = doLogin;
doLogin = async function() {
  await _originalDoLogin();
  if (currentUser) startHeartbeat();
};

// Start heartbeat if already logged in
if (currentUser) startHeartbeat();

// ==================== Phase 8 Features ====================

// Back to top button
window.addEventListener('scroll', () => {
  const btn = document.getElementById('backToTop');
  if (window.scrollY > 300) btn.classList.add('show');
  else btn.classList.remove('show');
});

// Reading progress bar
window.addEventListener('scroll', () => {
  const progressBar = document.getElementById('readingProgress');
  if (currentView !== 'detail') {
    progressBar.style.width = '0%';
    return;
  }

  const winHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
  const scrolled = window.scrollY;
  const progress = (scrolled / winHeight) * 100;
  progressBar.style.width = `${Math.min(progress, 100)}%`;
});

// Image lazy loading
function setupLazyLoading() {
  const images = document.querySelectorAll('img[data-src]');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        img.src = img.dataset.src;
        img.classList.add('loaded');
        observer.unobserve(img);
      }
    });
  });
  images.forEach(img => observer.observe(img));
}

// Multi-image upload
let uploadedImages = [];

function setupMultiImageUpload() {
  const uploadArea = document.getElementById('imageUploadArea');
  const fileInput = document.getElementById('multiImageInput');
  if (!uploadArea || !fileInput) return;

  uploadArea.addEventListener('click', () => fileInput.click());

  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = 'var(--primary)';
  });

  uploadArea.addEventListener('dragleave', () => {
    uploadArea.style.borderColor = 'var(--border)';
  });

  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = 'var(--border)';
    handleImageFiles(e.dataTransfer.files);
  });

  fileInput.addEventListener('change', (e) => {
    handleImageFiles(e.target.files);
  });
}

async function handleImageFiles(files) {
  if (uploadedImages.length + files.length > 9) {
    showToast('最多上传9张图片');
    return;
  }

  const formData = new FormData();
  for (const file of files) {
    if (file.size > 5 * 1024 * 1024) {
      showToast('图片大小不能超过5MB');
      return;
    }
    formData.append('images', file);
  }

  try {
    const res = await fetch('/api/upload/multiple', {
      method: 'POST',
      headers: { 'X-User-Id': currentUser.id },
      body: formData
    });
    const data = await res.json();

    if (data.urls) {
      uploadedImages = [...uploadedImages, ...data.urls];
      updateImagePreview();

      // Auto-insert into content
      const contentInput = document.getElementById('postContent');
      if (contentInput) {
        const markdownImages = data.urls.map(url => `![图片](${url})`).join('\n');
        contentInput.value += '\n' + markdownImages;
      }
    }
  } catch (e) {
    showToast('上传失败');
  }
}

function updateImagePreview() {
  const preview = document.getElementById('imagePreviewGrid');
  if (!preview) return;

  preview.innerHTML = uploadedImages.map((url, i) => `
    <div class="image-preview-item">
      <img src="${url}" alt="预览">
      <button class="image-preview-remove" onclick="removeImage(${i})">×</button>
    </div>
  `).join('');
}

function removeImage(index) {
  uploadedImages.splice(index, 1);
  updateImagePreview();
}

// Video embedding
function parseVideoEmbeds(content) {
  // Bilibili
  content = content.replace(/\[bilibili\](https?:\/\/www\.bilibili\.com\/video\/([a-zA-Z0-9]+))[^\[]*\[\/bilibili\]/g,
    '<div class="video-embed"><iframe src="//player.bilibili.com/player.html?bvid=$2" scrolling="no" frameborder="0" allowfullscreen="true"></iframe></div>');

  // YouTube
  content = content.replace(/\[youtube\](https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]+))[^\[]*\[\/youtube\]/g,
    '<div class="video-embed"><iframe src="https://www.youtube.com/embed/$2" frameborder="0" allowfullscreen></iframe></div>');

  // YouTube short URLs
  content = content.replace(/\[youtube\](https?:\/\/youtu\.be\/([a-zA-Z0-9_-]+))[^\[]*\[\/youtube\]/g,
    '<div class="video-embed"><iframe src="https://www.youtube.com/embed/$2" frameborder="0" allowfullscreen></iframe></div>');

  return content;
}

// Post edit history with diff comparison
async function showPostHistory(postId) {
  const history = await api(`/api/posts/${postId}/history`);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.id = 'historyModal';

  if (history.length === 0) {
    overlay.innerHTML = `
      <div class="modal" style="max-width:500px;">
        <div class="modal-header">
          <div class="modal-title">📝 编辑历史</div>
          <button class="modal-close" onclick="document.getElementById('historyModal').remove()">×</button>
        </div>
        <div class="modal-body">
          <p style="text-align:center;color:var(--text-secondary);">暂无编辑历史</p>
        </div>
      </div>
    `;
  } else {
    overlay.innerHTML = `
      <div class="modal" style="max-width:800px;max-height:85vh;">
        <div class="modal-header">
          <div class="modal-title">📝 编辑历史 (${history.length}个版本)</div>
          <button class="modal-close" onclick="document.getElementById('historyModal').remove()">×</button>
        </div>
        <div class="modal-body" style="overflow-y:auto;">
          <div style="margin-bottom:12px;">
            ${history.map((h, i) => `
              <div class="history-item" style="cursor:pointer;" onclick="showHistoryDiff(${i}, ${postId})">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <span>${escapeHtml(h.username)}</span>
                  <span class="time">${formatTime(h.edited_at)}</span>
                </div>
                <div class="changes">
                  <strong>${escapeHtml(h.title)}</strong>
                  <div style="margin-top:4px;font-size:12px;color:var(--text-secondary);max-height:60px;overflow:hidden;">${escapeHtml(h.content).substring(0, 150)}...</div>
                </div>
                ${i < history.length - 1 ? `<div style="margin-top:6px;"><button class="btn btn-sm btn-outline" onclick="event.stopPropagation();showHistoryDiff(${i+1}, ${postId})">与上一版本对比</button></div>` : ''}
              </div>
            `).join('')}
          </div>
          <div id="diffContainer"></div>
        </div>
      </div>
    `;

    // Store history data for diff
    window._historyData = history;
  }

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

function showHistoryDiff(newIndex, postId) {
  const history = window._historyData;
  if (!history || newIndex >= history.length - 1) return;

  const newer = history[newIndex];
  const older = history[newIndex + 1];

  const titleDiff = computeDiff(older.title, newer.title);
  const contentDiff = computeDiff(older.content, newer.content);

  const container = document.getElementById('diffContainer');
  if (!container) return;

  container.innerHTML = `
    <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:12px;">
      <h4 style="margin-bottom:12px;">版本对比</h4>
      <div style="display:flex;gap:8px;margin-bottom:12px;font-size:12px;color:var(--text-secondary);">
        <span>旧版本: ${formatTime(older.edited_at)} (${escapeHtml(older.username)})</span>
        <span>→</span>
        <span>新版本: ${formatTime(newer.edited_at)} (${escapeHtml(newer.username)})</span>
      </div>
      <div class="diff-view">
        <div class="diff-panel">
          <div class="diff-title">📝 标题变更</div>
          ${titleDiff}
        </div>
        <div class="diff-panel">
          <div class="diff-title">📄 内容变更</div>
          ${contentDiff}
        </div>
      </div>
    </div>
  `;

  container.scrollIntoView({ behavior: 'smooth' });
}

function computeDiff(oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const maxLen = Math.max(oldLines.length, newLines.length);

  let html = '';
  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : '';
    const newLine = i < newLines.length ? newLines[i] : '';

    if (oldLine === newLine) {
      html += `<div class="diff-line">${escapeHtml(newLine) || '&nbsp;'}</div>`;
    } else {
      if (oldLine) html += `<div class="diff-line diff-remove">- ${escapeHtml(oldLine)}</div>`;
      if (newLine) html += `<div class="diff-line diff-add">+ ${escapeHtml(newLine)}</div>`;
    }
  }

  return html || '<div style="color:var(--text-secondary);text-align:center;">无变更</div>';
}

// Scheduled posts
async function showScheduledPosts() {
  if (!currentUser) return;

  const scheduled = await api('/api/scheduled');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.id = 'scheduledModal';

  if (scheduled.length === 0) {
    overlay.innerHTML = `
      <div class="modal" style="max-width:400px;">
        <div class="modal-header">
          <div class="modal-title">⏰ 定时发布</div>
          <button class="modal-close" onclick="document.getElementById('scheduledModal').remove()">×</button>
        </div>
        <div class="modal-body">
          <p style="text-align:center;color:var(--text-secondary);">没有待发布的帖子</p>
        </div>
      </div>
    `;
  } else {
    overlay.innerHTML = `
      <div class="modal" style="max-width:500px;">
        <div class="modal-header">
          <div class="modal-title">⏰ 定时发布</div>
          <button class="modal-close" onclick="document.getElementById('scheduledModal').remove()">×</button>
        </div>
        <div class="modal-body">
          ${scheduled.map(s => `
            <div class="collection-card" style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div class="collection-name">${escapeHtml(s.title)}</div>
                <div class="collection-meta">发布时间: ${new Date(s.scheduled_at).toLocaleString()}</div>
              </div>
              <button class="btn btn-sm btn-danger" onclick="deleteScheduledPost(${s.id})">取消</button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

async function deleteScheduledPost(id) {
  await api(`/api/scheduled/${id}`, { method: 'DELETE' });
  showToast('已取消定时发布');
  document.getElementById('scheduledModal').remove();
  showScheduledPosts();
}

function showScheduleModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.id = 'scheduleModal';
  overlay.innerHTML = `
    <div class="modal" style="max-width:400px;">
      <div class="modal-header">
        <div class="modal-title">⏰ 设置发布时间</div>
        <button class="modal-close" onclick="document.getElementById('scheduleModal').remove()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">发布时间</label>
          <input class="form-input" type="datetime-local" id="scheduleTime">
        </div>
        <button class="btn btn-primary" style="width:100%;" onclick="submitScheduledPost()">确认定时发布</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

async function submitScheduledPost() {
  const title = document.getElementById('postTitle')?.value;
  const content = document.getElementById('postContent')?.value;
  const category = document.getElementById('postCategory')?.value;
  const scheduledAt = document.getElementById('scheduleTime')?.value;

  if (!title || !content || !scheduledAt) {
    showToast('请填写完整信息');
    return;
  }

  await api('/api/scheduled', {
    method: 'POST',
    body: JSON.stringify({ title, content, category, tags: postTags, scheduled_at: scheduledAt })
  });

  showToast('定时发布设置成功');
  document.getElementById('scheduleModal').remove();
  closeModal('postModal');
}

// Group chat
let currentGroupId = null;

async function showGroupChatList() {
  if (!currentUser) return;

  const groups = await api('/api/groups');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.id = 'groupListModal';

  overlay.innerHTML = `
    <div class="modal" style="max-width:400px;">
      <div class="modal-header">
        <div class="modal-title">👥 群聊</div>
        <button class="modal-close" onclick="document.getElementById('groupListModal').remove()">×</button>
      </div>
      <div class="modal-body">
        <button class="btn btn-primary" style="width:100%;margin-bottom:12px;" onclick="showCreateGroupModal()">创建群聊</button>
        ${groups.length === 0 ? '<p style="text-align:center;color:var(--text-secondary);">还没有加入任何群聊</p>' : ''}
        ${groups.map(g => `
          <div class="collection-card" style="cursor:pointer;" onclick="document.getElementById('groupListModal').remove();openGroupChat(${g.id}, '${escapeHtml(g.name)}')">
            <div class="collection-name">${escapeHtml(g.name)}</div>
            <div class="collection-meta">${g.member_count} 名成员${g.last_message ? ' · ' + escapeHtml(g.last_message).substring(0, 30) : ''}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

function showCreateGroupModal() {
  document.getElementById('groupListModal')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.id = 'createGroupModal';
  overlay.innerHTML = `
    <div class="modal" style="max-width:400px;">
      <div class="modal-header">
        <div class="modal-title">创建群聊</div>
        <button class="modal-close" onclick="document.getElementById('createGroupModal').remove()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">群名称</label>
          <input class="form-input" id="groupName" placeholder="输入群名称">
        </div>
        <button class="btn btn-primary" style="width:100%;" onclick="createGroup()">创建</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

async function createGroup() {
  const name = document.getElementById('groupName')?.value;
  if (!name) { showToast('请输入群名称'); return; }

  const res = await api('/api/groups', {
    method: 'POST',
    body: JSON.stringify({ name })
  });

  if (res.id) {
    showToast('群聊创建成功');
    document.getElementById('createGroupModal').remove();
    openGroupChat(res.id, name);
  }
}

async function openGroupChat(groupId, groupName) {
  currentGroupId = groupId;
  const chatWindow = document.getElementById('groupChatWindow');
  document.getElementById('groupChatName').textContent = groupName;
  chatWindow.classList.add('show');

  await loadGroupMessages(groupId);
}

function closeGroupChat() {
  document.getElementById('groupChatWindow').classList.remove('show');
  currentGroupId = null;
}

async function loadGroupMessages(groupId) {
  const messages = await api(`/api/groups/${groupId}/messages`);
  const container = document.getElementById('groupChatMessages');

  container.innerHTML = messages.map(m => `
    <div class="chat-message ${m.user_id === currentUser.id ? 'own' : ''}">
      <div class="meta">${escapeHtml(m.username)} · ${formatTime(m.created_at)}</div>
      <div class="content">${escapeHtml(m.content)}</div>
    </div>
  `).join('');

  container.scrollTop = container.scrollHeight;
}

async function sendGroupMessage() {
  if (!currentGroupId) return;

  const input = document.getElementById('groupChatInput');
  const content = input.value.trim();
  if (!content) return;

  await api(`/api/groups/${currentGroupId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content })
  });

  input.value = '';
  await loadGroupMessages(currentGroupId);
}

// Admin statistics dashboard
async function showAdminStats() {
  if (!currentUser || currentUser.id !== 1) return;

  const stats = await api('/api/admin/stats');

  document.getElementById('mainContent').innerHTML = `
    <button class="back-btn" onclick="goHome()">← 返回列表</button>
    <div class="post-detail">
      <h2 style="margin-bottom:20px;">📊 数据统计仪表盘</h2>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="number">${stats.totalUsers}</div>
          <div class="label">总用户数</div>
        </div>
        <div class="stat-card">
          <div class="number">${stats.totalPosts}</div>
          <div class="label">总帖子数</div>
        </div>
        <div class="stat-card">
          <div class="number">${stats.totalComments}</div>
          <div class="label">总评论数</div>
        </div>
        <div class="stat-card">
          <div class="number">${stats.totalViews}</div>
          <div class="label">总浏览量</div>
        </div>
        <div class="stat-card">
          <div class="number">${stats.activeUsers}</div>
          <div class="label">7日活跃用户</div>
        </div>
        <div class="stat-card">
          <div class="number">${stats.pendingReports}</div>
          <div class="label">待处理举报</div>
        </div>
        <div class="stat-card">
          <div class="number">${stats.bannedUsers}</div>
          <div class="label">封禁用户</div>
        </div>
      </div>

      <h3 style="margin-bottom:12px;">📈 今日数据</h3>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="number">${stats.todayUsers}</div>
          <div class="label">新用户</div>
        </div>
        <div class="stat-card">
          <div class="number">${stats.todayPosts}</div>
          <div class="label">新帖子</div>
        </div>
        <div class="stat-card">
          <div class="number">${stats.todayComments}</div>
          <div class="label">新评论</div>
        </div>
      </div>

      <h3 style="margin-bottom:12px;">📊 分类统计</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;">
        ${stats.categoryStats.map(c => `
          <span class="tag">${escapeHtml(c.category)}: ${c.count}</span>
        `).join('')}
      </div>

      <h3 style="margin-bottom:12px;">🔥 热门帖子</h3>
      ${stats.topPosts.map(p => `
        <div class="history-item" style="cursor:pointer;" onclick="showPostDetail(${p.id})">
          <div style="display:flex;justify-content:space-between;">
            <span>${escapeHtml(p.title)}</span>
            <span style="color:var(--text-secondary);">❤️${p.likes} 👁️${p.views}</span>
          </div>
        </div>
      `).join('')}

      <h3 style="margin:16px 0 12px;">👑 活跃用户</h3>
      ${stats.topUsers.map(u => `
        <div class="history-item" style="cursor:pointer;" onclick="showProfile(${u.id})">
          <div style="display:flex;align-items:center;gap:8px;">
            <span>${u.avatar}</span>
            <span>${escapeHtml(u.username)}</span>
            <span style="color:var(--text-secondary);margin-left:auto;">${u.post_count} 帖子</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  document.getElementById('categoryTabs').style.display = 'none';
  document.querySelector('.sort-tabs').style.display = 'none';
}

// User ban/mute
function showBanModal(userId, username) {
  if (!currentUser || currentUser.id !== 1) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.id = 'banModal';
  overlay.innerHTML = `
    <div class="modal" style="max-width:400px;">
      <div class="modal-header">
        <div class="modal-title">封禁用户: ${escapeHtml(username)}</div>
        <button class="modal-close" onclick="document.getElementById('banModal').remove()">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">封禁类型</label>
          <select class="form-input" id="banType">
            <option value="ban">封禁（无法登录）</option>
            <option value="mute">禁言（无法发帖评论）</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">封禁原因</label>
          <input class="form-input" id="banReason" placeholder="输入原因">
        </div>
        <div class="form-group">
          <label class="form-label">封禁时长</label>
          <select class="form-input" id="banDuration">
            <option value="24">24小时</option>
            <option value="72">3天</option>
            <option value="168">7天</option>
            <option value="720">30天</option>
            <option value="">永久</option>
          </select>
        </div>
        <button class="btn btn-danger" style="width:100%;" onclick="banUser(${userId})">确认封禁</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

async function banUser(userId) {
  const ban_type = document.getElementById('banType').value;
  const reason = document.getElementById('banReason').value;
  const duration_hours = document.getElementById('banDuration').value;

  await api(`/api/users/${userId}/ban`, {
    method: 'POST',
    body: JSON.stringify({ ban_type, reason, duration_hours: duration_hours ? parseInt(duration_hours) : null })
  });

  showToast('用户已封禁');
  document.getElementById('banModal').remove();
}

async function unbanUser(userId) {
  await api(`/api/users/${userId}/ban`, { method: 'DELETE' });
  showToast('已解除封禁');
}

// Batch operations
let selectedPosts = new Set();
let batchMode = false;

function toggleBatchMode() {
  batchMode = !batchMode;
  selectedPosts.clear();

  document.querySelectorAll('.post-card').forEach(card => {
    if (batchMode) {
      card.classList.add('selecting');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'batch-select';
      checkbox.onclick = (e) => {
        e.stopPropagation();
        const postId = card.onclick?.toString().match(/showPostDetail\((\d+)\)/)?.[1];
        if (postId) {
          if (checkbox.checked) selectedPosts.add(parseInt(postId));
          else selectedPosts.delete(parseInt(postId));
          updateBatchBar();
        }
      };
      card.prepend(checkbox);
    } else {
      card.classList.remove('selecting');
      card.querySelector('.batch-select')?.remove();
    }
  });

  updateBatchBar();
}

function updateBatchBar() {
  const bar = document.getElementById('batchBar');
  const count = document.getElementById('batchCount');
  count.textContent = `已选择 ${selectedPosts.size} 项`;

  if (batchMode && selectedPosts.size > 0) bar.classList.add('show');
  else bar.classList.remove('show');
}

function cancelBatch() {
  batchMode = false;
  selectedPosts.clear();
  document.querySelectorAll('.post-card').forEach(card => {
    card.classList.remove('selecting');
    card.querySelector('.batch-select')?.remove();
  });
  document.getElementById('batchBar').classList.remove('show');
}

async function batchDelete() {
  if (selectedPosts.size === 0) return;
  if (!confirm(`确定删除 ${selectedPosts.size} 个帖子？`)) return;

  await api('/api/admin/batch-delete', {
    method: 'POST',
    body: JSON.stringify({ post_ids: Array.from(selectedPosts) })
  });

  showToast(`已删除 ${selectedPosts.size} 个帖子`);
  cancelBatch();
  loadPosts();
}

async function batchPin(pin) {
  if (selectedPosts.size === 0) return;

  await api('/api/admin/batch-pin', {
    method: 'POST',
    body: JSON.stringify({ post_ids: Array.from(selectedPosts), pin })
  });

  showToast(`已${pin ? '置顶' : '取消置顶'} ${selectedPosts.size} 个帖子`);
  cancelBatch();
  loadPosts();
}

// WebSocket real-time notifications
let ws = null;

function connectWebSocket() {
  if (ws) return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    console.log('WebSocket connected');
    const token = localStorage.getItem('token');
    if (token) {
      ws.send(JSON.stringify({ type: 'auth', token }));
    }
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'notification') {
      showToast(data.message);
      loadNotifications();
    } else if (data.type === 'new_post' && currentView === 'list') {
      const banner = document.querySelector('.new-post-banner');
      if (banner) {
        banner.style.display = 'block';
        banner.textContent = '📢 有新帖子，点击刷新';
      }
    } else if (data.type === 'group_message' && currentGroupId === data.groupId) {
      loadGroupMessages(currentGroupId);
    }
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected');
    ws = null;
    // Reconnect after 3 seconds
    setTimeout(connectWebSocket, 3000);
  };
}

// Override updateHeader to add new menu items
const _originalUpdateHeader = updateHeader;
updateHeader = function() {
  _originalUpdateHeader();

  // Add settings button to header
  const headerActions = document.querySelector('.header-actions');
  if (headerActions && !headerActions.querySelector('.settings-btn')) {
    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'btn-icon settings-btn';
    settingsBtn.innerHTML = '⚙️';
    settingsBtn.title = '外观设置';
    settingsBtn.onclick = showSettingsPanel;
    headerActions.insertBefore(settingsBtn, headerActions.firstChild);
  }

  // Add new menu items after header is updated
  if (currentUser) {
    const dropdown = document.querySelector('.dropdown-menu');
    if (dropdown) {
      // Add group chat button
      const groupBtn = document.createElement('button');
      groupBtn.className = 'dropdown-item';
      groupBtn.innerHTML = '👥 群聊';
      groupBtn.onclick = showGroupChatList;

      // Add scheduled posts button
      const scheduledBtn = document.createElement('button');
      scheduledBtn.className = 'dropdown-item';
      scheduledBtn.innerHTML = '⏰ 定时发布';
      scheduledBtn.onclick = showScheduledPosts;

      // Insert before the logout button
      const logoutBtn = dropdown.querySelector('button:last-child');
      dropdown.insertBefore(scheduledBtn, logoutBtn);
      dropdown.insertBefore(groupBtn, logoutBtn);

      // Add admin stats for admin
      if (currentUser.id === 1) {
        const adminBtn = document.createElement('button');
        adminBtn.className = 'dropdown-item';
        adminBtn.innerHTML = '📊 数据统计';
        adminBtn.onclick = showAdminStats;
        dropdown.insertBefore(adminBtn, logoutBtn);

        // Add batch mode button
        const batchBtn = document.createElement('button');
        batchBtn.className = 'dropdown-item';
        batchBtn.innerHTML = '📋 批量管理';
        batchBtn.onclick = toggleBatchMode;
        dropdown.insertBefore(batchBtn, logoutBtn);
      }
    }
  }
};

// Connect WebSocket on page load
connectWebSocket();

// ==================== Phase 9: UX Enhancement Features ====================

// Search suggestions
let searchSuggestionTimer = null;
let searchHistory = JSON.parse(localStorage.getItem('searchHistory') || '[]');

function initSearchSuggestions() {
  const searchInput = document.querySelector('.search-box input');
  if (!searchInput) return;

  // Create suggestions dropdown
  let suggestionsEl = document.querySelector('.search-suggestions');
  if (!suggestionsEl) {
    suggestionsEl = document.createElement('div');
    suggestionsEl.className = 'search-suggestions';
    searchInput.parentElement.appendChild(suggestionsEl);
  }

  searchInput.addEventListener('input', () => {
    clearTimeout(searchSuggestionTimer);
    const query = searchInput.value.trim();

    if (!query) {
      showSearchHistory(suggestionsEl, searchInput);
      return;
    }

    searchSuggestionTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/suggestions?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        showSearchSuggestions(data.suggestions, suggestionsEl, searchInput, query);
      } catch (e) {
        console.error('Search suggestions error:', e);
      }
    }, 200);
  });

  searchInput.addEventListener('focus', () => {
    if (!searchInput.value.trim()) {
      showSearchHistory(suggestionsEl, searchInput);
    }
  });

  document.addEventListener('click', (e) => {
    if (!searchInput.parentElement.contains(e.target)) {
      suggestionsEl.classList.remove('show');
    }
  });
}

function showSearchSuggestions(suggestions, el, input, query) {
  if (!suggestions.length) {
    el.classList.remove('show');
    return;
  }

  el.innerHTML = suggestions.map(s => {
    const icon = s.type === 'post' ? '📄' : s.type === 'tag' ? '🏷️' : '👤';
    const highlighted = s.text.replace(new RegExp(`(${escapeRegex(query)})`, 'gi'), '<mark>$1</mark>');
    return `<div class="search-suggestion-item" data-text="${escapeHtml(s.text)}" data-type="${s.type}">
      <span class="icon">${icon}</span>
      <span class="text">${highlighted}</span>
    </div>`;
  }).join('');

  el.querySelectorAll('.search-suggestion-item').forEach(item => {
    item.addEventListener('click', () => {
      const text = item.dataset.text;
      const type = item.dataset.type;
      input.value = text;
      el.classList.remove('show');
      addToSearchHistory(text);
      if (type === 'tag') {
        currentTag = text;
        goHome();
      } else {
        searchQuery = text;
        goHome();
      }
    });
  });

  el.classList.add('show');
}

function showSearchHistory(el, input) {
  if (!searchHistory.length) {
    el.classList.remove('show');
    return;
  }

  el.innerHTML = `
    <div class="search-history-header">
      <span>搜索历史</span>
      <span class="clear-all" onclick="clearSearchHistory(event)">清空</span>
    </div>
    ${searchHistory.slice(0, 8).map(text =>
      `<div class="search-suggestion-item" data-text="${escapeHtml(text)}">
        <span class="icon">🕐</span>
        <span class="text">${escapeHtml(text)}</span>
        <span class="remove" onclick="removeFromSearchHistory(event, '${escapeHtml(text)}')">✕</span>
      </div>`
    ).join('')}
  `;

  el.querySelectorAll('.search-suggestion-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('remove')) return;
      const text = item.dataset.text;
      input.value = text;
      el.classList.remove('show');
      addToSearchHistory(text);
      searchQuery = text;
      goHome();
    });
  });

  el.classList.add('show');
}

function addToSearchHistory(text) {
  searchHistory = searchHistory.filter(h => h !== text);
  searchHistory.unshift(text);
  if (searchHistory.length > 20) searchHistory = searchHistory.slice(0, 20);
  localStorage.setItem('searchHistory', JSON.stringify(searchHistory));
}

function removeFromSearchHistory(e, text) {
  e.stopPropagation();
  searchHistory = searchHistory.filter(h => h !== text);
  localStorage.setItem('searchHistory', JSON.stringify(searchHistory));
  const suggestionsEl = document.querySelector('.search-suggestions');
  const searchInput = document.querySelector('.search-box input');
  if (suggestionsEl && searchInput) showSearchHistory(suggestionsEl, searchInput);
}

function clearSearchHistory(e) {
  e.stopPropagation();
  searchHistory = [];
  localStorage.removeItem('searchHistory');
  const suggestionsEl = document.querySelector('.search-suggestions');
  if (suggestionsEl) suggestionsEl.classList.remove('show');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Keyword highlighting in search results
function highlightKeywords(text, query) {
  if (!query) return text;
  const escaped = escapeRegex(query);
  return text.replace(new RegExp(`(${escaped})`, 'gi'), '<span class="highlight-keyword">$1</span>');
}

// Share modal
function showShareModal(postId, postTitle) {
  const url = window.location.origin + '?post=' + postId;
  const shareHtml = `
    <div class="modal-overlay" onclick="this.remove()">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 class="modal-title">分享帖子</h3>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
        </div>
        <div class="modal-body">
          <div class="share-options">
            <div class="share-option" onclick="copyShareLink('${url}')">
              <div class="icon" style="background:#E8F5E9;">🔗</div>
              <span class="label">复制链接</span>
            </div>
            <div class="share-option" onclick="shareToWeChat('${url}', '${escapeHtml(postTitle)}')">
              <div class="icon" style="background:#E8F5E9;">💬</div>
              <span class="label">微信</span>
            </div>
            <div class="share-option" onclick="shareToWeibo('${url}', '${escapeHtml(postTitle)}')">
              <div class="icon" style="background:#FFF3E0;">📢</div>
              <span class="label">微博</span>
            </div>
            <div class="share-option" onclick="shareToQQ('${url}', '${escapeHtml(postTitle)}')">
              <div class="icon" style="background:#E3F2FD;">💭</div>
              <span class="label">QQ</span>
            </div>
          </div>
          <div class="share-link-box">
            <input type="text" value="${url}" readonly id="share-link-input">
            <button class="btn btn-primary btn-sm" onclick="copyShareLink('${url}')">复制</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', shareHtml);
}

function copyShareLink(url) {
  navigator.clipboard.writeText(url).then(() => {
    showToast('链接已复制');
  }).catch(() => {
    const input = document.getElementById('share-link-input');
    if (input) { input.select(); document.execCommand('copy'); }
    showToast('链接已复制');
  });
}

function shareToWeChat(url, title) {
  showToast('请复制链接后在微信中分享');
  copyShareLink(url);
}

function shareToWeibo(url, title) {
  const weiboUrl = `https://service.weibo.com/share/share.php?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`;
  window.open(weiboUrl, '_blank', 'width=600,height=400');
}

function shareToQQ(url, title) {
  const qqUrl = `https://connect.qq.com/widget/shareqq/index.html?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`;
  window.open(qqUrl, '_blank', 'width=600,height=400');
}

// Export post as Markdown
async function exportPost(postId) {
  try {
    const post = await api(`/api/posts/${postId}`);
    const comments = await api(`/api/posts/${postId}/comments`);

    let md = `# ${post.title}\n\n`;
    md += `**作者:** ${post.username} | **分类:** ${post.category} | **发布时间:** ${formatTime(post.created_at)}\n\n`;
    if (post.tags && post.tags.length > 0) {
      md += `**标签:** ${post.tags.join(', ')}\n\n`;
    }
    md += `---\n\n`;
    md += `${post.content}\n\n`;

    if (comments.length > 0) {
      md += `---\n\n## 评论 (${comments.length})\n\n`;
      comments.forEach(c => {
        md += `**${c.username}** (${formatTime(c.created_at)}):\n${c.content}\n\n`;
      });
    }

    md += `\n---\n*导出自王业社区*\n`;

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${post.title.replace(/[/\\?%*:|"<>]/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);

    showToast('帖子已导出');
  } catch (e) {
    showToast('导出失败');
  }
}

// Theme settings
const themeColors = [
  { name: '橙色', primary: '#FF6B35', dark: '#E55A2B' },
  { name: '蓝色', primary: '#3B82F6', dark: '#2563EB' },
  { name: '绿色', primary: '#10B981', dark: '#059669' },
  { name: '紫色', primary: '#8B5CF6', dark: '#7C3AED' },
  { name: '粉色', primary: '#EC4899', dark: '#DB2777' },
  { name: '红色', primary: '#EF4444', dark: '#DC2626' },
  { name: '青色', primary: '#06B6D4', dark: '#0891B2' },
  { name: '黄色', primary: '#F59E0B', dark: '#D97706' }
];

function initThemeSettings() {
  const savedColor = localStorage.getItem('themeColor');
  if (savedColor) {
    const color = themeColors.find(c => c.primary === savedColor);
    if (color) applyThemeColor(color);
  }

  const savedFontSize = localStorage.getItem('fontSize');
  if (savedFontSize) {
    document.documentElement.style.setProperty('--font-size-base', savedFontSize + 'px');
  }

  // Check dark mode schedule
  checkDarkModeSchedule();
}

function applyThemeColor(color) {
  document.documentElement.style.setProperty('--primary', color.primary);
  document.documentElement.style.setProperty('--primary-dark', color.dark);
  document.documentElement.style.setProperty('--primary-light', color.primary + '1A');
  localStorage.setItem('themeColor', color.primary);
}

// Unified settings page
function showSettingsPage(tab = 'profile') {
  if (!currentUser) return;
  selectedAvatar = currentUser.avatar;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const currentFontSize = parseInt(localStorage.getItem('fontSize') || '16');
  const autoDarkMode = localStorage.getItem('autoDarkMode') === 'true';
  const savedColor = localStorage.getItem('themeColor') || '#FF6B35';
  const avatars = ['🧑‍💻', '👩‍🎨', '👨‍🏫', '🎮', '📚', '🌟', '🎯', '🚀', '💡', '🎨', '🦊', '🐱', '🐶', '🐼', '🐨', '🦄', '🐸', '🦋', '🐙', '🎃', '🤖', '👾', '🎪', '🎭', '🌍', '⚡', '🔮', '🎸', '🏆', '💎', '🔥', '🌊'];

  const tabs = [
    { key: 'profile', label: '👤 个人资料' },
    { key: 'security', label: '🔒 账号安全' },
    { key: 'appearance', label: '🎨 外观设置' },
  ];

  const html = `
    <div class="modal-overlay" id="settingsPageOverlay" onclick="if(event.target===this)this.remove()">
      <div class="modal" style="max-width:560px;" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 class="modal-title">设置</h3>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
        </div>
        <div class="modal-body" style="padding:0;">
          <div style="display:flex;border-bottom:1px solid var(--border);">
            ${tabs.map(t => `<button class="settings-tab ${tab === t.key ? 'active' : ''}" onclick="switchSettingsTab('${t.key}')" style="flex:1;padding:12px 8px;border:none;background:none;cursor:pointer;font-size:13px;color:${tab === t.key ? 'var(--primary)' : 'var(--text-secondary)'};border-bottom:2px solid ${tab === t.key ? 'var(--primary)' : 'transparent'};font-weight:${tab === t.key ? '600' : '400'};">${t.label}</button>`).join('')}
          </div>
          <div style="padding:20px;">
            <!-- Profile Tab -->
            <div id="settingsTab_profile" style="display:${tab === 'profile' ? 'block' : 'none'};">
              <div class="form-group"><label class="form-label">选择头像</label>
                <div class="avatar-grid">${avatars.map(a => `<div class="avatar-option ${a === selectedAvatar ? 'selected' : ''}" onclick="selectAvatar(this, '${a}')">${a}</div>`).join('')}</div>
              </div>
              <div class="form-group"><label class="form-label">个人简介</label><textarea class="form-textarea" id="settingsBio" placeholder="介绍一下自己..." rows="3">${escapeHtml(currentUser.bio || '')}</textarea></div>
              <button class="btn btn-primary" style="width:100%;" onclick="saveSettingsProfile()">保存资料</button>
            </div>
            <!-- Security Tab -->
            <div id="settingsTab_security" style="display:${tab === 'security' ? 'block' : 'none'};">
              <h4 style="margin-bottom:14px;font-size:15px;">修改密码</h4>
              <div class="form-group"><label class="form-label">原密码</label><input class="form-input" type="password" id="settingsOldPwd" placeholder="请输入原密码"></div>
              <div class="form-group"><label class="form-label">新密码</label><input class="form-input" type="password" id="settingsNewPwd" placeholder="至少6个字符"></div>
              <div class="form-group"><label class="form-label">确认新密码</label><input class="form-input" type="password" id="settingsConfirmPwd" placeholder="再次输入新密码"></div>
              <div class="error-msg" id="settingsPwdError"></div>
              <button class="btn btn-primary" style="width:100%;margin-bottom:24px;" onclick="saveSettingsPassword()">修改密码</button>
              <h4 style="margin-bottom:14px;font-size:15px;border-top:1px solid var(--border);padding-top:20px;">安全问题</h4>
              <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">设置安全问题后可通过答案重置密码</p>
              <div class="form-group"><label class="form-label">安全问题</label>
                <select class="form-select" id="settingsSecQ">
                  <option value="">不设置</option>
                  <option value="你的第一只宠物叫什么名字？">你的第一只宠物叫什么名字？</option>
                  <option value="你的出生城市是？">你的出生城市是？</option>
                  <option value="你的小学校名是？">你的小学校名是？</option>
                  <option value="你最喜欢的食物是？">你最喜欢的食物是？</option>
                </select>
              </div>
              <div class="form-group"><label class="form-label">答案</label><input class="form-input" type="text" id="settingsSecA" placeholder="请输入答案"></div>
              <button class="btn btn-outline" style="width:100%;margin-bottom:24px;" onclick="saveSecurityQuestion()">保存安全问题</button>
              <h4 style="margin-bottom:14px;font-size:15px;border-top:1px solid var(--border);padding-top:20px;color:var(--danger);">危险操作</h4>
              <button class="btn btn-danger" style="width:100%;" onclick="confirmDeleteAccount()">注销账号</button>
            </div>
            <!-- Appearance Tab -->
            <div id="settingsTab_appearance" style="display:${tab === 'appearance' ? 'block' : 'none'};">
              <div style="margin-bottom:20px;">
                <div style="font-weight:500;margin-bottom:10px;">主题颜色</div>
                <div class="theme-colors">
                  ${themeColors.map(c => `
                    <div class="theme-color ${c.primary === savedColor ? 'active' : ''}" style="background:${c.primary};" title="${c.name}"
                      onclick="applyThemeColor({primary:'${c.primary}',dark:'${c.dark}'});this.parentElement.querySelectorAll('.theme-color').forEach(el=>el.classList.remove('active'));this.classList.add('active');"></div>
                  `).join('')}
                </div>
              </div>
              <div style="margin-bottom:20px;">
                <div style="font-weight:500;margin-bottom:10px;">字体大小</div>
                <div class="font-size-control">
                  <button onclick="adjustFontSize(-1)">A-</button>
                  <span class="size" id="font-size-display">${currentFontSize}px</span>
                  <button onclick="adjustFontSize(1)">A+</button>
                </div>
              </div>
              <div style="margin-bottom:20px;">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                  <span style="font-weight:500;">深色模式</span>
                  <label style="position:relative;display:inline-block;width:48px;height:26px;">
                    <input type="checkbox" ${isDark ? 'checked' : ''} onchange="toggleDarkMode();updateThemeButton();" style="opacity:0;width:0;height:0;">
                    <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:${isDark ? 'var(--primary)' : '#ccc'};border-radius:26px;transition:0.3s;">
                      <span style="position:absolute;content:'';height:20px;width:20px;left:${isDark ? '24px' : '3px'};bottom:3px;background:white;border-radius:50%;transition:0.3s;"></span>
                    </span>
                  </label>
                </div>
              </div>
              <div style="margin-bottom:16px;">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                  <div>
                    <div style="font-weight:500;">自动切换深色模式</div>
                    <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">18:00-6:00自动开启</div>
                  </div>
                  <label style="position:relative;display:inline-block;width:48px;height:26px;">
                    <input type="checkbox" ${autoDarkMode ? 'checked' : ''} onchange="toggleAutoDarkMode(this.checked)" style="opacity:0;width:0;height:0;">
                    <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:${autoDarkMode ? 'var(--primary)' : '#ccc'};border-radius:26px;transition:0.3s;">
                      <span style="position:absolute;content:'';height:20px;width:20px;left:${autoDarkMode ? '24px' : '3px'};bottom:3px;background:white;border-radius:50%;transition:0.3s;"></span>
                    </span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
}

function switchSettingsTab(tab) {
  document.querySelectorAll('[id^="settingsTab_"]').forEach(el => el.style.display = 'none');
  document.getElementById(`settingsTab_${tab}`).style.display = 'block';
  // Update tab button styles
  const overlay = document.getElementById('settingsPageOverlay');
  overlay.querySelectorAll('.settings-tab').forEach(btn => {
    btn.style.color = btn.textContent.includes({profile:'个人资料',security:'账号安全',appearance:'外观设置'}[tab]) ? 'var(--primary)' : 'var(--text-secondary)';
    btn.style.borderBottomColor = btn.textContent.includes({profile:'个人资料',security:'账号安全',appearance:'外观设置'}[tab]) ? 'var(--primary)' : 'transparent';
    btn.style.fontWeight = btn.textContent.includes({profile:'个人资料',security:'账号安全',appearance:'外观设置'}[tab]) ? '600' : '400';
  });
}

async function saveSettingsProfile() {
  const bio = document.getElementById('settingsBio').value.trim();
  const res = await api(`/api/users/${currentUser.id}`, { method: 'PUT', body: JSON.stringify({ bio, avatar: selectedAvatar }) });
  if (res.error) { showToast(res.error); return; }
  currentUser = { ...currentUser, ...res };
  localStorage.setItem('currentUser', JSON.stringify(currentUser));
  updateHeader();
  showToast('资料已更新');
}

async function saveSettingsPassword() {
  const oldPwd = document.getElementById('settingsOldPwd').value;
  const newPwd = document.getElementById('settingsNewPwd').value;
  const confirmPwd = document.getElementById('settingsConfirmPwd').value;
  const errEl = document.getElementById('settingsPwdError');
  if (!oldPwd || !newPwd) { errEl.textContent = '请填写完整'; errEl.style.display = 'block'; return; }
  if (newPwd !== confirmPwd) { errEl.textContent = '两次密码不一致'; errEl.style.display = 'block'; return; }
  if (newPwd.length < 6) { errEl.textContent = '新密码至少6个字符'; errEl.style.display = 'block'; return; }
  const res = await api(`/api/users/${currentUser.id}/password`, { method: 'PUT', body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }) });
  if (res.error) { errEl.textContent = res.error; errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';
  showToast('密码已修改');
  document.getElementById('settingsOldPwd').value = '';
  document.getElementById('settingsNewPwd').value = '';
  document.getElementById('settingsConfirmPwd').value = '';
}

async function saveSecurityQuestion() {
  const question = document.getElementById('settingsSecQ').value;
  const answer = document.getElementById('settingsSecA').value.trim();
  if (!question) { showToast('请选择安全问题'); return; }
  if (!answer) { showToast('请输入答案'); return; }
  const res = await api(`/api/users/${currentUser.id}/security-question`, { method: 'PUT', body: JSON.stringify({ question, answer }) });
  if (res.error) { showToast(res.error); return; }
  showToast('安全问题已保存');
  document.getElementById('settingsSecA').value = '';
}

function confirmDeleteAccount() {
  showConfirm('注销账号', `确定要注销账号 "${currentUser.username}" 吗？此操作不可恢复，所有数据将被永久删除。`, () => {
    // Double confirm with username input
    const input = prompt('请输入你的用户名确认注销：');
    if (input !== currentUser.username) { showToast('用户名不匹配，取消注销'); return; }
    deleteAccount();
  });
}

async function deleteAccount() {
  const res = await api(`/api/users/${currentUser.id}`, { method: 'DELETE' });
  if (res.error) { showToast(res.error); return; }
  currentUser = null;
  localStorage.removeItem('currentUser');
  localStorage.removeItem('token');
  updateHeader();
  document.getElementById('settingsPageOverlay')?.remove();
  showToast('账号已注销');
  goHome();
}

function showSettingsPanel() {
  showSettingsPage('appearance');
}

function adjustFontSize(delta) {
  const current = parseInt(localStorage.getItem('fontSize') || '16');
  const newSize = Math.min(24, Math.max(12, current + delta));
  localStorage.setItem('fontSize', newSize);
  document.documentElement.style.setProperty('--font-size-base', newSize + 'px');
  const display = document.getElementById('font-size-display');
  if (display) display.textContent = newSize + 'px';
}

function toggleAutoDarkMode(enabled) {
  localStorage.setItem('autoDarkMode', enabled);
  if (enabled) {
    checkDarkModeSchedule();
    showToast('已开启自动切换');
  } else {
    showToast('已关闭自动切换');
  }
}

function checkDarkModeSchedule() {
  const autoDarkMode = localStorage.getItem('autoDarkMode');
  if (autoDarkMode !== 'true') return;

  const hour = new Date().getHours();
  const shouldBeDark = hour >= 18 || hour < 6;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  if (shouldBeDark !== isDark) {
    document.documentElement.setAttribute('data-theme', shouldBeDark ? 'dark' : 'light');
    localStorage.setItem('darkMode', shouldBeDark);
    updateThemeButton();
  }
}

// Check dark mode schedule every minute
setInterval(checkDarkModeSchedule, 60000);

// Accessibility improvements
function initAccessibility() {
  // Add ARIA labels to key elements
  const searchInput = document.querySelector('.search-box input');
  if (searchInput) {
    searchInput.setAttribute('aria-label', '搜索帖子');
    searchInput.setAttribute('role', 'searchbox');
  }

  // Add keyboard navigation for post cards
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.closest('input, textarea')) {
      e.preventDefault();
      const searchInput = document.querySelector('.search-box input');
      if (searchInput) searchInput.focus();
    }

    if (e.key === 'Escape') {
      const modal = document.querySelector('.modal-overlay');
      if (modal) modal.remove();
      const suggestions = document.querySelector('.search-suggestions');
      if (suggestions) suggestions.classList.remove('show');
    }
  });

  // Skip to content link
  const skipLink = document.createElement('a');
  skipLink.href = '#main-content';
  skipLink.textContent = '跳到内容';
  skipLink.style.cssText = 'position:absolute;top:-40px;left:0;background:var(--primary);color:white;padding:8px;z-index:1000;transition:top 0.3s;';
  skipLink.addEventListener('focus', () => skipLink.style.top = '0');
  skipLink.addEventListener('blur', () => skipLink.style.top = '-40px');
  document.body.prepend(skipLink);

  // Add main content landmark
  const mainContent = document.getElementById('main-content');
  if (mainContent) {
    mainContent.setAttribute('role', 'main');
    mainContent.setAttribute('aria-label', '主要内容');
  }
}

// Post templates
const defaultTemplates = [
  { name: '📝 技术分享', title: '技术分享：', content: '## 背景\n\n描述问题背景...\n\n## 解决方案\n\n具体方案...\n\n## 代码示例\n\n```javascript\n// 代码...\n```\n\n## 总结\n\n总结要点...' },
  { name: '💡 经验总结', title: '经验总结：', content: '## 前言\n\n...\n\n## 要点一\n\n...\n\n## 要点二\n\n...\n\n## 要点三\n\n...\n\n## 结语\n\n...' },
  { name: '❓ 求助提问', title: '求助：', content: '## 问题描述\n\n详细描述遇到的问题...\n\n## 已尝试的方法\n\n1. 方法一...\n2. 方法二...\n\n## 环境信息\n\n- 系统：\n- 版本：\n\n## 期望结果\n\n...' },
  { name: '📰 新闻资讯', title: '', content: '## 摘要\n\n一句话概括...\n\n## 详细内容\n\n...\n\n## 个人看法\n\n...\n\n## 相关链接\n\n- [链接1](url)' }
];

function getCustomTemplates() {
  try {
    return JSON.parse(localStorage.getItem('postTemplates') || '[]');
  } catch (e) {
    return [];
  }
}

function showTemplateMenu() {
  const customTemplates = getCustomTemplates();
  const allTemplates = [...defaultTemplates, ...customTemplates];

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.id = 'templateModal';
  overlay.innerHTML = `
    <div class="modal" style="max-width:400px;">
      <div class="modal-header">
        <div class="modal-title">📋 帖子模板</div>
        <button class="modal-close" onclick="document.getElementById('templateModal').remove()">×</button>
      </div>
      <div class="modal-body">
        <div style="margin-bottom:12px;">
          ${allTemplates.map((t, i) => `
            <div class="collection-card" style="cursor:pointer;margin-bottom:8px;" onclick="applyTemplate(${i})">
              <div class="collection-name">${escapeHtml(t.name)}</div>
              <div class="collection-desc">${escapeHtml(t.content.substring(0, 50))}...</div>
            </div>
          `).join('')}
        </div>
        <div style="border-top:1px solid var(--border);padding-top:12px;">
          <button class="btn btn-outline btn-sm" onclick="saveCurrentAsTemplate()">💾 保存当前为模板</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function applyTemplate(index) {
  const customTemplates = getCustomTemplates();
  const allTemplates = [...defaultTemplates, ...customTemplates];
  const template = allTemplates[index];

  if (!template) return;

  const titleEl = document.getElementById('postTitle');
  const contentEl = document.getElementById('postContent');

  if (titleEl) titleEl.value = template.title;
  if (contentEl) contentEl.value = template.content;

  document.getElementById('templateModal')?.remove();
  showToast('已应用模板');
}

function saveCurrentAsTemplate() {
  const titleEl = document.getElementById('postTitle');
  const contentEl = document.getElementById('postContent');

  if (!titleEl || !contentEl) return;

  const name = prompt('请输入模板名称：');
  if (!name || !name.trim()) return;

  const customTemplates = getCustomTemplates();
  customTemplates.push({
    name: name.trim(),
    title: titleEl.value,
    content: contentEl.value
  });

  localStorage.setItem('postTemplates', JSON.stringify(customTemplates));
  document.getElementById('templateModal')?.remove();
  showToast('模板已保存');
}

// Post stats trend chart
async function showPostStats(postId) {
  try {
    const stats = await api(`/api/posts/${postId}/stats`);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.id = 'statsModal';

    // Prepare chart data
    const viewData = stats.viewHistory.slice(-14); // Last 14 days
    const likeData = stats.likeHistory.slice(-14);

    const chartHtml = viewData.length > 0 ? generateChart(viewData.map(d => d.views), '浏览量') : '<p style="text-align:center;color:var(--text-secondary);">暂无数据</p>';

    overlay.innerHTML = `
      <div class="modal" style="max-width:500px;">
        <div class="modal-header">
          <div class="modal-title">📊 帖子统计</div>
          <button class="modal-close" onclick="document.getElementById('statsModal').remove()">×</button>
        </div>
        <div class="modal-body">
          <div class="stats-summary">
            <div class="stats-summary-item">
              <div class="stats-summary-value">${stats.totalViews}</div>
              <div class="stats-summary-label">总浏览量</div>
            </div>
            <div class="stats-summary-item">
              <div class="stats-summary-value">${stats.totalLikes}</div>
              <div class="stats-summary-label">总点赞数</div>
            </div>
          </div>
          <div class="stats-chart">
            <div style="font-weight:500;margin-bottom:8px;">📈 浏览趋势 (近14天)</div>
            ${chartHtml}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
  } catch (e) {
    showToast('加载统计失败');
  }
}

function generateChart(data, label) {
  if (!data.length) return '<p style="text-align:center;color:var(--text-secondary);">暂无数据</p>';

  const max = Math.max(...data, 1);
  const width = 460;
  const height = 180;
  const padding = 30;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  // Generate points
  const points = data.map((value, i) => {
    const x = padding + (i / (data.length - 1)) * chartWidth;
    const y = height - padding - (value / max) * chartHeight;
    return `${x},${y}`;
  });

  // Generate area path
  const areaPoints = [...points];
  areaPoints.push(`${padding + chartWidth},${height - padding}`);
  areaPoints.push(`${padding},${height - padding}`);

  // Generate grid lines
  let gridLines = '';
  for (let i = 0; i <= 4; i++) {
    const y = padding + (i / 4) * chartHeight;
    gridLines += `<line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}" class="chart-grid"/>`;
    const value = Math.round(max * (1 - i / 4));
    gridLines += `<text x="${padding - 5}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--text-secondary)">${value}</text>`;
  }

  return `
    <svg viewBox="0 0 ${width} ${height}">
      ${gridLines}
      <polygon points="${areaPoints.join(' ')}" class="chart-area"/>
      <polyline points="${points.join(' ')}" class="chart-line"/>
      ${data.map((value, i) => {
        const x = padding + (i / (data.length - 1)) * chartWidth;
        const y = height - padding - (value / max) * chartHeight;
        return `<circle cx="${x}" cy="${y}" r="3" fill="var(--primary)"/>`;
      }).join('')}
    </svg>
  `;
}

// Add share and export buttons to post actions
const _originalShowPostActions = typeof showPostActions === 'function' ? showPostActions : null;
if (_originalShowPostActions) {
  showPostActions = function(post) {
    _originalShowPostActions(post);
    const actionsEl = document.querySelector('.post-actions');
    if (actionsEl) {
      const shareBtn = document.createElement('button');
      shareBtn.className = 'btn btn-ghost btn-sm';
      shareBtn.innerHTML = '🔗 分享';
      shareBtn.onclick = () => showShareModal(post.id, post.title);
      actionsEl.appendChild(shareBtn);

      const exportBtn = document.createElement('button');
      exportBtn.className = 'btn btn-ghost btn-sm';
      exportBtn.innerHTML = '📥 导出';
      exportBtn.onclick = () => exportPost(post.id);
      actionsEl.appendChild(exportBtn);
    }
  };
}

// Enhance search with keyword highlighting
const _originalSearchForUX = typeof performSearch === 'function' ? performSearch : null;
if (_originalSearchForUX) {
  performSearch = function(query) {
    _originalSearchForUX(query);
    addToSearchHistory(query);
  };
}

// Initialize UX features
document.addEventListener('DOMContentLoaded', () => {
  initSearchSuggestions();
  initThemeSettings();
  initAccessibility();
});

// Add share and export buttons to post detail view
const _originalRenderPostDetailForUX = typeof renderPostDetail === 'function' ? renderPostDetail : null;
if (_originalRenderPostDetailForUX) {
  renderPostDetail = function(post) {
    _originalRenderPostDetailForUX(post);
    const actionsEl = document.querySelector('.post-detail-actions');
    if (actionsEl && !actionsEl.querySelector('.share-btn')) {
      const shareBtn = document.createElement('button');
      shareBtn.className = 'btn btn-ghost btn-sm share-btn';
      shareBtn.innerHTML = '🔗 分享';
      shareBtn.onclick = () => showShareModal(post.id, post.title);
      actionsEl.appendChild(shareBtn);

      const exportBtn = document.createElement('button');
      exportBtn.className = 'btn btn-ghost btn-sm export-btn';
      exportBtn.innerHTML = '📥 导出';
      exportBtn.onclick = () => exportPost(post.id);
      actionsEl.appendChild(exportBtn);

      const statsBtn = document.createElement('button');
      statsBtn.className = 'btn btn-ghost btn-sm stats-btn';
      statsBtn.innerHTML = '📊 统计';
      statsBtn.onclick = () => showPostStats(post.id);
      actionsEl.appendChild(statsBtn);
    }
  };
}
