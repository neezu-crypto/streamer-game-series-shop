# 스트리머 게임 시리즈 상점 작업 지침

- 상위 `/Users/jaechanpark/Documents/GitHub/AGENTS.md`의 공통 Firebase·GitHub Pages 지침을 따른다.
- 이 사이트는 `neezu-crypto.github.io`의 경로 기반 GitHub Pages로 운영한다. Firebase 설정을 추가할 때 시리즈와 같은 `soop-stock-market` 프로젝트, 동일한 `apiKey`·`authDomain`과 기본 앱 이름을 사용해 기존 로그인 세션 공유를 유지한다. OAuth 팝업 흐름을 사용한다.
- `catalog/stickers.json`과 그 이미지 파일은 공개 데이터다. 공개가 승인된 상품만 추가하고, 비밀값이나 사용자별 구매·소유권 정보를 여기에 저장하지 않는다.
- 구매 가격 검증, 구매 이력, 보유 여부는 향후 Cloud Functions에서 서버 인증 컨텍스트의 UID를 사용해 처리한다. 클라이언트 입력 UID·가격을 신뢰하지 않고, 브라우저에서 RTDB 사용자 경로에 직접 쓰지 않는다.
- 공유 `database.rules.json`은 임의로 추가·수정하지 않는다. 클라이언트 RTDB 접근이 필요하면 기존 여섯 규칙 사본의 동기화 절차를 먼저 확인한다.
- Pages 배포 아티팩트는 `.github/workflows/pages.yml`에 열거된 정적 웹 파일만 포함한다. 브라우저 확장프로그램이나 확장프로그램 패키지는 이 저장소와 Pages 산출물에 넣지 않는다.
