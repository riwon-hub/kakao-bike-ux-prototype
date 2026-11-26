# 팀원 배포 설정

소유자의 승인으로 2026년 11월 26일 저장소를 공개로 전환하고 **Settings → Pages → Source → GitHub Actions**를 활성화했습니다. 코드와 이미지 파일은 누구나 볼 수 있습니다.

배포 주소: **https://riwon-hub.github.io/kakao-bike-ux-prototype/**

배포 기록과 수동 실행: **https://github.com/riwon-hub/kakao-bike-ux-prototype/actions/workflows/deploy-pages.yml**

## 팀원 사용 방법

- `main`에 머지하거나 직접 수정하면 자동으로 배포됩니다.
- 다시 배포하려면 **Actions → Deploy prototype → Run workflow → main → Run workflow**를 선택합니다.
- 저장소 쓰기 권한이 있는 팀원이 실행할 수 있습니다. 현재 `insoyeong`, `cwpark0519` 계정에 쓰기 권한이 있습니다.
- 배포 작업은 `main`만 게시합니다. 다른 브랜치를 수동 선택하면 배포하지 않습니다.
- 개인 액세스 토큰이나 기존 사이트의 인증 정보를 저장소에 넣을 필요가 없습니다.

## 주소와 데이터

GitHub Pages에서는 별도의 배포 주소를 사용합니다. 기존 `chatgpt.site` 주소는 그대로 유지되며 이 워크플로가 업데이트하지 않습니다.

설문 응답은 각 브라우저의 로컬 저장소에 보관됩니다. 새 배포 주소에는 기존 주소에서 수집한 응답이 자동으로 이동하지 않으므로, 기존 응답이 필요하면 기존 화면의 CSV 내려받기로 보관해 주세요.

## 로컬 확인

```sh
python3 scripts/build-pages.py
python3 -m http.server 8000 --directory _site
```

`_site`에 실행 파일과 에셋만 복사하고 CSS·JS 주소에 배포 버전을 붙여 최신 변경을 불러옵니다. 앱 원본 파일은 변경하지 않습니다.
