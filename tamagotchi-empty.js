// 다마고치 마을 장소(훈련소·보석 상점·펫 병원) 공통: 펫이 없을 때 안내 카드.
// own: 이 팬페이지의 인증 스트리머 본인 / admin: 관리자 미리보기 / 그 외: 팬·방문자.
function el(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = text; return n; }

// giftId: 팬 선물 모드(?gift=)로 들어온 경우 — 분양소 선물 모드로 이어 준다.
export function petEmptyCard({ place = '', streamerName = '', own = false, admin = false, giftId = '' } = {}) {
  const card = el('div', 'tw-empty-pet');
  card.append(el('span', 'tw-empty-pet-icon', '🥚'));
  card.append(el('strong', 'tw-empty-pet-title', '아직 다마고치가 없어요'));
  const who = streamerName ? `${streamerName} 님이` : '스트리머가';
  const text = giftId
    ? `${streamerName ? `${streamerName} 님에게` : '스트리머에게'} 아직 다마고치가 없어요. 분양소에서 첫 다마고치를 선물할 수 있어요. 다마고치가 생기면 여기서 재주와 이름도 선물할 수 있어요.`
    : admin
    ? '이 팬페이지에는 다마고치가 없어요. 테스트 다마고치는 분양소 아래 관리자 메뉴에서 지급할 수 있어요.'
    : own
      ? `분양소에서 첫 다마고치를 데려오면 ${place ? `${place}을(를) 비롯해 ` : ''}훈련소·보석 상점·펫 병원을 모두 이용할 수 있어요.`
      : `${who} 분양소에서 다마고치를 데려오면 팬들도 함께 돌보고 꾸미고 병문안할 수 있어요.`;
  card.append(el('p', 'tw-empty-pet-text', text));
  const go = el('a', `tg-button${own || admin || giftId ? ' tg-button-primary' : ''}`, giftId ? '🎁 분양소에서 다마고치 선물하기' : own ? '🏠 분양소에 가기' : '🏠 분양소 구경하기');
  go.href = giftId ? `tamagotchi.html?gift=${encodeURIComponent(giftId)}` : 'tamagotchi.html';
  card.append(go);
  return card;
}
