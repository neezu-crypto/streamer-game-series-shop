// App Check(2026-11-14): 이 사이트(github.io)에서 온 요청만 서버가 받도록 토큰을 붙인다.
// 같은 페이지에서 여러 모듈이 불러도 한 번만 초기화한다(팬페이지 app.js가 먼저 했으면 건너뜀).
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app-check.js';
const SITE_KEY = '6Ld0AfAtAAAAABcCio4_5AoiCdrjfM7_4riWiYXR';
export function ensureAppCheck(app) {
  if (!app || window.__seriesAppCheck) return;
  try { initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(SITE_KEY), isTokenAutoRefreshEnabled: true }); window.__seriesAppCheck = true; }
  catch (error) { console.warn('App Check 초기화 실패', error); }
}
