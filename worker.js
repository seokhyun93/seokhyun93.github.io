const COOKIE_NAME = 'session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, in seconds
const PAGE_SIZE = 20;

let schemaReady = false;

async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, image_key TEXT NOT NULL, detail_link TEXT NOT NULL, link1_label TEXT, link1_url TEXT, link2_label TEXT, link2_url TEXT, link3_label TEXT, link3_url TEXT, clicks INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)'
  ).run();
  for (const col of ['youtube_url TEXT', 'instagram_url TEXT', 'threads_embed_html TEXT', 'category TEXT']) {
    try {
      await env.DB.prepare(`ALTER TABLE products ADD COLUMN ${col}`).run();
    } catch (e) {
      // column already exists
    }
  }
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)'
  ).run();
  schemaReady = true;
}

async function getSetting(env, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}

async function setSetting(env, key, value) {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(key, value).run();
}

function youtubeEmbedUrl(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

function htmlResponse(html, status = 200) {
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const match = header.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

async function hmac(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function createSessionToken(env) {
  const exp = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = String(exp);
  const sig = await hmac(env.ADMIN_PASSWORD, payload);
  return `${payload}.${sig}`;
}

async function isAuthed(request, env) {
  const token = getCookie(request, COOKIE_NAME);
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = await hmac(env.ADMIN_PASSWORD, payload);
  if (expected !== sig) return false;
  return Number(payload) > Date.now();
}

function normalizeRow(r) {
  const links = [];
  if (r.link1_label && r.link1_url) links.push({ label: r.link1_label, url: r.link1_url });
  if (r.link2_label && r.link2_url) links.push({ label: r.link2_label, url: r.link2_url });
  if (r.link3_label && r.link3_url) links.push({ label: r.link3_label, url: r.link3_url });
  return {
    id: r.id,
    title: r.title,
    image: /^https?:\/\//.test(r.image_key) ? r.image_key : `/images/${r.image_key}`,
    detailLink: r.detail_link,
    links,
    clicks: r.clicks,
    createdAt: r.created_at,
    youtubeUrl: r.youtube_url || null,
    youtubeEmbed: youtubeEmbedUrl(r.youtube_url),
    instagramUrl: r.instagram_url || null,
    threadsEmbedHtml: r.threads_embed_html || null,
    category: r.category || null,
  };
}

function baseStyle() {
  return `
    * { box-sizing: border-box; }
    body { margin:0; font-family:'Noto Sans KR',-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif; background:#fff; color:#141414; }
    a { color:inherit; }
    .wrap { max-width: 1000px; margin: 0 auto; padding: 48px 24px 80px; }
    h1 { font-size:16px; font-weight:700; margin:0 0 24px; }
    label { display:block; font-size:12px; color:#666; margin:16px 0 6px; }
    input[type=text], input[type=url], input[type=password], textarea {
      width:100%; padding:10px 12px; font-size:14px; border:1px solid #e5e5e5; border-radius:6px; font-family:inherit; outline:none;
    }
    textarea { resize:vertical; }
    input:focus, textarea:focus { border-color:#c9705a; }
    input[type=file] { margin-top:4px; font-size:13px; }
    select {
      width:100%; padding:10px 12px; font-size:14px; border:1px solid #e5e5e5; border-radius:6px; font-family:inherit; outline:none; background:#fff;
    }
    select:focus { border-color:#c9705a; }
    .hint { font-size:11.5px; color:#999; margin-top:4px; }
    button { margin-top:24px; padding:11px 20px; font-size:13px; font-weight:700; color:#fff; background:#141414; border:none; border-radius:6px; cursor:pointer; font-family:inherit; }
    button:disabled { background:#ccc; cursor:default; }
    button.secondary { background:none; color:#888; font-weight:400; padding:0; margin-top:0; text-decoration:underline; }
    .error { color:#c0392b; font-size:12.5px; margin-top:8px; }
    .success { background:#f3f8f4; color:#2e7d4f; font-size:12.5px; padding:10px 14px; border-radius:6px; margin-bottom:20px; }
    .nav { display:flex; align-items:center; gap:16px; margin-bottom:28px; font-size:12.5px; }
    .nav a { color:#666; text-decoration:none; }
    .nav a.active { color:#141414; font-weight:700; }
    table { width:100%; border-collapse:collapse; margin-top:16px; font-size:12.5px; }
    th, td { text-align:left; padding:8px 6px; border-bottom:1px solid #f0f0f0; }
    th { color:#999; font-weight:500; }
    .thumb { width:36px; height:36px; object-fit:cover; border-radius:4px; background:#fafafa; border:1px solid #f0f0f0; }
    .link-row { display:flex; gap:8px; }
    .link-row input { flex:1; }
    .link-label-fixed { flex:1; padding:10px 12px; font-size:14px; border:1px solid #eee; border-radius:6px; background:#fafafa; color:#666; }
    .image-mode { display:flex; gap:16px; margin-top:4px; }
    .radio-inline { display:flex !important; align-items:center; gap:5px; font-size:12.5px; color:#333; margin:0 !important; cursor:pointer; }
    .radio-inline input { width:auto; }
    .pager { display:flex; justify-content:center; align-items:center; gap:16px; margin-top:24px; font-size:12.5px; color:#666; }
    .pager-btn { font-family:inherit; font-size:12px; padding:6px 14px; border:1px solid #eee; background:#fff; border-radius:999px; color:#141414; text-decoration:none; display:inline-block; }
    .pager-btn.disabled { color:#ccc; border-color:#f5f5f5; }
  `;
}

function page(title, body, extraScript) {
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(title)}</title><style>${baseStyle()}</style></head><body>${body}${extraScript ? `<script>${extraScript}</script>` : ''}</body></html>`;
}

function loginPage(error) {
  return page('관리자 로그인', `
    <div class="wrap">
      <h1>관리자 로그인</h1>
      <form method="POST" action="/admin/login">
        <label>비밀번호</label>
        <input type="password" name="password" required autofocus>
        ${error ? '<div class="error">비밀번호가 올바르지 않습니다.</div>' : ''}
        <button type="submit">로그인</button>
      </form>
    </div>
  `);
}

function imageFormScript(imageRequired) {
  return `
    const form = document.querySelector('form.image-form');
    const fileInput = form.querySelector('input[name=image]');
    const urlInput = form.querySelector('input[name=image_url]');
    const modeRadios = form.querySelectorAll('input[name=image_mode]');
    const submitBtn = form.querySelector('button[type=submit]');

    function applyImageMode() {
      const mode = form.querySelector('input[name=image_mode]:checked').value;
      if (mode === 'file') {
        fileInput.style.display = '';
        urlInput.style.display = 'none';
        urlInput.value = '';
      } else {
        fileInput.style.display = 'none';
        fileInput.value = '';
        urlInput.style.display = '';
      }
    }
    modeRadios.forEach((r) => r.addEventListener('change', applyImageMode));
    applyImageMode();

    async function resizeImage(file, maxDim, quality) {
      const bitmap = await createImageBitmap(file);
      let width = bitmap.width, height = bitmap.height;
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
        else { width = Math.round(width * maxDim / height); height = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      return new File([blob], 'image.jpg', { type: 'image/jpeg' });
    }

    form.addEventListener('submit', async (e) => {
      const mode = form.querySelector('input[name=image_mode]:checked').value;
      if (mode === 'url') {
        if (${imageRequired ? 'true' : 'false'} && !urlInput.value.trim()) { e.preventDefault(); alert('이미지 URL을 입력해주세요.'); }
        return;
      }
      if (!fileInput.files[0]) {
        if (${imageRequired ? 'true' : 'false'}) { e.preventDefault(); alert('이미지를 선택해주세요.'); }
        return;
      }
      if (fileInput.dataset.resized === '1') return;
      e.preventDefault();
      submitBtn.disabled = true;
      submitBtn.textContent = '저장 중...';
      try {
        const resized = await resizeImage(fileInput.files[0], 800, 0.82);
        const dt = new DataTransfer();
        dt.items.add(resized);
        fileInput.files = dt.files;
      } catch (err) {}
      fileInput.dataset.resized = '1';
      form.submit();
    });
  `;
}

function imageModeFieldsHtml(urlMode) {
  return `
    <div class="image-mode">
      <label class="radio-inline"><input type="radio" name="image_mode" value="file" ${urlMode ? '' : 'checked'}> 파일 업로드</label>
      <label class="radio-inline"><input type="radio" name="image_mode" value="url" ${urlMode ? 'checked' : ''}> URL 입력</label>
    </div>
    <input type="file" name="image" accept="image/*">
    <input type="url" name="image_url" placeholder="https://..." style="${urlMode ? '' : 'display:none;'}" value="${urlMode ? esc(urlMode) : ''}">
  `;
}

function linkFieldsHtml(n, label, links) {
  const l = links[n - 1];
  const labelValue = `${label} 링크`;
  const urlValue = l ? l.url : '';
  return `
    <label>링크 ${n}</label>
    <div class="link-row">
      <div class="link-label-fixed">${esc(labelValue)}</div>
      <input type="hidden" name="link${n}_label" value="${esc(labelValue)}">
      <input type="url" name="link${n}_url" placeholder="https://... (없으면 비워두세요)" value="${esc(urlValue)}">
    </div>`;
}

function navHtml(active) {
  const tab = (href, text, key) => `<a href="${href}"${active === key ? ' class="active"' : ''}>${text}</a>`;
  return `
    <div class="nav">
      <a href="/">← 홈으로</a>
      ${tab('/admin', '업로드', 'upload')}
      ${tab('/admin/products', '최근 업로드', 'products')}
      ${tab('/admin/stats', '클릭 통계', 'stats')}
      ${tab('/admin/youtube/upload', '영상 업로드', 'youtube')}
      ${tab('/admin/instagram/upload', '인스타 업로드', 'instagram')}
      <form method="POST" action="/admin/logout" style="margin-left:auto;">
        <button type="submit" class="secondary">로그아웃</button>
      </form>
    </div>`;
}

function adminPage(successParam, youtubeConnected, justConnectedYoutube, instagramConnected, justConnectedInstagram) {
  const youtubeStatus = youtubeConnected
    ? '<span style="color:#2e7d4f;">✓ 연동됨</span>'
    : '<a href="/admin/youtube/connect">연동하기</a>';
  const instagramStatus = instagramConnected
    ? '<span style="color:#2e7d4f;">✓ 연동됨</span>'
    : '<a href="/admin/instagram/connect">연동하기</a>';
  return page('상품 업로드', `
    <div class="wrap">
      ${navHtml('upload')}
      ${justConnectedYoutube ? '<div class="success">유튜브 계정이 연동되었습니다.</div>' : ''}
      ${justConnectedInstagram ? '<div class="success">인스타그램 계정이 연동되었습니다.</div>' : ''}
      <div style="display:flex;align-items:center;gap:16px;font-size:12.5px;color:#666;margin-bottom:28px;flex-wrap:wrap;">
        <span><strong style="color:#141414;">유튜브</strong> ${youtubeStatus}</span>
        <span><strong style="color:#141414;">인스타그램</strong> ${instagramStatus}</span>
      </div>
      <h1>새 상품 업로드</h1>
      ${successParam === '1' ? '<div class="success">업로드되었습니다.</div>' : ''}
      ${successParam === 'missing' ? '<div class="error" style="margin-bottom:16px;">제목, 이미지, 상세페이지 링크는 필수입니다.</div>' : ''}
      <form class="image-form" method="POST" action="/admin/upload" enctype="multipart/form-data">
        <label>대표 이미지</label>
        ${imageModeFieldsHtml(null)}

        <label>상품명</label>
        <input type="text" name="title" required>

        <label>상세페이지 링크 (내 블로그 글 주소)</label>
        <input type="url" name="detail_link" placeholder="https://blog.naver.com/..." required>

        ${linkFieldsHtml(1, '토스', [])}
        ${linkFieldsHtml(2, '네이버', [])}
        ${linkFieldsHtml(3, '쿠팡', [])}

        <label>유튜브 영상 링크 (선택)</label>
        <input type="url" name="youtube_url" placeholder="https://youtube.com/watch?v=...">

        <label>인스타그램 게시물 링크 (선택)</label>
        <input type="url" name="instagram_url" placeholder="https://instagram.com/p/...">

        <label>스레드 게시물 임베드 코드 (선택)</label>
        <textarea name="threads_embed_html" rows="4" placeholder="스레드 게시물의 공유 → 임베드 코드 가져오기에서 복사한 코드 전체를 붙여넣어주세요"></textarea>

        <button type="submit">업로드</button>
      </form>
    </div>
  `, imageFormScript(true));
}

function youtubeUploadPage(youtubeConnected, errorMsg, successVideoId) {
  if (!youtubeConnected) {
    return page('영상 업로드', `
      <div class="wrap">
        ${navHtml('youtube')}
        <h1>유튜브 영상 업로드</h1>
        <p style="font-size:13px;color:#666;">먼저 유튜브 계정을 연동해주세요.</p>
        <a href="/admin/youtube/connect" style="display:inline-block;margin-top:8px;padding:11px 20px;font-size:13px;font-weight:700;color:#fff;background:#141414;border-radius:6px;text-decoration:none;">유튜브 연동하기</a>
      </div>
    `);
  }
  return page('영상 업로드', `
    <div class="wrap">
      ${navHtml('youtube')}
      <h1>유튜브 영상 업로드</h1>
      ${successVideoId ? `<div class="success">업로드 완료! <a href="https://www.youtube.com/watch?v=${esc(successVideoId)}" target="_blank" rel="noopener noreferrer">영상 보러가기</a></div>` : ''}
      ${errorMsg ? `<div class="error" style="margin-bottom:16px;">${esc(errorMsg)}</div>` : ''}
      <form method="POST" action="/admin/youtube/upload" enctype="multipart/form-data" id="youtubeForm">
        <label>영상 파일</label>
        <input type="file" name="video" accept="video/*" required>
        <div class="hint">30초 내외 짧은 영상 기준, 100MB 이하 권장</div>

        <label>제목</label>
        <input type="text" name="title" required>

        <label>설명 (선택)</label>
        <textarea name="description" rows="4"></textarea>

        <label>공개 범위</label>
        <select name="privacy">
          <option value="public">전체 공개</option>
          <option value="unlisted">일부 공개</option>
          <option value="private">비공개</option>
        </select>

        <button type="submit">업로드</button>
      </form>
    </div>
  `, `
    const form = document.getElementById('youtubeForm');
    form.addEventListener('submit', () => {
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = '업로드 중... (시간이 걸릴 수 있어요)';
    });
  `);
}

function adminPagerHtml(basePath, page, totalPages) {
  const link = (p, label, disabled) => disabled
    ? `<span class="pager-btn disabled">${label}</span>`
    : `<a class="pager-btn" href="${basePath}?page=${p}">${label}</a>`;
  return `
    <div class="pager">
      ${link(page - 1, '이전', page <= 1)}
      <span>${page} / ${totalPages}</span>
      ${link(page + 1, '다음', page >= totalPages)}
    </div>`;
}

function productsPage(rows, pageNum, totalPages, origin) {
  const body = rows.map((r) => `
    <tr>
      <td>${esc(r.title)}</td>
      <td>${r.clicks}</td>
      <td>${new Date(r.created_at).toLocaleDateString('ko-KR')}</td>
      <td><a href="/admin/edit/${r.id}">수정</a></td>
      <td><button type="button" class="secondary copy-link-btn" data-link="${esc(origin)}/?p=${r.id}">링크복사</button></td>
    </tr>`).join('');

  const copyScript = `
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.copy-link-btn');
      if (!btn) return;
      navigator.clipboard.writeText(btn.dataset.link).then(() => {
        const original = btn.textContent;
        btn.textContent = '복사됨';
        setTimeout(() => { btn.textContent = original; }, 1200);
      });
    });
  `;

  return page('최근 업로드', `
    <div class="wrap">
      ${navHtml('products')}
      <h1>최근 업로드</h1>
      <table>
        <thead><tr><th>상품명</th><th>클릭수</th><th>등록일</th><th></th><th></th></tr></thead>
        <tbody>${body || '<tr><td colspan="5" style="color:#bbb;">아직 업로드된 상품이 없습니다.</td></tr>'}</tbody>
      </table>
      ${rows.length ? adminPagerHtml('/admin/products', pageNum, totalPages) : ''}
    </div>
  `, copyScript);
}

function editPage(product, errorParam) {
  const urlMode = /^https?:\/\//.test(product.image) ? product.image : null;
  return page('상품 수정', `
    <div class="wrap">
      ${navHtml('products')}
      <h1>상품 수정</h1>
      ${errorParam === 'missing' ? '<div class="error" style="margin-bottom:16px;">상품명과 상세페이지 링크는 필수입니다.</div>' : ''}
      <img class="thumb" src="${esc(product.image)}" alt="" referrerpolicy="no-referrer" style="width:64px;height:64px;margin-bottom:8px;">
      <form class="image-form" method="POST" action="/admin/edit/${product.id}" enctype="multipart/form-data">
        <label>대표 이미지 (바꾸려면 새로 선택/입력, 그대로 두면 유지됩니다)</label>
        ${imageModeFieldsHtml(urlMode)}

        <label>상품명</label>
        <input type="text" name="title" value="${esc(product.title)}" required>

        <label>상세페이지 링크 (내 블로그 글 주소)</label>
        <input type="url" name="detail_link" value="${esc(product.detailLink)}" required>

        ${linkFieldsHtml(1, '토스', product.links)}
        ${linkFieldsHtml(2, '네이버', product.links)}
        ${linkFieldsHtml(3, '쿠팡', product.links)}

        <label>유튜브 영상 링크 (선택)</label>
        <input type="url" name="youtube_url" value="${esc(product.youtubeUrl || '')}" placeholder="https://youtube.com/watch?v=...">

        <label>인스타그램 게시물 링크 (선택)</label>
        <input type="url" name="instagram_url" value="${esc(product.instagramUrl || '')}" placeholder="https://instagram.com/p/...">

        <label>스레드 게시물 임베드 코드 (선택)</label>
        <textarea name="threads_embed_html" rows="4" placeholder="스레드 게시물의 공유 → 임베드 코드 가져오기에서 복사한 코드 전체를 붙여넣어주세요">${esc(product.threadsEmbedHtml || '')}</textarea>

        <button type="submit">저장</button>
      </form>
    </div>
  `, imageFormScript(false));
}

function statsPage(products) {
  const rows = products.map((p) => `
    <tr>
      <td><img class="thumb" src="${esc(p.image)}" alt="" referrerpolicy="no-referrer"></td>
      <td>${esc(p.title)}</td>
      <td>${p.clicks}</td>
      <td>${new Date(p.createdAt).toLocaleDateString('ko-KR')}</td>
    </tr>`).join('');

  return page('클릭 통계', `
    <div class="wrap">
      ${navHtml('stats')}
      <h1>클릭 통계 (클릭 많은 순)</h1>
      <table>
        <thead><tr><th></th><th>상품명</th><th>클릭수</th><th>등록일</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4" style="color:#bbb;">아직 상품이 없습니다.</td></tr>'}</tbody>
      </table>
    </div>
  `);
}

async function handleAdminHome(request, env, url) {
  if (!(await isAuthed(request, env))) {
    return htmlResponse(loginPage(url.searchParams.get('error')));
  }
  await ensureSchema(env);
  const youtubeConnected = !!(await getSetting(env, 'youtube_refresh_token'));
  const justConnectedYoutube = url.searchParams.get('youtube') === 'connected';
  const instagramConnected = !!(await getSetting(env, 'instagram_access_token'));
  const justConnectedInstagram = url.searchParams.get('instagram') === 'connected';
  return htmlResponse(adminPage(url.searchParams.get('success'), youtubeConnected, justConnectedYoutube, instagramConnected, justConnectedInstagram));
}

async function handleProductsPage(request, env, url) {
  if (!(await isAuthed(request, env))) {
    return htmlResponse(loginPage(null));
  }
  await ensureSchema(env);
  const pageNum = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const offset = (pageNum - 1) * PAGE_SIZE;
  const { results } = await env.DB.prepare('SELECT id, title, clicks, created_at FROM products ORDER BY created_at DESC LIMIT ? OFFSET ?').bind(PAGE_SIZE, offset).all();
  const countRow = await env.DB.prepare('SELECT COUNT(*) as total FROM products').first();
  const totalPages = Math.max(1, Math.ceil(countRow.total / PAGE_SIZE));
  return htmlResponse(productsPage(results, pageNum, totalPages, url.origin));
}

async function handleStats(request, env) {
  if (!(await isAuthed(request, env))) {
    return htmlResponse(loginPage(null));
  }
  await ensureSchema(env);
  const { results } = await env.DB.prepare('SELECT * FROM products ORDER BY clicks DESC, created_at DESC LIMIT 200').all();
  return htmlResponse(statsPage(results.map(normalizeRow)));
}

async function handleLogin(request, env) {
  const form = await request.formData();
  const password = form.get('password');
  if (password && env.ADMIN_PASSWORD && password === env.ADMIN_PASSWORD) {
    const token = await createSessionToken(env);
    return new Response(null, {
      status: 303,
      headers: {
        'Location': '/admin',
        'Set-Cookie': `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`,
      },
    });
  }
  return new Response(null, { status: 303, headers: { Location: '/admin?error=1' } });
}

async function handleLogout() {
  return new Response(null, {
    status: 303,
    headers: {
      Location: '/admin',
      'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
    },
  });
}

async function resolveImageKey(env, form) {
  const image = form.get('image');
  const imageUrl = (form.get('image_url') || '').toString().trim();
  const hasFile = image && typeof image === 'object' && image.size > 0;
  const hasUrl = /^https?:\/\//.test(imageUrl);

  if (hasFile) {
    const ext = (image.type && image.type.split('/')[1]) || 'jpg';
    const key = `products/${crypto.randomUUID()}.${ext}`;
    await env.IMAGES.put(key, await image.arrayBuffer(), { httpMetadata: { contentType: image.type || 'image/jpeg' } });
    return key;
  }
  if (hasUrl) return imageUrl;
  return null;
}

function readLinkFields(form) {
  return [1, 2, 3].map((n) => ({
    label: (form.get(`link${n}_label`) || '').toString().trim(),
    url: (form.get(`link${n}_url`) || '').toString().trim(),
  }));
}

async function handleUpload(request, env) {
  if (!(await isAuthed(request, env))) return new Response('Unauthorized', { status: 401 });
  await ensureSchema(env);

  const form = await request.formData();
  const title = (form.get('title') || '').toString().trim();
  const detailLink = (form.get('detail_link') || '').toString().trim();
  const key = await resolveImageKey(env, form);

  if (!title || !detailLink || !key) {
    return new Response(null, { status: 303, headers: { Location: '/admin?error=missing' } });
  }

  const links = readLinkFields(form);
  const youtubeUrl = (form.get('youtube_url') || '').toString().trim();
  const instagramUrl = (form.get('instagram_url') || '').toString().trim();
  const threadsEmbedHtml = (form.get('threads_embed_html') || '').toString().trim();
  await insertProduct(env, { title, key, detailLink, links, youtubeUrl, instagramUrl, threadsEmbedHtml });

  return new Response(null, { status: 303, headers: { Location: '/admin?success=1' } });
}

async function insertProduct(env, { title, key, detailLink, links, youtubeUrl, instagramUrl, threadsEmbedHtml, category }) {
  await env.DB.prepare(
    `INSERT INTO products (title, image_key, detail_link, link1_label, link1_url, link2_label, link2_url, link3_label, link3_url, youtube_url, instagram_url, threads_embed_html, category, clicks, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).bind(
    title, key, detailLink,
    links[0]?.label || null, links[0]?.url || null,
    links[1]?.label || null, links[1]?.url || null,
    links[2]?.label || null, links[2]?.url || null,
    youtubeUrl || null, instagramUrl || null, threadsEmbedHtml || null, category || null,
    Date.now()
  ).run();
}

function checkApiToken(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  return !!env.API_TOKEN && token === env.API_TOKEN;
}

async function handleApiUpload(request, env) {
  if (!checkApiToken(request, env)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  await ensureSchema(env);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid json' }, 400);
  }

  const title = (body.title || '').toString().trim();
  const detailLink = (body.detail_link || '').toString().trim();
  const imageUrl = (body.image_url || '').toString().trim();
  const links = Array.isArray(body.links) ? body.links.slice(0, 3) : [];

  if (!title || !detailLink || !/^https?:\/\//.test(imageUrl)) {
    return jsonResponse({ error: 'title, detail_link, image_url are required' }, 400);
  }

  const youtubeUrl = (body.youtube_url || '').toString().trim();
  const instagramUrl = (body.instagram_url || '').toString().trim();
  const threadsEmbedHtml = (body.threads_embed_html || '').toString().trim();
  const category = (body.category || '').toString().trim();
  await insertProduct(env, { title, key: imageUrl, detailLink, links, youtubeUrl, instagramUrl, threadsEmbedHtml, category });
  return jsonResponse({ ok: true });
}

async function handleApiEdit(request, env, id) {
  if (!checkApiToken(request, env)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  await ensureSchema(env);

  const existing = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  if (!existing) return jsonResponse({ error: 'not found' }, 404);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid json' }, 400);
  }

  const title = body.title !== undefined ? body.title.toString().trim() : existing.title;
  const detailLink = body.detail_link !== undefined ? body.detail_link.toString().trim() : existing.detail_link;
  const imageUrl = body.image_url !== undefined ? body.image_url.toString().trim() : null;
  const key = imageUrl && /^https?:\/\//.test(imageUrl) ? imageUrl : existing.image_key;
  const links = Array.isArray(body.links) ? body.links.slice(0, 3) : null;
  const category = body.category !== undefined ? body.category.toString().trim() : existing.category;

  const l1 = links ? links[0] : { label: existing.link1_label, url: existing.link1_url };
  const l2 = links ? links[1] : { label: existing.link2_label, url: existing.link2_url };
  const l3 = links ? links[2] : { label: existing.link3_label, url: existing.link3_url };

  await env.DB.prepare(
    `UPDATE products SET title = ?, image_key = ?, detail_link = ?, link1_label = ?, link1_url = ?, link2_label = ?, link2_url = ?, link3_label = ?, link3_url = ?, category = ? WHERE id = ?`
  ).bind(
    title, key, detailLink,
    l1?.label || null, l1?.url || null,
    l2?.label || null, l2?.url || null,
    l3?.label || null, l3?.url || null,
    category || null,
    id
  ).run();

  return jsonResponse({ ok: true });
}

async function handleEditPage(request, env, id) {
  if (!(await isAuthed(request, env))) return htmlResponse(loginPage(null));
  await ensureSchema(env);
  const row = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  if (!row) return new Response('Not Found', { status: 404 });
  const url = new URL(request.url);
  return htmlResponse(editPage(normalizeRow(row), url.searchParams.get('error')));
}

async function handleEditSubmit(request, env, id) {
  if (!(await isAuthed(request, env))) return new Response('Unauthorized', { status: 401 });
  await ensureSchema(env);

  const existing = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
  if (!existing) return new Response('Not Found', { status: 404 });

  const form = await request.formData();
  const title = (form.get('title') || '').toString().trim();
  const detailLink = (form.get('detail_link') || '').toString().trim();

  if (!title || !detailLink) {
    return new Response(null, { status: 303, headers: { Location: `/admin/edit/${id}?error=missing` } });
  }

  const newKey = await resolveImageKey(env, form);
  const key = newKey || existing.image_key;
  const links = readLinkFields(form);
  const youtubeUrl = (form.get('youtube_url') || '').toString().trim();
  const instagramUrl = (form.get('instagram_url') || '').toString().trim();
  const threadsEmbedHtml = (form.get('threads_embed_html') || '').toString().trim();

  await env.DB.prepare(
    `UPDATE products SET title = ?, image_key = ?, detail_link = ?, link1_label = ?, link1_url = ?, link2_label = ?, link2_url = ?, link3_label = ?, link3_url = ?, youtube_url = ?, instagram_url = ?, threads_embed_html = ? WHERE id = ?`
  ).bind(
    title, key, detailLink,
    links[0].label || null, links[0].url || null,
    links[1].label || null, links[1].url || null,
    links[2].label || null, links[2].url || null,
    youtubeUrl || null, instagramUrl || null, threadsEmbedHtml || null,
    id
  ).run();

  return new Response(null, { status: 303, headers: { Location: '/admin?success=1' } });
}

async function handleListProducts(env, url) {
  await ensureSchema(env);
  const id = parseInt(url.searchParams.get('id') || '', 10);

  if (id) {
    const row = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
    return jsonResponse({ items: row ? [normalizeRow(row)] : [] });
  }

  const q = (url.searchParams.get('q') || '').trim();

  if (q) {
    const { results } = await env.DB.prepare('SELECT * FROM products WHERE title LIKE ? ORDER BY created_at DESC LIMIT 50').bind(`%${q}%`).all();
    return jsonResponse({ items: results.map(normalizeRow) });
  }

  const section = url.searchParams.get('section') || 'all';

  if (section === 'popular') {
    const { results } = await env.DB.prepare(
      "SELECT * FROM products ORDER BY (category = 'today_deal') ASC, created_at DESC LIMIT 10"
    ).all();
    return jsonResponse({ items: results.map(normalizeRow) });
  }

  if (section === 'category') {
    const category = (url.searchParams.get('category') || '').trim();
    if (!category) return jsonResponse({ items: [] });
    const { results } = await env.DB.prepare('SELECT * FROM products WHERE category = ? ORDER BY created_at DESC LIMIT 20').bind(category).all();
    return jsonResponse({ items: results.map(normalizeRow) });
  }

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { results } = await env.DB.prepare(
    "SELECT * FROM products ORDER BY (category = 'today_deal') ASC, created_at DESC LIMIT ? OFFSET ?"
  ).bind(PAGE_SIZE, offset).all();
  const countRow = await env.DB.prepare('SELECT COUNT(*) as total FROM products').first();
  return jsonResponse({ items: results.map(normalizeRow), total: countRow.total, page, pageSize: PAGE_SIZE });
}

async function handleClick(env, path) {
  await ensureSchema(env);
  const id = parseInt(path.slice('/api/click/'.length), 10);
  if (!id) return new Response('Bad Request', { status: 400 });
  await env.DB.prepare('UPDATE products SET clicks = clicks + 1 WHERE id = ?').bind(id).run();
  return jsonResponse({ ok: true });
}

async function handleImage(env, path) {
  const key = decodeURIComponent(path.slice('/images/'.length));
  const obj = await env.IMAGES.get(key);
  if (!obj) return new Response('Not Found', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

let tossToken = null;
let tossTokenExpiresAt = 0;

async function getTossToken(env, forceRefresh = false) {
  if (!forceRefresh && tossToken && Date.now() < tossTokenExpiresAt) return tossToken;
  const resp = await fetch('https://oauth2.cert.toss.im/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.TOSS_ACCESS_KEY,
      client_secret: env.TOSS_SECRET_KEY,
      scope: 'sharelink:read sharelink:write',
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`토스 토큰 발급 실패 (${resp.status}): ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  tossToken = data.access_token;
  tossTokenExpiresAt = Date.now() + (data.expires_in || 3000) * 1000 - 60000;
  return tossToken;
}

async function tossRequest(env, method, path, { params, body, _retry } = {}) {
  const token = await getTossToken(env);
  let url = `https://sharelink.toss.im${path}`;
  if (params) url += '?' + new URLSearchParams(params).toString();

  const resp = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (resp.status === 401 && !_retry) {
    await getTossToken(env, true);
    return tossRequest(env, method, path, { params, body, _retry: true });
  }

  const data = await resp.json();
  if (data.resultType === 'FAIL') {
    const err = data.error || {};
    throw new Error(`토스 API 오류 [${err.errorCode}] ${err.reason || ''}`);
  }
  return data.success;
}

async function tossGetTodayDeals(env, size = 20) {
  return tossRequest(env, 'GET', '/openapi/products/today-deals', { params: { size: String(size) } });
}

async function tossIssueShareLink(env, tacaItemId) {
  return tossRequest(env, 'POST', '/openapi/links', {
    body: { tacaItemId, publisherId: env.TOSS_PUBLISHER_ID },
  });
}

async function runDailyTossUpdate(env) {
  await ensureSchema(env);
  const deals = await tossGetTodayDeals(env, 20);

  await env.DB.prepare("UPDATE products SET category = NULL WHERE category = 'today_deal'").run();

  const results = [];
  for (const item of deals.items || []) {
    try {
      const linkData = await tossIssueShareLink(env, item.tacaItemId);
      const shortUrl = linkData.shortUrl;
      const title = `🔥오늘만! ${item.displayName}`;

      const existing = await env.DB.prepare('SELECT id FROM products WHERE link1_url = ?').bind(shortUrl).first();
      if (existing) {
        await env.DB.prepare(
          'UPDATE products SET title = ?, image_key = ?, category = ? WHERE id = ?'
        ).bind(title, item.thumbnailUrl, 'today_deal', existing.id).run();
        results.push({ ok: true, title, mode: 'updated' });
      } else {
        await insertProduct(env, {
          title,
          key: item.thumbnailUrl,
          detailLink: shortUrl,
          links: [{ label: '최저가 확인!', url: shortUrl }],
          category: 'today_deal',
        });
        results.push({ ok: true, title, mode: 'inserted' });
      }
    } catch (err) {
      results.push({ ok: false, title: item.displayName, error: err.message });
    }
  }
  return results;
}

const YOUTUBE_REDIRECT_URI = 'https://seokhyun93-github-io.tjrgus3709.workers.dev/admin/youtube/callback';
const YOUTUBE_SCOPES = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly';

async function handleYoutubeConnect(request, env) {
  if (!(await isAuthed(request, env))) return htmlResponse(loginPage(null));
  const state = crypto.randomUUID();
  await setSetting(env, 'youtube_oauth_state', state);

  const params = new URLSearchParams({
    client_id: env.YOUTUBE_CLIENT_ID,
    redirect_uri: YOUTUBE_REDIRECT_URI,
    response_type: 'code',
    scope: YOUTUBE_SCOPES,
    access_type: 'offline',
    prompt: 'consent select_account',
    state,
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 302);
}

async function handleYoutubeCallback(request, env, url) {
  if (!(await isAuthed(request, env))) return htmlResponse(loginPage(null));
  await ensureSchema(env);

  const error = url.searchParams.get('error');
  if (error) return htmlResponse(page('유튜브 연동', `<div class="wrap"><h1>연동 실패</h1><p>${esc(error)}</p><a href="/admin">돌아가기</a></div>`));

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = await getSetting(env, 'youtube_oauth_state');
  if (!code || !state || state !== expectedState) {
    return htmlResponse(page('유튜브 연동', `<div class="wrap"><h1>연동 실패</h1><p>state 값이 일치하지 않습니다. 다시 시도해주세요.</p><a href="/admin">돌아가기</a></div>`));
  }

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.YOUTUBE_CLIENT_ID,
      client_secret: env.YOUTUBE_CLIENT_SECRET,
      redirect_uri: YOUTUBE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  const tokenData = await tokenResp.json();

  if (!tokenResp.ok || !tokenData.refresh_token) {
    return htmlResponse(page('유튜브 연동', `<div class="wrap"><h1>연동 실패</h1><pre style="white-space:pre-wrap;font-size:12px;background:#fafafa;padding:12px;border-radius:6px;">${esc(JSON.stringify(tokenData, null, 2))}</pre><a href="/admin">돌아가기</a></div>`));
  }

  await setSetting(env, 'youtube_refresh_token', tokenData.refresh_token);
  await setSetting(env, 'youtube_connected_at', String(Date.now()));

  return Response.redirect('https://seokhyun93-github-io.tjrgus3709.workers.dev/admin?youtube=connected', 302);
}

async function getYoutubeAccessToken(env) {
  const refreshToken = await getSetting(env, 'youtube_refresh_token');
  if (!refreshToken) throw new Error('유튜브가 연동되어 있지 않습니다.');
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.YOUTUBE_CLIENT_ID,
      client_secret: env.YOUTUBE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.access_token) {
    throw new Error('액세스 토큰 발급 실패: ' + JSON.stringify(data));
  }
  return data.access_token;
}

async function uploadVideoToYoutube(env, { videoBytes, contentType, title, description, privacyStatus }) {
  const accessToken = await getYoutubeAccessToken(env);

  const metadata = {
    snippet: { title, description, categoryId: '22' },
    status: { privacyStatus, selfDeclaredMadeForKids: false },
  };

  const boundary = 'youtubeupload' + crypto.randomUUID().replace(/-/g, '');
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${contentType || 'video/mp4'}\r\n\r\n`
  );
  const tail = encoder.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + videoBytes.length + tail.length);
  body.set(head, 0);
  body.set(videoBytes, head.length);
  body.set(tail, head.length + videoBytes.length);

  const uploadResp = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const uploadData = await uploadResp.json();

  if (!uploadResp.ok || !uploadData.id) {
    throw new Error(uploadData?.error?.message || JSON.stringify(uploadData));
  }

  return uploadData.id;
}

async function handleYoutubeUploadPage(request, env, url) {
  if (!(await isAuthed(request, env))) return htmlResponse(loginPage(null));
  await ensureSchema(env);
  const youtubeConnected = !!(await getSetting(env, 'youtube_refresh_token'));
  return htmlResponse(youtubeUploadPage(youtubeConnected, url.searchParams.get('error'), url.searchParams.get('success')));
}

async function handleYoutubeUpload(request, env) {
  if (!(await isAuthed(request, env))) return htmlResponse(loginPage(null));
  await ensureSchema(env);
  try {
    const form = await request.formData();
    const videoFile = form.get('video');
    const title = (form.get('title') || '').toString().trim();
    const description = (form.get('description') || '').toString();
    const privacyStatus = ['public', 'unlisted', 'private'].includes(form.get('privacy'))
      ? form.get('privacy').toString()
      : 'public';

    if (!videoFile || typeof videoFile === 'string' || !title) {
      return new Response(null, {
        status: 303,
        headers: { Location: '/admin/youtube/upload?error=' + encodeURIComponent('영상 파일과 제목은 필수입니다.') },
      });
    }

    const videoBytes = new Uint8Array(await videoFile.arrayBuffer());
    const videoId = await uploadVideoToYoutube(env, {
      videoBytes,
      contentType: videoFile.type,
      title,
      description,
      privacyStatus,
    });

    return new Response(null, {
      status: 303,
      headers: { Location: '/admin/youtube/upload?success=' + encodeURIComponent(videoId) },
    });
  } catch (err) {
    return new Response(null, {
      status: 303,
      headers: { Location: '/admin/youtube/upload?error=' + encodeURIComponent(err && err.message ? err.message : String(err)) },
    });
  }
}

async function handleApiYoutubeUpload(request, env) {
  if (!checkApiToken(request, env)) return jsonResponse({ error: 'unauthorized' }, 401);
  await ensureSchema(env);
  try {
    const form = await request.formData();
    const videoFile = form.get('video');
    const title = (form.get('title') || '').toString().trim();
    const description = (form.get('description') || '').toString();
    const privacyStatus = ['public', 'unlisted', 'private'].includes(form.get('privacy'))
      ? form.get('privacy').toString()
      : 'public';

    if (!videoFile || typeof videoFile === 'string' || !title) {
      return jsonResponse({ error: 'video and title are required' }, 400);
    }

    const videoBytes = new Uint8Array(await videoFile.arrayBuffer());
    const videoId = await uploadVideoToYoutube(env, {
      videoBytes,
      contentType: videoFile.type,
      title,
      description,
      privacyStatus,
    });

    return jsonResponse({ id: videoId, url: `https://www.youtube.com/watch?v=${videoId}` });
  } catch (err) {
    return jsonResponse({ error: err && err.message ? err.message : String(err) }, 500);
  }
}

// ============================== Instagram ==============================

const INSTAGRAM_REDIRECT_URI = 'https://seokhyun93-github-io.tjrgus3709.workers.dev/admin/instagram/callback';
const INSTAGRAM_SCOPES = 'instagram_business_basic,instagram_business_content_publish';
// 메타가 그래프 API 버전을 올리면(만료 에러 발생 시) 여기 숫자만 올리면 됩니다.
const IG_API_VERSION = 'v21.0';

async function handleInstagramConnect(request, env) {
  if (!(await isAuthed(request, env))) return htmlResponse(loginPage(null));
  const state = crypto.randomUUID();
  await setSetting(env, 'instagram_oauth_state', state);
  const params = new URLSearchParams({
    client_id: env.INSTAGRAM_APP_ID,
    redirect_uri: INSTAGRAM_REDIRECT_URI,
    response_type: 'code',
    scope: INSTAGRAM_SCOPES,
    state,
  });
  return Response.redirect(`https://www.instagram.com/oauth/authorize?${params.toString()}`, 302);
}

async function handleInstagramCallback(request, env, url) {
  if (!(await isAuthed(request, env))) return htmlResponse(loginPage(null));
  await ensureSchema(env);

  const error = url.searchParams.get('error');
  if (error) {
    return htmlResponse(page('인스타그램 연동', `<div class="wrap">${navHtml('instagram')}<h1>연동 실패</h1><p>${esc(url.searchParams.get('error_description') || error)}</p><a href="/admin">돌아가기</a></div>`));
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = await getSetting(env, 'instagram_oauth_state');
  if (!code || !state || state !== expectedState) {
    return htmlResponse(page('인스타그램 연동', `<div class="wrap">${navHtml('instagram')}<h1>연동 실패</h1><p>state 값이 일치하지 않습니다. 다시 시도해주세요.</p><a href="/admin">돌아가기</a></div>`));
  }

  const shortResp = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.INSTAGRAM_APP_ID,
      client_secret: env.INSTAGRAM_APP_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: INSTAGRAM_REDIRECT_URI,
      code,
    }),
  });
  const shortData = await shortResp.json();
  if (!shortResp.ok || !shortData.access_token) {
    return htmlResponse(page('인스타그램 연동', `<div class="wrap">${navHtml('instagram')}<h1>연동 실패</h1><pre style="white-space:pre-wrap;font-size:12px;background:#fafafa;padding:12px;border-radius:6px;">${esc(JSON.stringify(shortData, null, 2))}</pre><a href="/admin">돌아가기</a></div>`));
  }

  const longResp = await fetch(`https://graph.instagram.com/access_token?${new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: env.INSTAGRAM_APP_SECRET,
    access_token: shortData.access_token,
  }).toString()}`);
  const longData = await longResp.json();
  if (!longResp.ok || !longData.access_token) {
    return htmlResponse(page('인스타그램 연동', `<div class="wrap">${navHtml('instagram')}<h1>연동 실패 (장기 토큰)</h1><pre style="white-space:pre-wrap;font-size:12px;background:#fafafa;padding:12px;border-radius:6px;">${esc(JSON.stringify(longData, null, 2))}</pre><a href="/admin">돌아가기</a></div>`));
  }

  await setSetting(env, 'instagram_access_token', longData.access_token);
  await setSetting(env, 'instagram_user_id', String(shortData.user_id));
  await setSetting(env, 'instagram_connected_at', String(Date.now()));

  return Response.redirect('https://seokhyun93-github-io.tjrgus3709.workers.dev/admin?instagram=connected', 302);
}

