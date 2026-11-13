// 다마고치 보석 상점 화면(공용): 팬페이지 돌봄 화면의 상점 창과 월드맵 보석 상점이 같이 쓴다.
// 설계: streamer-fanpage docs/다마고치_보석상점_꾸미기_설계.md, docs/다마고치_월드맵_보석상점_설계.md
// - 가격·보유·권한(shop.manage)은 서버 status 응답(shop)만 믿는다. 사기 확인은 confirm() 대신 두 번 누르기.
// - 서버 호출은 바깥에서 받는다(call(payload) → 응답 data). 응답을 받으면 onApplied(data)로 돌려준다.
import { createMongsil, wearImageUrl } from './tamagotchi-pet.js?v=20261114-tg-wear1';

const SLOT_WORD = { head: '머리', face: '얼굴', neck: '목', back: '등' };
function el(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; }

// 카드 상태(순수 함수: 테스트 대상). armed: 한 번 누른 버튼 키
export function cardState(item, { manage, gems, busy, armed }) {
  if (!manage) return { kind: 'view' };
  if (!item.owned) {
    const key = `buy:${item.id}`;
    return { kind: 'buy', key, label: armed === key ? '한 번 더 누르면 사요' : `💎${item.price} 사기`, disabled: !!busy || gems < item.price };
  }
  return { kind: 'equip', label: item.equipped ? '벗기기' : '입기', disabled: !!busy };
}
export function snackState(snack, { gems, busy, armed }) {
  const s = snack || {};
  return { label: armed === 'snack' ? '한 번 더 누르면 줘요' : `💎${s.price} 간식 주기`, disabled: !!busy || !(s.leftToday > 0) || gems < (Number(s.price) || 0) };
}

// host 안에 미리보기 펫 + 카드를 그린다. getServer(): 최신 status 응답
export function mountGemShop(host, { getServer, petColor = 'cream', call, onApplied = () => {}, hasAccount = () => false, openLogin = () => {}, onSnack = () => {}, footer = '', viewNote = '꾸미기는 스트리머가 골라 입혀 줄 수 있어요. 입혀 보기는 누구나 할 수 있어요.' }) {
  const root = el('div', 'tg-gem-shop');
  const gemsEl = el('p', 'tg-gem-shop-gems');
  const previewBox = el('div', 'tg-shop-preview');
  const state = el('p', 'tg-gem-shop-state'); state.setAttribute('role', 'status'); state.setAttribute('aria-live', 'polite');
  const grid = el('div', 'tg-shop-grid');
  root.append(gemsEl, previewBox, state, grid);
  if (footer) root.append(el('p', 'tg-gem-shop-foot', footer));
  host.append(root);
  const preview = createMongsil(previewBox, { color: petColor, reduced: true, wear: getServer()?.shop?.equipped || {} });
  let tryOn = null; let armed = ''; let busy = false; let destroyed = false;

  async function act(payload, done) {
    if (!hasAccount()) { openLogin(); return; }
    busy = true; render();
    try { const data = await call(payload); onApplied(data); state.textContent = done; return true; }
    catch (error) { state.textContent = error?.message || '처리하지 못했어요.'; return false; }
    finally { busy = false; armed = ''; if (!destroyed) render(); }
  }
  function render() {
    if (destroyed) return;
    const server = getServer(); const shop = server?.shop; if (!shop) return;
    const manage = !!shop.manage; const gems = Number(server.gems) || 0;
    gemsEl.textContent = `💎 금고 ${gems}/${server.gemMax ?? 60}`;
    const wear = { ...(shop.equipped || {}) }; if (tryOn) wear[tryOn.slot] = tryOn.id;
    preview.setWear(wear);
    grid.replaceChildren();
    for (const it of shop.items || []) {
      const card = el('div', 'tg-shop-card'); if (it.equipped) card.classList.add('is-on');
      const img = el('img'); img.src = wearImageUrl(it.id); img.alt = ''; img.loading = 'lazy';
      const meta = el('small', '', `${SLOT_WORD[it.slot] || ''} · 💎${it.price}${it.equipped ? ' · 착용 중' : it.owned ? ' · 보유' : ''}`);
      const tryBtn = el('button', 'tg-button', tryOn?.id === it.id ? '입혀 보기 끄기' : '입혀 보기'); tryBtn.type = 'button';
      tryBtn.addEventListener('click', () => { tryOn = tryOn?.id === it.id ? null : it; render(); });
      card.append(img, el('strong', '', it.name), meta, tryBtn);
      const cs = cardState(it, { manage, gems, busy, armed });
      if (cs.kind !== 'view') {
        const btn = el('button', `tg-button${cs.kind === 'buy' ? ' tg-button-primary' : ''}`, cs.label); btn.type = 'button'; btn.disabled = cs.disabled;
        btn.addEventListener('click', () => {
          if (cs.kind === 'buy') {
            if (armed !== cs.key) { armed = cs.key; render(); return; }
            tryOn = null; void act({ action: 'buy', itemId: it.id }, `${it.name}을(를) 샀어요! 바로 입혔어요. ✦`).then((ok) => { if (ok) preview.play?.('기쁨'); });
          } else { tryOn = null; void act({ action: 'equip', slot: it.slot, itemId: it.equipped ? '' : it.id }, it.equipped ? '벗겼어요.' : '입혔어요.'); }
        });
        card.append(btn);
      }
      grid.append(card);
    }
    const sn = shop.snack || {}; const card = el('div', 'tg-shop-card');
    const img = el('img'); img.src = wearImageUrl('snack'); img.alt = '';
    card.append(img, el('strong', '', '달콤 간식'), el('small', '', `💎${sn.price} · 배부름·기분 업 · 오늘 ${sn.leftToday}/${sn.perDay}번 남음`));
    const ss = snackState(sn, { gems, busy, armed });
    const btn = el('button', 'tg-button tg-button-primary', ss.label); btn.type = 'button'; btn.disabled = ss.disabled;
    btn.addEventListener('click', () => {
      if (!hasAccount()) { openLogin(); return; }
      if (armed !== 'snack') { armed = 'snack'; render(); return; }
      void act({ action: 'snack' }, '냠냠! 간식을 줬어요. 유대감 +3 ✦').then((ok) => { if (ok) { preview.play?.('먹기'); onSnack(); } });
    });
    card.append(btn); grid.append(card);
    if (!manage && !state.textContent) state.textContent = viewNote;
  }
  render();
  return {
    render,
    setColor(c) { preview.setColor?.(c); },
    busy: () => busy,
    destroy() { destroyed = true; preview.destroy?.(); root.remove(); },
  };
}
