const productGrid = document.getElementById('product-grid');
const productCount = document.getElementById('product-count');
const dialog = document.getElementById('preview-dialog');
const stickerGrid = document.getElementById('sticker-grid');
const toast = document.getElementById('toast');
let toastTimer;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function renderProduct(product) {
  const previewCount = product.preview?.stickers?.length || 0;
  const card = document.createElement('article');
  card.className = 'product-card';
  card.innerHTML = `
    <div class="product-art">
      <img src="${escapeHtml(product.cover)}" alt="${escapeHtml(product.title)} 스티커 여덟 종 미리보기">
      <span class="preview-tag"><span aria-hidden="true">✦</span> 미리보기</span>
      <span class="art-count">${previewCount} DESIGNS</span>
    </div>
    <div class="product-info">
      <div class="product-meta"><span>STICKERS · VOL. 01</span><span class="coming-label">COMING SOON</span></div>
      <h3>${escapeHtml(product.title)}</h3>
      <p class="product-subtitle">${escapeHtml(product.subtitle)}</p>
      <div class="product-bottom">
        <span class="price-label">출시 준비 중</span>
        <button class="preview-button" type="button" data-preview="${escapeHtml(product.id)}" title="${escapeHtml(product.title)} 스티커 미리보기">미리보기 <span aria-hidden="true">↗</span></button>
      </div>
    </div>
  `;
  return card;
}

function renderSticker(product, sticker, index) {
  const columns = Math.max(1, Number(product.preview?.columns) || 1);
  const rows = Math.max(1, Number(product.preview?.rows) || 1);
  const column = index % columns;
  const row = Math.floor(index / columns);
  const x = columns === 1 ? 0 : (column / (columns - 1)) * 100;
  const y = rows === 1 ? 0 : (row / (rows - 1)) * 100;
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'sticker-tile';
  tile.title = sticker.label + ' 미리보기';
  tile.innerHTML = `
    <span class="sticker-art" role="img" aria-label="${escapeHtml(sticker.alt)}"></span>
    <span class="sticker-label">${escapeHtml(sticker.label)}</span>
  `;
  const art = tile.querySelector('.sticker-art');
  art.style.backgroundImage = `url("${encodeURI(product.preview.asset)}")`;
  art.style.backgroundSize = `${columns * 100}% ${rows * 100}%`;
  art.style.backgroundPosition = `${x}% ${y}%`;
  tile.addEventListener('click', () => {
    tile.classList.toggle('selected');
    showToast(tile.classList.contains('selected') ? sticker.label : '미리보기 선택을 해제했어요');
  });
  return tile;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 1700);
}

function openPreview(product) {
  document.getElementById('dialog-title').textContent = product.title + ' 미리보기';
  stickerGrid.replaceChildren(...product.preview.stickers.map((sticker, index) => renderSticker(product, sticker, index)));
  dialog.showModal();
}

async function loadCatalog() {
  try {
    const response = await fetch('catalog/stickers.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('상품 카탈로그를 불러오지 못했습니다.');
    const catalog = await response.json();
    const products = (catalog.products || []).filter((product) => product.categoryId === catalog.category.id);
    productGrid.replaceChildren(...products.map(renderProduct));
    productCount.textContent = String(products.length).padStart(2, '0');
    productGrid.querySelectorAll('[data-preview]').forEach((button) => {
      button.addEventListener('click', () => {
        const product = products.find((item) => item.id === button.dataset.preview);
        if (product) openPreview(product);
      });
    });
  } catch (error) {
    productGrid.innerHTML = '<div class="empty-card"><strong>상점을 불러오지 못했어요.</strong><span>잠시 후 다시 열어 주세요.</span></div>';
    productCount.textContent = '—';
    console.error(error);
  }
}

document.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && dialog.open) dialog.close();
});

loadCatalog();