async function igApiRequest(env, method, path, params) {
  const accessToken = await getSetting(env, 'instagram_access_token');
  if (!accessToken) throw new Error('인스타그램이 연동되어 있지 않습니다.');
  const url = new URL(`https://graph.instagram.com/${IG_API_VERSION}${path}`);
  const body = new URLSearchParams({ ...params, access_token: accessToken });
  let resp;
  if (method === 'GET') {
    for (const [k, v] of body.entries()) url.searchParams.set(k, v);
    resp = await fetch(url.toString());
  } else {
    resp = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }
  const data = await resp.json();
  if (!resp.ok || data.error) {
    throw new Error((data && data.error && data.error.message) || JSON.stringify(data));
  }
  return data;
}

async function storeVideoInR2(env, file) {
  const ext = (file.type && file.type.split('/')[1]) || 'mp4';
  const key = `videos/${crypto.randomUUID()}.${ext}`;
  await env.IMAGES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || 'video/mp4' } });
  return `https://seokhyun93-github-io.tjrgus3709.workers.dev/images/${key}`;
}

async function createInstagramContainer(env, videoUrl, caption) {
  const igUserId = await getSetting(env, 'instagram_user_id');
  const data = await igApiRequest(env, 'POST', `/${igUserId}/media`, {
    media_type: 'REELS',
    video_url: videoUrl,
    caption: caption || '',
  });
  return data.id;
}

