const COOKIE_NAME = 'session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, in seconds
const PAGE_SIZE = 20;

let schemaReady = false;

async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, image_key TEXT NOT NULL, detail_link TEXT NOT NULL, link1_label TEXT, link1_url TEXT, link2_label TEXT, link2_url TEXT, link3_label TEXT, link3_url TEXT, clicks INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)'
  ).run();
  for (const col of ['youtube_url TEXT', 'instagram_url TEXT']) {
    try {
      await env.DB.prepare(`ALTER TABLE products ADD COLUMN ${col}`).run();
    } catch (e) {
      // column already exists
    }
  }
  schemaReady = true;
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
  };
}

function baseStyle() {
  return `
    * { box-sizing: border-box; }
    body { margin:0; font-family:'Noto Sans KR',-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif; background:#fff; color:#141414; }
    a { color:inherit; }
    .wrap { max-width: 640px; margin: 0 auto; padding: 48px 24px 80px; }
    h1 { font-size:16px; font-weight:700; margin:0 0 24px; }
    label { display:block; font-size:12px; color:#666; margin:16px 0 6px; }
    input[type=text], input[type=url], input[type=password] {
      width:100%; padding:10px 12px; font-size:14px; border:1px solid #e5e5e5; border-radius:6px; font-family:inherit; outline:none;
    }
    input:focus { border-color:#c9705a; }
    input[type=file] { margin-top:4px; font-size:13px; }
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
      ${tab('/admin', '업로드', 'upload')}
      ${tab('/admin/products', '최근 업로드', 'products')}
      ${tab('/admin/stats', '클릭 통계', 'stats')}
      <form method="POST" action="/admin/logout" style="margin-left:auto;">
        <button type="submit" class="secondary">로그아웃</button>
      </form>
    </div>`;
}

function adminPage(successParam) {
  return page('상품 업로드', `
    <div class="wrap">
      ${navHtml('upload')}
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

        <button type="submit">업로드</button>
      </form>
    </div>
  `, imageFormScript(true));
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
  return htmlResponse(adminPage(url.searchParams.get('success')));
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
        'Set-Cookie': `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE}`,
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
      'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`,
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
  await insertProduct(env, { title, key, detailLink, links, youtubeUrl, instagramUrl });

  return new Response(null, { status: 303, headers: { Location: '/admin?success=1' } });
}

async function insertProduct(env, { title, key, detailLink, links, youtubeUrl, instagramUrl }) {
  await env.DB.prepare(
    `INSERT INTO products (title, image_key, detail_link, link1_label, link1_url, link2_label, link2_url, link3_label, link3_url, youtube_url, instagram_url, clicks, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).bind(
    title, key, detailLink,
    links[0]?.label || null, links[0]?.url || null,
    links[1]?.label || null, links[1]?.url || null,
    links[2]?.label || null, links[2]?.url || null,
    youtubeUrl || null, instagramUrl || null,
    Date.now()
  ).run();
}

async function handleApiUpload(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!env.API_TOKEN || token !== env.API_TOKEN) {
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
  await insertProduct(env, { title, key: imageUrl, detailLink, links, youtubeUrl, instagramUrl });
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

  await env.DB.prepare(
    `UPDATE products SET title = ?, image_key = ?, detail_link = ?, link1_label = ?, link1_url = ?, link2_label = ?, link2_url = ?, link3_label = ?, link3_url = ?, youtube_url = ?, instagram_url = ? WHERE id = ?`
  ).bind(
    title, key, detailLink,
    links[0].label || null, links[0].url || null,
    links[1].label || null, links[1].url || null,
    links[2].label || null, links[2].url || null,
    youtubeUrl || null, instagramUrl || null,
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
    const { results } = await env.DB.prepare('SELECT * FROM products ORDER BY clicks DESC, created_at DESC LIMIT 10').all();
    return jsonResponse({ items: results.map(normalizeRow) });
  }

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { results } = await env.DB.prepare('SELECT * FROM products ORDER BY created_at DESC LIMIT ? OFFSET ?').bind(PAGE_SIZE, offset).all();
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
      if (path.startsWith('/admin/edit/') && request.method === 'GET') {
        return handleEditPage(request, env, parseInt(path.slice('/admin/edit/'.length), 10));
      }
      if (path.startsWith('/admin/edit/') && request.method === 'POST') {
        return handleEditSubmit(request, env, parseInt(path.slice('/admin/edit/'.length), 10));
      }

      if (path === '/api/products' && request.method === 'GET') return handleListProducts(env, url);
      if (path === '/api/admin/products' && request.method === 'POST') return handleApiUpload(request, env);
      if (path.startsWith('/api/click/') && request.method === 'POST') return handleClick(env, path);

      if (path.startsWith('/images/') && request.method === 'GET') return handleImage(env, path);

      return env.ASSETS.fetch(request);
    } catch (err) {
      return new Response('Server error: ' + (err && err.message ? err.message : String(err)), { status: 500 });
    }
  },
};
