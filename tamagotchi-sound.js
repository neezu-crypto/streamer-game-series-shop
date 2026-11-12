// 상호작용 효과음(Web Audio). 출처: Pixabay(상업 이용 가능, 표기 불필요) — docs/다마고치_사운드.md
// 규칙: 자연스러운 페이드 인/아웃, 루프는 파일에 크로스페이드를 구워 넣어 이음매 없이, 도구를 고를 때만 해당 소리를 받아 온다.
// 모듈 기준 경로: 팬페이지에서 불러와도 상점의 소리 파일을 찾는다
const BASE = new URL('assets/tamagotchi/sfx/', import.meta.url).href;
const V = '?v=20261113-tg-care2';
// dur: 인코더 앞뒤 여백을 걷어 내고 정확히 반복하기 위한 원래 길이(초)
export const SOUNDS = {
  pet: { vol: 0.3, loop: true, dur: 8 },
  feed: { vol: 0.3, loop: true, dur: 10 },
  groom: { vol: 0.3, loop: true, dur: 4.5 },
  play: { vol: 0.3 },
  walk: { vol: 0.3, loop: true, dur: 7.2 },
  talk: { vol: 0.3 },
  gem: { vol: 0.15 },
  bath: { vol: 0.15, loop: true, dur: 10 },
  step: { vol: 0.03 },
  sing: { vol: 0.15, loop: true, dur: 16 },
  dance: { vol: 0.15, loop: true, dur: 20 },
  cheer: { vol: 0.15, loop: true, dur: 6.857 },
  bonus: { vol: 0.15 },
};
const FADE_IN = 0.35; const FADE_OUT = 0.6;
const KEY = 'tg-sound';

export function createSound() {
  let ctx = null; let master = null;
  let enabled = localStorage.getItem(KEY) !== 'off';
  const buffers = new Map(); // name → Promise<AudioBuffer>
  const loops = new Map(); // name → { src, gain, stopTimer, keepTimer }
  const lastOnce = new Map();

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      ctx = new AC(); master = ctx.createGain(); master.gain.value = enabled ? 1 : 0; master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  function load(name) {
    if (!SOUNDS[name]) return Promise.resolve(null);
    if (!buffers.has(name)) {
      if (!ensure()) return Promise.resolve(null);
      const p = fetch(`${BASE}${name}.mp3${V}`).then((r) => r.arrayBuffer())
        .then((data) => new Promise((ok, fail) => ctx.decodeAudioData(data, ok, fail)))
        .catch(() => { buffers.delete(name); return null; });
      buffers.set(name, p);
    }
    return buffers.get(name);
  }

  // 반복 소리: 서서히 켜고, 같은 소리를 다시 켜면 끄던 중이어도 그대로 이어 간다.
  async function start(name) {
    if (!enabled) return;
    const cur = loops.get(name);
    if (cur) { clearTimeout(cur.stopTimer); cur.stopTimer = 0; ramp(cur.gain, SOUNDS[name].vol, FADE_IN); return; }
    const entry = { src: null, gain: null, stopTimer: 0, keepTimer: 0, pending: true };
    loops.set(name, entry);
    const buf = await load(name);
    if (!buf || loops.get(name) !== entry || !entry.pending) { if (loops.get(name) === entry) loops.delete(name); return; }
    entry.pending = false;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const { dur } = SOUNDS[name];
    const extra = buf.duration - dur;
    if (dur && extra > 0.01) { src.loopStart = Math.min(extra, 1105 / buf.sampleRate); src.loopEnd = src.loopStart + dur; }
    const gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(gain).connect(master); src.start(0, src.loopStart || 0);
    entry.src = src; entry.gain = gain;
    if (entry.stopping) { loops.delete(name); fadeStop(src, gain); return; }
    ramp(gain, SOUNDS[name].vol, FADE_IN);
  }
  function stop(name) {
    const cur = loops.get(name); if (!cur) return;
    clearTimeout(cur.keepTimer);
    if (cur.pending) { cur.stopping = true; cur.pending = false; loops.delete(name); return; }
    if (cur.stopTimer) return;
    ramp(cur.gain, 0, FADE_OUT);
    cur.stopTimer = setTimeout(() => { if (loops.get(name) === cur) loops.delete(name); try { cur.src.stop(); } catch (_) { /* 무시 */ } }, FADE_OUT * 1000 + 80);
  }
  function fadeStop(src, gain) { ramp(gain, 0, FADE_OUT); setTimeout(() => { try { src.stop(); } catch (_) { /* 무시 */ } }, FADE_OUT * 1000 + 80); }
  // 상호작용이 이어지는 동안 계속 불러 주면 켜져 있고, 멈추면 holdMs 뒤 서서히 꺼진다.
  function keep(name, holdMs = 900) {
    if (!enabled) return;
    start(name);
    const cur = loops.get(name); if (!cur) return;
    clearTimeout(cur.keepTimer); cur.keepTimer = setTimeout(() => stop(name), holdMs);
  }
  function ramp(gain, to, sec) {
    const t = ctx.currentTime; gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t); gain.gain.linearRampToValueAtTime(to, t + sec);
  }
  // 한 번 소리: 너무 잦으면 건너뛴다(겹침 방지).
  async function once(name, gapMs = 250) {
    if (!enabled) return;
    const now = performance.now(); if (now - (lastOnce.get(name) || 0) < gapMs) return;
    lastOnce.set(name, now);
    const buf = await load(name); if (!buf || !enabled) return;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const gain = ctx.createGain(); gain.gain.value = SOUNDS[name].vol;
    src.connect(gain).connect(master); src.start();
  }
  function stopAll() { [...loops.keys()].forEach(stop); }
  function setEnabled(on) {
    enabled = !!on; localStorage.setItem(KEY, enabled ? 'on' : 'off');
    if (!enabled) stopAll();
    if (ctx) { ensure(); ramp(master, enabled ? 1 : 0, 0.3); }
  }
  // 탭을 떠나면 소리를 멈추고, 돌아오면 다시 켠다(반복 소리는 다음 상호작용 때 이어짐).
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) { stopAll(); ctx.suspend().catch(() => {}); } else if (enabled) ctx.resume().catch(() => {});
  });
  return { load, start, stop, keep, once, stopAll, setEnabled, enabled: () => enabled };
}
