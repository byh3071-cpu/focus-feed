---
id: focus-feed-agents-md
date: 2026-05-18
tags: [focus-feed, cursor, agents]
---

# Focus Feed — Cursor Agent 지침

## 리포지토리 요약

- **이름**: Focus Feed (Youtube-Summary 저장소)
- **역할**: YouTube·RSS 통합 피드, 라디오 플레이어, Gemini AI, Supabase 로그인·동기화, Stripe Pro, 팀·북마크·플레이리스트.

## 단일 소스 우선순위

`RULES.md`는 에이전트 운영·안전·VHK 사용에 대한 헌법이다. 제품 범위와 우선순위는 아래 순서를 따른다.

1. `docs/MILESTONES.md` — 우선순위·완료 체크(M1~M6)
2. `docs/PRD.md` — 제품 범위·플랜·기능 개요 (기능 변경 시 함께 수정)
3. `README.md` — 실행 방법·환경 변수 요약·수동 점검 목록
4. `docs/DEPLOYMENT_CHECKLIST.md` — 배포 전 점검
5. `.env.example` — 허용된 환경 변수 키 목록
6. 코드 — 문서와 불일치하면 코드가 진실이면 문서를 고친다.

## 디렉터리 힌트

- `src/app` — 페이지·`route.ts` API·서버 액션
- `src/components/feed` — 피드 UI, 요약·북마크·모달 등
- `src/components/player` — 라디오 푸터·플로팅 플레이어
- `src/components/layout` — 사이드바, 모바일 드로어, 앱 레이아웃
- `src/lib` — 피드 병합, Supabase, 플랜·사용 한도, 쿠키 등
- `public` — 정적 자산, `app.webmanifest`, PWA 관련

## 작업 규칙

- 사용자가 명시적으로 요청하기 전까지 `git commit` / `git push` 하지 않음 (저장소 사용자 규칙).
- 비밀값·`.env.local` 커밋 금지.
- 변경 후 `npm run lint` (가능하면 `npm run build`, `npm run test:unit`)로 회귀 확인.
- 스타일은 같은 파일·디렉터리의 기존 패턴에 맞출 것 (불필요한 대규모 리팩터 지양).

## VHK 필수 규칙

- 먼저 `RULES.md`와 `docs/VHK_ADOPTION.md`를 읽는다.
- 직접 `vhk`/`vhk.cmd`/`npx vhk`를 실행하지 않고 `npm run vhk -- <command>`를 사용한다.
- 작업 종료 전 `npm run vhk:policy`를 실행한다.
- VHK 자체 crash·오탐·미탐·예상 밖 파일 변경을 재현하면 `npm run vhk:incident -- ...`로 기록하고 `npm run vhk:draft -- <id>`로 비밀값 제거 draft를 만든다.
- 외부 게시 전 사용자에게 draft와 공개 범위를 보여주고 명시적 승인을 받은 뒤 `npm run vhk:report -- <id> --approved`로 VHK GitHub 이슈를 등록한다.
- 확인된 VHK 결함은 이슈 URL이 incident에 연결되기 전까지 완료로 선언하지 않는다.
- 앱 코드·테스트·환경 변수·외부 서비스 실패를 VHK 이슈로 등록하지 않는다.
- `vhk sync`, `save`, `undo`, `deploy`, `publish`, `migrate`, `start`, `init`, `mcp-init`은 사용자 명시 승인 없이 실행하지 않는다.

## 한국어·문서

- 사용자 대화는 한국어 선호(프로젝트 설정 기준).
- 새 `.md` 작성 시 저장소 규칙에 따라 YAML 프론트매터(`id`, `date`, `tags`)를 둘 수 있음.

## 오래된 문서

- `CURSOR_HANDOFF.md` — 과거 Supabase 페이즈 안내; 현재 구현과 다를 수 있음. 모순 시 `docs/PRD.md`·`docs/MILESTONES.md`와 코드를 따른다.

<!-- YOHAN-ROSTER-CARD:BEGIN (managed by yohan-brain ops/propagation — SoT를 고쳐라, 직접수정 금지) -->
## 상시 지휘자 — 라우팅 카드 (yohan ecosystem)

> SoT: yohan-brain `memory/core/agent-roster.yaml` `conductor_always_on` (v0.5+, status=active면 obey).
> 이 레포 자체 규칙(RULES/CLAUDE LIVE)이 있으면 그게 우선(precedence).

- 모든 태스크: 해법 구상 **전에** 크기 판정 → `라우팅: S|M|L — 계획 1줄 (근거: 파일수/신규설계/리스크)` 선언 후 진행. 키워드("풀개발") 불필요, 항상.
- **판정법(감 금지)**: ①하드 트리거 먼저 → 해당 시 즉시 확정 · ②없으면 예상 수정 파일 수를 먼저 세고 구간 매핑(≤2=S·3~6=M·≥7/다레포=L). LLM 자유분류는 불안정(실측 33~56%) — 파일수 결정론이 정답.
- **S**(≤2파일·신규설계 없음·≤15분): 지휘자 단독. 서브에이전트·orca 금지(오버헤드).
- **M**(3~6파일·부분 신규): 서브에이전트 티어링 — 탐색 haiku → 계획 opus(승인) → 구현 sonnet → 적대검증 opus/fable 루프.
- **L**(≥7파일·신규 모듈·다레포·릴리즈급): Plan 승인★ 뒤 실행 provider를 별도 판정한다. Orca 상태 때문에 M/S로 낮추지 않는다. "풀개발"=L 강제.
- **L provider 상태**: orca-ready(검증된 단일 Orca CLI) · native-approved(승인된 surface-native 계약) · plan-only(조사~티켓·정적검증) · blocked(안전 provider 없음).
- **Orca readiness**: selector는 ORCA_CLI_COMMAND → ORCA_DEV_REPO_ROOT의 orca-dev → Linux 비관리 orca-ide → orca 순서로 딱 한 번 선택한다. 같은 CLI로 guide·agent-context·bounded status를 확인하고 자동 폴백하지 않는다. (choose_once=true · automatic_fallback=false)
- runtime·graph가 ready가 아니면 orchestration RPC, task-list, Run·Task·Dispatch·terminal 생성을 금지한다.
- 하드 트리거(분류 생략): 스키마 마이그레이션·인증/결제/보안·크로스레포·릴리즈 = 무조건 **L** · 오타·문서/주석만 = **S**.
- 애매하면 작은 쪽 시작 → 검증 실패(테스트/tsc/critic) 시 **재선언 후 승급**(몰래 계속 금지).
- 동시 작업 = worktree만. 같은 레포·같은 브랜치 2에이전트 금지.
- Antigravity(agy) = 보조·초안 전용(메인 지휘 금지) — 산출물은 상위 티어 검증 필수.
- AGY는 Orca inject 비지원이며 manual-send만 사용한다.
- 배포·시크릿·npm publish·main 직push = 사람 게이트(불변).
<!-- YOHAN-ROSTER-CARD:END -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