async function getInstagramContainerStatus(env, creationId) {
  return igApiRequest(env, 'GET', `/${creationId}`, { fields: 'status_code,status' });
}

async function publishInstagramContainer(env, creationId) {
  const igUserId = await getSetting(env, 'instagram_user_id');
  const data = await igApiRequest(env, 'POST', `/${igUserId}/media_publish`, { creation_id: creationId });
  return data.id;
}

function instagramUploadPage(instagramConnected, errorMsg) {
  if (!instagramConnected) {
    return page('인스타그램 업로드', `
      <div class="wrap">
        ${navHtml('instagram')}
        <h1>인스타그램 릴스 업로드</h1>
        <p style="font-size:13px;color:#666;">먼저 인스타그램 계정을 연동해주세요. (비즈니스/크리에이터 계정만 가능)</p>
        <a href="/admin/instagram/connect" style="display:inline-block;margin-top:8px;padding:11px 20px;font-size:13px;font-weight:700;color:#fff;background:#141414;border-radius:6px;text-decoration:none;">인스타그램 연동하기</a>
      </div>
    `);
  }
  return page('인스타그램 업로드', `
    <div class="wrap">
      ${navHtml('instagram')}
      <h1>인스타그램 릴스 업로드</h1>
      ${errorMsg ? `<div class="error" style="margin-bottom:16px;">${esc(errorMsg)}</div>` : ''}
      <form method="POST" action="/admin/instagram/upload" enctype="multipart/form-data" id="igForm">
        <label>영상 파일</label>
        <input type="file" name="video" accept="video/*" required>
        <div class="hint">세로 영상(9:16), 5~90초, 100MB 이하 권장</div>

        <label>캡션 (선택)</label>
        <textarea name="caption" rows="4" placeholder="게시글에 들어갈 설명, 해시태그 등"></textarea>

        <button type="submit">업로드</button>
      </form>
    </div>
  `, `
    const form = document.getElementById('igForm');
    form.addEventListener('submit', () => {
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = '업로드 중... (시간이 걸릴 수 있어요)';
    });
  `);
}

