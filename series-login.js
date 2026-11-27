// series-kit login-modal — 시리즈 공통 로그인 창(2026-11-27). 원본은 비공개 저장소 series-kit, 사본을 직접 고치지 말 것.
// 로그인 3종(Google·카카오·스트리머 인증 신청/확인)과 "로그인 뒤 하던 동작 이어가기"를 한 부품으로 둔다.
// 창(dialog)·스타일은 부품이 직접 만든다. 서비스는 auth·functions와 몇 가지 설정만 넘긴다.
// 로그인 뒤 처리(지갑·권한 조회 등)는 onChange에서 서비스 코드가 한다.
//
//   import { createSeriesLogin } from './series-login.js?v=...';
//   const login = createSeriesLogin({ auth, functions, source: 'game-series-shop', kakaoAppKey: '...', onChange });
//   login.open();                       // 창 열기
//   login.open({ streamer: true });     // 스트리머 인증 화면으로 바로
//   login.require(() => doSomething()); // 로그인돼 있으면 바로 실행, 아니면 창을 열고 로그인 성공 뒤 실행
//   await login.isLoggedIn();           // Google·카카오 계정 또는 인증 스트리머면 true
//
// 브라우저 알림창(alert·confirm)은 쓰지 않는다. 안내는 창 안 상태 문구로만 보인다.
import {
  GoogleAuthProvider, linkWithPopup, signInAnonymously, signInWithCustomToken, signInWithPopup,
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';

const CSS = `
.sk-login{width:min(440px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;padding:0;border:0;border-radius:20px;background:var(--sk-login-bg,#fffdfa);color:var(--sk-login-ink,#28253e);box-shadow:0 24px 60px #0005;font:15px/1.6 system-ui,-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif}
.sk-login::backdrop{background:#0008}
.sk-login *{box-sizing:border-box}
.sk-login-shell{position:relative;padding:26px 22px 22px}
.sk-login h2{margin:0 0 4px;font-size:20px}
.sk-login p{margin:0 0 10px;color:var(--sk-login-muted,#55526a);font-size:14px}
.sk-login-close{position:absolute;top:10px;right:10px;width:44px;height:44px;border:0;border-radius:12px;background:transparent;color:inherit;font-size:24px;cursor:pointer}
.sk-login-choices{display:grid;gap:10px;margin-top:14px}
.sk-login button.sk-choice{display:flex;align-items:center;justify-content:center;gap:8px;min-height:50px;padding:10px 14px;border:1.5px solid var(--sk-login-line,#e2dbd2);border-radius:14px;background:#fff;color:#28253e;font:inherit;font-weight:700;cursor:pointer}
.sk-login button.sk-kakao{background:#fee500;border-color:#fee500;color:#191600}
.sk-login button.sk-choice:hover{filter:brightness(.97)}
.sk-login form{display:grid;gap:8px;margin-top:10px}
.sk-login label{font-size:14px;font-weight:700}
.sk-login input{width:100%;min-height:44px;padding:10px 12px;border:1px solid var(--sk-login-line,#e2dbd2);border-radius:12px;background:#fff;color:#28253e;font:inherit;font-size:16px}
.sk-login .sk-submit{min-height:48px;border:0;border-radius:12px;background:var(--sk-login-accent,#28253e);color:#fff;font:inherit;font-weight:700;cursor:pointer}
.sk-login .sk-sub{min-height:44px;border:1px solid var(--sk-login-line,#e2dbd2);border-radius:12px;background:#fff;color:#28253e;font:inherit;font-size:14px;cursor:pointer}
.sk-login .sk-back{justify-self:start;min-height:44px;border:0;background:none;color:#5b4fd1;font:inherit;font-size:14px;cursor:pointer;padding:0}
.sk-login .sk-status{min-height:1.4em;margin-top:10px;font-size:14px;color:#b0284f;line-height:1.6;overflow-wrap:anywhere}
.sk-login .sk-status.ok{color:#22804a}
.sk-login [hidden]{display:none!important}
.sk-login button:disabled{opacity:.55;cursor:wait}
`;

function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

export function createSeriesLogin({
  auth, functions, source, kakaoAppKey = 'ed4f01d6903ca41d5dc0ab32b6ae143c',
  verifySearchFunction = 'streamerFanPageVerifySearch', soopSearchScript = './soop-verify-search.js?v=20261118-svs1',
  title = '계정 로그인', intro = 'Google·카카오 계정이나 스트리머 인증으로 로그인해요. 시리즈 전체에서 같은 계정을 써요.',
  onChange = () => {},
} = {}) {
  if (!auth || !functions) throw new Error('createSeriesLogin: auth·functions가 필요해요.');
  const call = (name) => httpsCallable(functions, name);
  const linkGoogleAccount = call('linkGoogleAccount');
  const linkKakaoAccount = call('linkKakaoAccount');
  const requestStreamerVerification = call('requestStreamerVerification');
  let pending = null; // 로그인 성공 뒤 이어서 할 동작
  let verifiedCache = { uid: '', value: false };

  if (!document.getElementById('sk-login-style')) {
    const style = document.createElement('style'); style.id = 'sk-login-style'; style.textContent = CSS; document.head.append(style);
  }
  const dlg = el(`<dialog class="sk-login" aria-labelledby="skLoginTitle"><div class="sk-login-shell">
    <button type="button" class="sk-login-close" data-sk="close" aria-label="로그인 창 닫기">×</button>
    <h2 id="skLoginTitle"></h2><p data-sk="intro"></p>
    <div class="sk-login-choices" data-sk="choices">
      <button type="button" class="sk-choice" data-sk="google">🔵 Google로 로그인</button>
      <button type="button" class="sk-choice sk-kakao" data-sk="kakao">💬 카카오로 로그인</button>
      <button type="button" class="sk-choice" data-sk="streamer">🎙️ 스트리머 인증하기(신청/확인)</button>
    </div>
    <form data-sk="form" hidden novalidate>
      <button type="button" class="sk-back" data-sk="back">← 로그인 방법으로 돌아가기</button>
      <p>SOOP에서 본인을 검색해 신청하고, 안내되는 코드를 SOOP 쪽지로 보내면 자동 승인돼요.</p>
      <label for="skLoginNick">SOOP 닉네임</label>
      <input id="skLoginNick" type="text" maxlength="40" autocomplete="off">
      <label for="skLoginSoopId">SOOP 아이디</label>
      <input id="skLoginSoopId" type="text" maxlength="20" autocapitalize="off" autocomplete="off" spellcheck="false">
      <button type="submit" class="sk-submit" data-sk="submit">스트리머 인증 신청</button>
      <button type="button" class="sk-sub" data-sk="check">인증 상태 확인</button>
      <button type="button" class="sk-sub" data-sk="renew">새 코드 발급 (이전 코드 무효화)</button>
    </form>
    <div class="sk-status" data-sk="status" role="status" aria-live="polite"></div>
  </div></dialog>`);
  dlg.querySelector('#skLoginTitle').textContent = title;
  dlg.querySelector('[data-sk=intro]').textContent = intro;
  document.body.append(dlg);
  const $ = (k) => dlg.querySelector(`[data-sk=${k}]`);
  const status = (text, ok = false) => { $('status').textContent = text || ''; $('status').classList.toggle('ok', ok); };
  const busy = (on) => dlg.querySelectorAll('button:not([data-sk=close])').forEach((b) => { b.disabled = on; });

  function showStreamerForm(on) {
    $('choices').hidden = on; $('form').hidden = !on;
    $('form').classList.remove('svs-pending');
    dlg.querySelector('#skLoginNick').value = ''; dlg.querySelector('#skLoginSoopId').value = '';
    status('');
  }
  function open(options = {}) {
    if (typeof options.then === 'function') pending = options.then;
    showStreamerForm(options.streamer === true);
    if (!dlg.open) dlg.showModal();
  }
  function close() { if (dlg.open) dlg.close(); }
  dlg.addEventListener('close', () => { busy(false); });

  // 로그인 성공: 창을 닫고, 서비스에 알리고, 미뤄 둔 동작을 이어서 실행한다.
  async function done() {
    verifiedCache = { uid: '', value: false };
    close();
    try { await onChange(auth.currentUser); } catch (e) { console.error('로그인 후 처리 실패:', e); }
    const next = pending; pending = null;
    if (next) { try { await next(); } catch (e) { console.error('로그인 후 이어서 하던 동작 실패:', e); } }
  }

  async function isLoggedIn() {
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user) return false;
    if (!user.isAnonymous) return true;
    // 스트리머 인증은 익명 UID를 그대로 쓴다 → 서버 확인 전용 호출로 판정(신청·코드를 만들지 않음).
    if (verifiedCache.uid === user.uid) return verifiedCache.value;
    try {
      const r = await requestStreamerVerification({ checkOnly: true, source });
      const a = r.data && r.data.action;
      verifiedCache = { uid: user.uid, value: a === 'already-verified' || a === 'auto-approved' };
    } catch { verifiedCache = { uid: user.uid, value: false }; }
    return verifiedCache.value;
  }
  async function require(fn) {
    if (await isLoggedIn()) return fn();
    open({ then: fn });
    return undefined;
  }

  async function loginWithGoogle() {
    busy(true); status('Google 로그인 창을 기다리고 있어요.');
    try {
      const provider = new GoogleAuthProvider();
      if (auth.currentUser?.isAnonymous) {
        try { await linkWithPopup(auth.currentUser, provider); }
        catch (error) {
          if (error?.code !== 'auth/credential-already-in-use' && error?.code !== 'auth/email-already-in-use') throw error;
          await signInWithPopup(auth, new GoogleAuthProvider()); // 이미 다른 계정에 연결된 Google → 그 계정으로 전환
        }
      } else await signInWithPopup(auth, provider);
      await linkGoogleAccount();
      await done();
    } catch (error) {
      busy(false);
      if (error?.code === 'auth/popup-closed-by-user' || error?.code === 'auth/cancelled-popup-request') { status(''); return; }
      console.error('Google 로그인 실패:', error);
      status(`Google 로그인에 실패했어요. ${error?.message || error}`);
    }
  }

  function loginWithKakao() {
    if (typeof window.Kakao === 'undefined') { status('카카오 로그인을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'); return; }
    if (!window.Kakao.isInitialized()) window.Kakao.init(kakaoAppKey);
    busy(true); status('카카오 로그인 창을 기다리고 있어요.');
    window.Kakao.Auth.login({
      success: async (kakaoAuth) => {
        try {
          const result = await linkKakaoAccount({ kakaoAccessToken: kakaoAuth.access_token });
          if (result.data?.action === 'switch') await signInWithCustomToken(auth, result.data.customToken);
          await done();
        } catch (error) {
          busy(false); console.error('카카오 로그인 실패:', error);
          status(`카카오 로그인에 실패했어요. ${error?.message || error}`);
        }
      },
      fail: () => { busy(false); status('카카오 로그인이 취소되었거나 실패했어요.'); },
    });
  }

  async function submitStreamer(data) {
    busy(true); status('스트리머 인증 상태를 확인하고 있어요.');
    try {
      await auth.authStateReady();
      if (!auth.currentUser) await signInAnonymously(auth);
      const result = await requestStreamerVerification({ ...data, source });
      const p = result.data || {};
      if (p.action === 'switch' && p.customToken) { await signInWithCustomToken(auth, p.customToken); await done(); return; }
      if (p.action === 'already-verified' || p.action === 'auto-approved') { await done(); return; }
      const expiresAt = Number(p.verificationCodeExpiresAt) || 0;
      const liveCode = p.verificationCode && expiresAt > Date.now() ? p.verificationCode : '';
      if (liveCode) {
        const minutes = Math.max(1, Math.round((expiresAt - Date.now()) / 60000));
        status(`인증 신청이 접수됐어요. 인증 코드: ${liveCode} (${minutes}분 안에 SOOP 쪽지로 보내 주세요) 보낸 뒤 [인증 상태 확인]을 눌러 주세요.`, true);
      } else if (p.noteEligible === false) {
        status('인증 신청이 접수됐어요. 관리자 확인 후 [인증 상태 확인]을 눌러 주세요.', true);
      } else {
        status(data.checkOnly
          ? '아직 인증 확인 전이에요. 코드가 만료됐다면 [새 코드 발급]을 눌러 주세요.'
          : '인증 신청이 접수되어 있어요. 코드를 잃어버렸거나 만료됐다면 [새 코드 발급]을 눌러 주세요.');
      }
      $('form').classList.add('svs-pending');
    } catch (error) {
      console.error('스트리머 인증 처리 실패:', error);
      status(`인증 처리를 완료하지 못했어요. ${error?.message || error}`);
    } finally { busy(false); }
  }

  $('close').addEventListener('click', () => { pending = null; close(); });
  dlg.addEventListener('cancel', () => { pending = null; });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) { pending = null; close(); } });
  $('google').addEventListener('click', loginWithGoogle);
  $('kakao').addEventListener('click', loginWithKakao);
  $('streamer').addEventListener('click', () => showStreamerForm(true));
  $('back').addEventListener('click', () => showStreamerForm(false));
  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const nickname = dlg.querySelector('#skLoginNick').value.trim();
    const soopId = dlg.querySelector('#skLoginSoopId').value.trim().toLowerCase();
    if (!nickname) { status('SOOP 닉네임을 입력해 주세요.'); return; }
    if (!/^[a-z0-9]{2,20}$/.test(soopId)) { status('SOOP 아이디는 영문 소문자·숫자 2~20자로 입력해 주세요.'); return; }
    void submitStreamer({ nickname, soopId });
  });
  $('check').addEventListener('click', () => void submitStreamer({ checkOnly: true }));
  $('renew').addEventListener('click', () => void submitStreamer({ renewCode: true }));

  // SOOP 검색 위젯(공통 부품 soop-verify-search)을 붙인다. 검색은 로그인 없이 익명 세션으로 한다.
  const searchFn = call(verifySearchFunction);
  const attach = () => {
    if (!window.attachSoopVerifySearch) return;
    window.attachSoopVerifySearch({
      nicknameInput: 'skLoginNick', soopIdInput: 'skLoginSoopId',
      steps: {
        root: $('form'),
        isPending: () => $('form').classList.contains('svs-pending'),
        afterSelect: [$('submit')],
        pendingOnly: [$('check'), $('renew')],
      },
      search: async (query) => {
        await auth.authStateReady();
        if (!auth.currentUser) await signInAnonymously(auth);
        const r = await searchFn({ query });
        return (r.data && r.data.streamers) || [];
      },
    });
  };
  if (window.attachSoopVerifySearch) attach();
  else if (soopSearchScript) {
    const s = document.createElement('script'); s.src = new URL(soopSearchScript, document.baseURI).href; s.onload = attach; document.head.append(s);
  }

  return { open, close, require, isLoggedIn, dialog: dlg };
}
