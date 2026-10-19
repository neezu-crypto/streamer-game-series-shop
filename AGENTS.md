# 스트리머 게임 시리즈 상점 작업 지침

- 상위 `/Users/jaechanpark/Documents/GitHub/AGENTS.md`의 공통 Firebase·GitHub Pages 지침을 따른다.
- 이 사이트는 `neezu-crypto.github.io`의 경로 기반 GitHub Pages로 운영한다. 게임 감정표현은 모든 페이지에서 같은 `soop-stock-market` 프로젝트의 이름 있는 Firebase 앱 `gameSeriesEmotes`를 사용한다. 이 전용 세션으로 게임별 기존 로그인은 유지하면서 스티커 소유권과 실시간 표시를 페이지 간 공유한다. 상점의 구매/계정 UI도 추가할 때 이 앱 이름과 프로젝트 설정을 사용한다.
- `catalog/stickers.json`과 그 이미지 파일은 공개 데이터다. 공개가 승인된 상품만 추가하고, 비밀값이나 사용자별 구매·소유권 정보를 여기에 저장하지 않는다.
- `gameSeriesShop/ownership/{uid}/{productId}`는 Cloud Functions만 읽고 쓰는 소유권 기록이다. 클라이언트가 보낸 UID나 가격을 신뢰하지 않고, 구매 확인이 끝난 서버 경로만 여기에 기록한다.
- 클라이언트는 `gameSeriesShop/emoteEvents`만 실시간으로 읽으며, 이벤트 전송·구매 상태 확인은 callable을 사용한다. 공개 읽기 규칙을 바꿀 때는 공유 `database.rules.json` 여섯 사본을 동기화하고 기존 규칙 배포 절차를 따른다.
- Pages 배포 아티팩트는 `.github/workflows/pages.yml`에 열거된 정적 웹 파일만 포함한다. 브라우저 확장프로그램이나 확장프로그램 패키지는 이 저장소와 Pages 산출물에 넣지 않는다.