function instagramStatusPage(creationId) {
  return page('인스타그램 업로드', `
    <div class="wrap">
      ${navHtml('instagram')}
      <h1>인스타그램 처리 중...</h1>
      <p id="statusText" style="font-size:13px;color:#666;">인스타그램이 영상을 처리하고 있어요. 잠시만 기다려주세요.</p>
      <button id="publishBtn" type="button" disabled style="opacity:.4;">발행하기</button>
      <div id="resultBox"></div>
    </div>
  `, `
    const creationId = ${JSON.stringify(creationId)};
    const statusText = document.getElementById('statusText');
    const publishBtn = document.getElementById('publishBtn');
    const resultBox = document.getElementById('resultBox');

    async function checkStatus() {
      const res = await fetch('/admin/instagram/status.json?creation_id=' + encodeURIComponent(creationId));
      const data = await res.json();
      if (data.error) {
        statusText.textContent = '오류: ' + data.error;
        return;
      }
      if (data.status_code === 'FINISHED') {
        statusText.textContent = '처리 완료! 발행할 수 있어요.';
        publishBtn.disabled = false;
        publishBtn.style.opacity = '1';
      } else if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED') {
        statusText.textContent = '처리 실패: ' + data.status_code;
      } else {
        statusText.textContent = '처리 중... (' + (data.status_code || '확인 중') + ')';
        setTimeout(checkStatus, 4000);
      }
    }
    checkStatus();

    publishBtn.addEventListener('click', async () => {
      publishBtn.disabled = true;
      publishBtn.textContent = '발행 중...';
      const res = await fetch('/admin/instagram/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: creationId }),
      });
      const data = await res.json();
      if (data.error) {
        resultBox.innerHTML = '<div class="error">발행 실패: ' + data.error + '</div>';
        publishBtn.disabled = false;
        publishBtn.textContent = '발행하기';
      } else {
        resultBox.innerHTML = '<div class="success">발행 완료!</div>';
      }
    });
  `);
}

