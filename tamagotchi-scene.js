// 무대 배치(평상시 방·욕실·병실): 배경 그림 좌표에 펫을 맞춘다. 상점 분양소와 팬페이지 돌봄 화면이 같이 쓴다.
const ROOM = { w: 1585, h: 992, pillow: [712, 690], petWidth: 330 }; // 병실: 베개 위
// 평상시 방: 방석이 펫 발밑에. petUnits: 기본 보기(무대 944px·펫 352px)에서 펫 너비를 그림 좌표로 잰 값
const HOME = { w: 1585, h: 992, seat: [795, 792], petUnits: 590 };
const BATH = { w: 1585, h: 992, water: [785, 606], scale: 0.875, sink: 0.6 };

export function createScene({ stage, pet, reduced = false, maxPetRatio = Infinity, home = null }) { // home: 다른 방 그림 좌표(객체 또는 무대마다 고르는 함수) // maxPetRatio: 무대 너비 대비 펫 최대 비율(좁은 화면용)
  let inBath = false; let onBed = false; let bedTimer = 0;
  function front(cls) { if (!stage.querySelector(`.${cls}`)) { const f = document.createElement('div'); f.className = cls; f.setAttribute('aria-hidden', 'true'); stage.append(f); } }
  const H = () => (typeof home === 'function' ? home() : home) || HOME;
  function homeK(s, p) {
    const HOME = H();
    const fx = p.left - s.left + p.width / 2; const fy = p.top - s.top + p.height * 0.95;
    const k = Math.max(s.width / HOME.w, s.height / HOME.h, fx / HOME.seat[0], (s.width - fx) / (HOME.w - HOME.seat[0]),
      fy / HOME.seat[1], (s.height - fy) / (HOME.h - HOME.seat[1]));
    return { k, fx, fy };
  }
  function setHome(k, fx, fy) {
    const HOME = H();
    stage.style.setProperty('--home-size', `${(HOME.w * k).toFixed(1)}px ${(HOME.h * k).toFixed(1)}px`);
    stage.style.setProperty('--home-pos', `${(fx - HOME.seat[0] * k).toFixed(1)}px ${(fy - HOME.seat[1] * k).toFixed(1)}px`);
  }
  // 일반·크게 보기의 구도(펫 : 방석 : 방)가 같도록 배경 배율 k에 맞춰 펫 너비도 정한다(펫 너비 = petUnits × k).
  function alignHome() {
    if (!stage || !pet || pet.style.transform) return; // 산책·입원·욕실처럼 펫이 옮겨진 동안은 그대로
    for (let i = 0; i < 3; i += 1) {
      const s = stage.getBoundingClientRect(); const p = pet.getBoundingClientRect();
      if (!s.width || !p.width) return;
      const { k, fx, fy } = homeK(s, p);
      const want = Math.min(H().petUnits * k, s.height * 0.62, s.width * maxPetRatio);
      if (Math.abs(want - p.width) < 2) { setHome(k, fx, fy); return; }
      pet.style.width = `${want.toFixed(1)}px`;
    }
    const s = stage.getBoundingClientRect(); const p = pet.getBoundingClientRect();
    const { k, fx, fy } = homeK(s, p); setHome(k, fx, fy);
  }
  function placeInBath(on) {
    front('tg-bath-front');
    if (!on) { pet.style.transform = ''; return; }
    const prev = pet.style.transform; const prevT = pet.style.transition; pet.style.transition = 'none'; pet.style.transform = '';
    const s = stage.getBoundingClientRect(); const p = pet.getBoundingClientRect();
    pet.style.transform = prev; void pet.offsetWidth; pet.style.transition = prevT;
    const k = Math.max(s.width / BATH.w, s.height / BATH.h);
    const ox = (s.width - BATH.w * k) / 2; const oy = (s.height - BATH.h * k) / 2;
    const tx = ox + BATH.water[0] * k; const ty = oy + BATH.water[1] * k;
    const cx = p.left - s.left + p.width / 2; const cy = p.top - s.top + p.height / 2;
    const dy = ty - (cy + (BATH.sink - 0.5) * p.height * BATH.scale);
    pet.style.transform = `translate(${(tx - cx).toFixed(1)}px, ${dy.toFixed(1)}px) scale(${BATH.scale})`;
  }
  function setBath(on) {
    if (on === inBath) return;
    inBath = on; stage.classList.toggle('is-bath', on);
    pet.style.transition = reduced ? 'none' : 'transform .5s ease';
    placeInBath(on);
    setTimeout(() => { pet.style.transition = ''; if (!on) alignHome(); }, reduced ? 0 : 520);
  }
  function bedResize() { clearTimeout(bedTimer); bedTimer = setTimeout(() => { if (onBed) placeOnBed(true); }, 200); }
  function placeOnBed(on) {
    front('tg-hospital-front');
    // 침대에 없던 펫은 건드리지 않는다(산책처럼 다른 곳에서 옮긴 크기·위치를 지우지 않게)
    if (!on) { if (onBed) pet.style.transform = ''; onBed = false; window.removeEventListener('resize', bedResize); return; }
    onBed = true;
    pet.style.transform = '';
    const s = stage.getBoundingClientRect(); const p = pet.getBoundingClientRect();
    const k = Math.max(s.width / ROOM.w, s.height / ROOM.h);
    const ox = (s.width - ROOM.w * k) / 2; const oy = (s.height - ROOM.h * k) / 2;
    const tx = ox + ROOM.pillow[0] * k; const ty = oy + ROOM.pillow[1] * k;
    const scale = (ROOM.petWidth * k) / p.width;
    const cx = p.left - s.left + p.width / 2; const cy = p.top - s.top + p.height / 2;
    pet.style.transform = `translate(${(tx - cx).toFixed(1)}px, ${(ty - cy).toFixed(1)}px) scale(${scale.toFixed(3)})`;
    window.addEventListener('resize', bedResize);
  }
  function setHospital(on) { stage.classList.toggle('is-hospital', on); placeOnBed(on); }
  function relayout() { requestAnimationFrame(() => { alignHome(); if (onBed) placeOnBed(true); if (inBath) placeInBath(true); }); }
  return { alignHome, setBath, placeInBath, placeOnBed, setHospital, relayout, inBath: () => inBath,
    destroy() { window.removeEventListener('resize', bedResize); clearTimeout(bedTimer); } };
}
