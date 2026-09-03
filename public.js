function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

function cardHtml(item) {
  const links = item.links
    .map((l) => `<a class="link-chip" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" data-id="${item.id}">${esc(l.label)}</a>`)
    .join('');
  return `
    <div class="product-card">
      <a class="product-image" href="${esc(item.detailLink)}" target="_blank" rel="noopener noreferrer" data-id="${item.id}">
        <img src="${esc(item.image)}" alt="" referrerpolicy="no-referrer" onerror="handleImgError(this)">
      </a>
      <div class="product-title">${esc(item.title)}</div>
      ${links ? `<div class="product-links">${links}</div>` : ''}
    </div>`;
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-id]');
  if (!el) return;
  navigator.sendBeacon('/api/click/' + el.dataset.id);
});

const todayDealCategory = document.getElementById('todayDealCategory');
const todayDealRow = document.getElementById('todayDealRow');
const popularRow = document.getElementById('popularRow');
const gridEl = document.getElementById('productGrid');
const gridSentinel = document.getElementById('gridSentinel');
const gridStatus = document.getElementById('gridStatus');
const searchResultEl = document.getElementById('searchResult');
const searchInput = document.getElementById('searchInput');

async function loadTodayDeal() {
  const res = await fetch('/api/products?section=category&category=today_deal');
  const data = await res.json();
  if (data.items.length) {
    todayDealCategory.style.display = '';
    todayDealRow.innerHTML = data.items.map(cardHtml).join('');
  }
}

async function loadPopular() {
  const res = await fetch('/api/products?section=popular');
  const data = await res.json();
  popularRow.innerHTML = data.items.map(cardHtml).join('') || '<div class="empty">등록된 상품이 없습니다.</div>';
}

let gridPage = 1;
let gridLoading = false;
let gridHasMore = true;

async function loadMoreProducts() {
  if (gridLoading || !gridHasMore) return;
  gridLoading = true;
  gridStatus.textContent = '불러오는 중...';

  const res = await fetch(`/api/products?section=all&page=${gridPage}`);
  const data = await res.json();

  if (gridPage === 1 && data.items.length === 0) {
    gridEl.innerHTML = '<div class="empty">등록된 상품이 없습니다.</div>';
  } else {
    gridEl.insertAdjacentHTML('beforeend', data.items.map(cardHtml).join(''));
  }

  gridPage += 1;
  gridHasMore = gridPage <= Math.ceil(data.total / data.pageSize);
  gridStatus.textContent = '';
  gridLoading = false;
}

const gridObserver = new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting) loadMoreProducts();
}, { rootMargin: '400px' });
gridObserver.observe(gridSentinel);

let searchTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(searchInput.value.trim()), 250);
});

async function runSearch(q) {
  if (!q) {
    searchResultEl.style.display = 'none';
    searchResultEl.innerHTML = '';
    return;
  }
  const res = await fetch('/api/products?q=' + encodeURIComponent(q));
  const data = await res.json();
  searchResultEl.style.display = '';
  if (data.items.length === 0) {
    searchResultEl.innerHTML = '<div class="empty">검색 결과가 없습니다.</div>';
  } else {
    searchResultEl.innerHTML = `
      <div class="result-title">검색 결과 (${data.items.length})</div>
      <div class="grid">${data.items.map(cardHtml).join('')}</div>`;
  }
}

function productDetailHtml(item) {
  const links = item.links
    .map((l) => `<a class="link-chip" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" data-id="${item.id}">${esc(l.label)}</a>`)
    .join('');
  const video = item.youtubeEmbed
    ? `<div class="video-embed"><iframe src="${esc(item.youtubeEmbed)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`
    : '';
  const instagram = item.instagramUrl
    ? `<a class="link-chip" href="${esc(item.instagramUrl)}" target="_blank" rel="noopener noreferrer" data-id="${item.id}">인스타그램 게시물 보기</a>`
    : '';
  const threads = item.threadsEmbedHtml ? `<div class="threads-embed">${item.threadsEmbedHtml}</div>` : '';
  return `
    <div class="product-detail">
      <a class="product-image" href="${esc(item.detailLink)}" target="_blank" rel="noopener noreferrer" data-id="${item.id}">
        <img src="${esc(item.image)}" alt="" referrerpolicy="no-referrer" onerror="handleImgError(this)">
      </a>
      <div class="product-title">${esc(item.title)}</div>
      ${links || instagram ? `<div class="product-links">${links}${instagram}</div>` : ''}
      ${video}
      ${threads}
    </div>`;
}

function loadThreadsEmbedScript() {
  const script = document.createElement('script');
  script.src = 'https://www.threads.com/embed.js';
  script.async = true;
  document.body.appendChild(script);
}

async function showProduct(id) {
  const res = await fetch('/api/products?id=' + encodeURIComponent(id));
  const data = await res.json();
  searchResultEl.style.display = '';
  if (data.items.length) {
    searchInput.value = data.items[0].title;
    searchResultEl.innerHTML = productDetailHtml(data.items[0]);
    if (data.items[0].threadsEmbedHtml) loadThreadsEmbedScript();
  } else {
    searchResultEl.innerHTML = '<div class="empty">상품을 찾을 수 없습니다.</div>';
  }
}

const initialParams = new URLSearchParams(location.search);
const initialId = initialParams.get('p');
const initialQuery = initialParams.get('q');
loadTodayDeal();
loadPopular();
loadMoreProducts();
if (initialId) {
  showProduct(initialId);
} else if (initialQuery) {
  searchInput.value = initialQuery;
  runSearch(initialQuery.trim());
}