async function handleInstagramUploadPage(request, env) {
  if (!(await isAuthed(request, env))) return htmlResponse(loginPage(null));
  await ensureSchema(env);
  const instagramConnected = !!(await getSetting(env, 'instagram_access_token'));
  return htmlResponse(instagramUploadPage(instagramConnected, null));
}

async function handleInstagramUpload(request, env) {
  if (!(await isAuthed(request, env))) return htmlResponse(loginPage(null));
  await ensureSchema(env);
  try {
    const form = await request.formData();
    const videoFile = form.get('video');
    const caption = (form.get('caption') || '').toString();

    if (!videoFile || typeof videoFile === 'string') {
      return htmlResponse(instagramUploadPage(true, '영상 파일은 필수입니다.'));
    }

    const videoUrl = await storeVideoInR2(env, videoFile);
    const creationId = await createInstagramContainer(env, videoUrl, caption);

    return htmlResponse(instagramStatusPage(creationId));
  } catch (err) {
    return htmlResponse(instagramUploadPage(true, err && err.message ? err.message : String(err)));
  }
}

async function handleInstagramStatusJson(request, env, url) {
  if (!(await isAuthed(request, env))) return jsonResponse({ error: '인증 필요' }, 401);
  try {
    const creationId = url.searchParams.get('creation_id');
    const data = await getInstagramContainerStatus(env, creationId);
    return jsonResponse(data);
  } catch (err) {
    return jsonResponse({ error: err && err.message ? err.message : String(err) }, 500);
  }
}

