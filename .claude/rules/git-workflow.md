---
description: Git workflow conventions for the snow-weegloo-mcp-plugin repo
---

# Git workflow

- **PR은 항상 `develop` 브랜치를 타겟으로 올린다.** `latest`/`main` 등 다른 브랜치로 직접 PR을 열지 않는다.
  - `gh pr create` 시 반드시 `--base develop` 을 지정한다.

- **`latest` 브랜치에는 절대 푸시하지 않는다 (에이전트 금지).** 머지·fast-forward·force-push 모두 포함이며,
  "사용자가 서버 배포를 끝냈다"거나 "변경본 반영해줘" 같은 발언을 릴리스 승인으로 해석하지 않는다.
  - 이유: `latest`는 **사용자가 `npx weegloo` 로 설치해 가는 배포 브랜치**다. 여기에 푸시하는 순간
    매니페스트 콘텐츠 해시가 바뀌고 `ai.sn-weegloo.com/v1/version?branch=latest` 가 새 값을 서빙해,
    모든 사용자 세션에 업데이트 안내가 뜬다. 즉 푸시 = 전체 릴리스이고, PR 리뷰도 건너뛴다.
  - 에이전트의 작업 범위는 **`develop` 까지**다: `develop` 에 커밋하고, 필요하면 `--base develop` 으로 PR을 연다.
  - `latest` 로의 머지·릴리스 타이밍은 **사람이 결정**한다. 배포 순서 게이트(서버 배포 선행 등)를 발견하면
    커밋 메시지와 보고에 적어 넘기고, 실행은 하지 않는다.
