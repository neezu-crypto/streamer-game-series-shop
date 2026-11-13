// 마을·훈련소 버튼 효과음: 팬페이지와 같은 소리·같은 볼륨 설정(streamerFanPage.buttonClickVolume, 기본 20, 0이면 끔)을 쓴다.
// 같은 github.io 출처라 팬페이지에서 바꾼 볼륨이 그대로 적용된다.
const BASE = new URL('assets/sounds/', import.meta.url).href;
const KEY = 'streamerFanPage.buttonClickVolume';
const audios = {};
function audio(name) {
  if (!audios[name]) { const a = new Audio(`${BASE}${name}.mp3`); a.preload = 'auto'; audios[name] = a; }
  return audios[name];
}
function volume() {
  try { const v = Number(localStorage.getItem(KEY)); return localStorage.getItem(KEY) === null || !Number.isFinite(v) ? 20 : Math.max(0, Math.min(100, v)); } catch (_) { return 20; }
}
// kind: click | modal | save
export function playUiSound(kind = 'click') {
  const base = volume(); if (base <= 0) return;
  const name = kind === 'modal' ? 'modal-open' : kind === 'save' ? 'save-button' : 'button-click';
  const a = audio(name);
  a.volume = Math.min(1, (kind === 'save' ? base + 10 : base) / 100);
  try { a.currentTime = 0; } catch (_) { /* 아직 불러오는 중 */ }
  const p = a.play(); if (p?.catch) p.catch(() => {});
}
const SAVE = /저장|완료|결제/;
let inClick = false; let modalInClick = false;
// 버튼을 누른 클릭이 대화상자를 열면 모달 소리, 결제·완료 버튼은 저장 소리, 나머지는 클릭 소리.
export function installUiSound() {
  ['button-click', 'modal-open', 'save-button'].forEach(audio);
  const show = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function showModalWithSound(...args) {
    const r = show.apply(this, args);
    if (inClick) modalInClick = true; else playUiSound('modal');
    return r;
  };
  document.addEventListener('click', (event) => {
    const b = event.target instanceof Element ? event.target.closest('button, [role="button"], .tw-bld') : null;
    if (!b || b.disabled || b.hasAttribute('data-no-click-sound')) return;
    inClick = true; modalInClick = false;
    setTimeout(() => {
      inClick = false;
      const label = `${b.textContent || ''} ${b.getAttribute('aria-label') || ''}`;
      playUiSound(modalInClick ? 'modal' : SAVE.test(label) ? 'save' : 'click');
    }, 0);
  }, true);
}