async function handleInstagramPublish(request, env) {
  if (!(await isAuthed(request, env))) return jsonResponse({ error: '인증 필요' }, 401);
  try {
    const body = await request.json();
    const mediaId = await publishInstagramContainer(env, body.creation_id);
    return jsonResponse({ id: mediaId });
  } catch (err) {
    return jsonResponse({ error: err && err.message ? err.message : String(err) }, 500);
  }
}

// 로컬 자동화 스크립트용 (토큰 인증)
async function handleApiVideoUpload(request, env) {
  if (!checkApiToken(request, env)) return jsonResponse({ error: 'unauthorized' }, 401);
  await ensureSchema(env);
  const form = await request.formData();
  const file = form.get('video');
  if (!file || typeof file === 'string') return jsonResponse({ error: 'video is required' }, 400);
  const videoUrl = await storeVideoInR2(env, file);
  return jsonResponse({ url: videoUrl });
}

async function handleApiInstagramPublish(request, env) {
  if (!checkApiToken(request, env)) return jsonResponse({ error: 'unauthorized' }, 401);
  try {
    const body = await request.json();
    const creationId = await createInstagramContainer(env, body.video_url, body.caption || '');
    return jsonResponse({ creation_id: creationId });
  } catch (err) {
    return jsonResponse({ error: err && err.message ? err.message : String(err) }, 500);
  }
}

async function handleApiInstagramStatus(request, env, url) {
  if (!checkApiToken(request, env)) return jsonResponse({ error: 'unauthorized' }, 401);
  try {
    const creationId = url.searchParams.get('creation_id');
    const data = await getInstagramContainerStatus(env, creationId);
    return jsonResponse(data);
  } catch (err) {
    return jsonResponse({ error: err && err.message ? err.message : String(err) }, 500);
  }
}

async function handleApiInstagramMediaPublish(request, env) {
  if (!checkApiToken(request, env)) return jsonResponse({ error: 'unauthorized' }, 401);
  try {
    const body = await request.json();
    const mediaId = await publishInstagramContainer(env, body.creation_id);
    return jsonResponse({ id: mediaId });
  } catch (err) {
    return jsonResponse({ error: err && err.message ? err.message : String(err) }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/admin' && request.method === 'GET') return handleAdminHome(request, env, url);
      if (path === '/admin/login' && request.method === 'POST') return handleLogin(request, env);
      if (path === '/admin/logout' && request.method === 'POST') return handleLogout();
      if (path === '/admin/upload' && request.method === 'POST') return handleUpload(request, env);
      if (path === '/admin/stats' && request.method === 'GET') return handleStats(request, env);
      if (path === '/admin/products' && request.method === 'GET') return handleProductsPage(request, env, url);
      if (path === '/admin/youtube/connect' && request.method === 'GET') return handleYoutubeConnect(request, env);
      if (path === '/admin/youtube/callback' && request.method === 'GET') return handleYoutubeCallback(request, env, url);
      if (path === '/admin/youtube/upload' && request.method === 'GET') return handleYoutubeUploadPage(request, env, url);
      if (path === '/admin/youtube/upload' && request.method === 'POST') return handleYoutubeUpload(request, env);
      if (path === '/admin/instagram/connect' && request.method === 'GET') return handleInstagramConnect(request, env);
      if (path === '/admin/instagram/callback' && request.method === 'GET') return handleInstagramCallback(request, env, url);
      if (path === '/admin/instagram/upload' && request.method === 'GET') return handleInstagramUploadPage(request, env);
      if (path === '/admin/instagram/upload' && request.method === 'POST') return handleInstagramUpload(request, env);
      if (path === '/admin/instagram/status.json' && request.method === 'GET') return handleInstagramStatusJson(request, env, url);
      if (path === '/admin/instagram/publish' && request.method === 'POST') return handleInstagramPublish(request, env);
      if (path.startsWith('/admin/edit/') && request.method === 'GET') {
        return handleEditPage(request, env, parseInt(path.slice('/admin/edit/'.length), 10));
      }
      if (path.startsWith('/admin/edit/') && request.method === 'POST') {
        return handleEditSubmit(request, env, parseInt(path.slice('/admin/edit/'.length), 10));
      }

      if (path === '/api/products' && request.method === 'GET') return handleListProducts(env, url);
      if (path === '/api/admin/products' && request.method === 'POST') return handleApiUpload(request, env);
      if (path.startsWith('/api/admin/products/') && request.method === 'POST') {
        return handleApiEdit(request, env, parseInt(path.slice('/api/admin/products/'.length), 10));
      }
      if (path.startsWith('/api/click/') && request.method === 'POST') return handleClick(env, path);
      if (path === '/api/admin/youtube/upload' && request.method === 'POST') return handleApiYoutubeUpload(request, env);
      if (path === '/api/admin/videos' && request.method === 'POST') return handleApiVideoUpload(request, env);
      if (path === '/api/admin/instagram/publish' && request.method === 'POST') return handleApiInstagramPublish(request, env);
      if (path === '/api/admin/instagram/status' && request.method === 'GET') return handleApiInstagramStatus(request, env, url);
      if (path === '/api/admin/instagram/media_publish' && request.method === 'POST') return handleApiInstagramMediaPublish(request, env);
      if (path === '/api/admin/run-daily-toss-update' && request.method === 'POST') {
        if (!checkApiToken(request, env)) return jsonResponse({ error: 'unauthorized' }, 401);
        const results = await runDailyTossUpdate(env);
        return jsonResponse({ results });
      }

      if (path.startsWith('/images/') && request.method === 'GET') return handleImage(env, path);

      return env.ASSETS.fetch(request);
    } catch (err) {
      return new Response('Server error: ' + (err && err.message ? err.message : String(err)), { status: 500 });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDailyTossUpdate(env));
  },
};
