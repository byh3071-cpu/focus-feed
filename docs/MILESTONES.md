---
id: focus-feed-milestones
date: 2026-05-18
tags: [focus-feed, roadmap, milestones]
---

> **원칙**: 한 마일스톤은 **배포 가능한 단위**로 끝낸다. 완료 시 `docs/PRD.md` §9·본 문서 표를 갱신한다.

## 총괄 표

| 단계 | 이름 | 목표 | 완료 정의 |
|:----:|------|------|-----------|
| **M1** | 기준선·문서 | 단일 로드맵, PRD·체크리스트와 링크 | 본 파일·README 링크 존재 |
| **M2** | 피드 규모 | 서버 병합 상한 + 클라이언트 점진 렌더 | [x] |
| **M3** | 타입·DB 쓰기 | `src` 내 Supabase `as any` 제거, `Insert`/`Update` + `as never` | [x] |
| **M4** | 라디오 안정성 | YT 콜백에서 최신 큐 참조 | [x] |
| **M5** | 제품 확장 | 트렌드 종합 뷰·피드 Q&A | 트렌드 바+`/trends`·Q&A+PRD §4.1·002 SQL |
| **M6** | 모바일·회귀 | 잔여 터치 이슈, E2E 최소 시나리오 | MOBILE_QA 문서·Playwright·CI 전체 |
| **M7** | 품질 안정화(QA 후속) | 2026-06-11 감사 P0/P1 해소: 플레이리스트 보안, PWA 캐시, 모바일 UX, API 오류 분류 | 본 문서 M7 절·E2E 데스크톱/모바일 프로젝트 |
| **M8** | 보안·법적 정합 + 개인 연구 기반 + UX P0 | 6/11 감사 잔여 P0/P1, 콘텐츠 상태 모델, UX 시각 파손 | PR #5~#10·본 문서 M8 절 (런타임 미검증) |
| **M10** | 검색 중심 탐색 UX | 검색·트렌드·필터 통합, 보기 전환 지연 제거, 카드 CTA 정렬 | [x] |
| **M11** | 디자인 시스템·영상/플레이어 재구성 | 디자인 계약과 공통 토큰부터 홈 카드·영상 모드·라디오를 독립 배포 단위로 개편 | `docs/M11_EXECUTION_PLAN.md` 기준 진행 중 |

## M1 — 기준선·문서

- [x] `docs/MILESTONES.md` (본 문서)
- [x] `docs/PRD.md` §9 백로그와 연동
- [x] `docs/DEPLOYMENT_CHECKLIST.md`
- [x] CI에서 `lint` + `build` + `test:unit` (`.github/workflows/ci.yml`)

## M2 — 피드 규모

- [x] `getMergedFeed` 병합 후 상한 (`src/lib/feed.ts`, `MAX_MERGED_FEED_ITEMS`)
- [x] 소식통 레이아웃: 유튜브/RSS `더 보기` (기존 `FeedList`)
- [x] **티커 아님**(`useTickerLayout={false}`) 단일 리스트도 점진 로드

## M3 — 타입·DB

- [x] `POST /api/teams` 팀 생성
- [x] `POST /api/bookmarks`, `POST /api/custom-sources`, 팀 초대·가입·팀 PATCH·플레이리스트 저장 — `Insert`/`Update` + `as never`
- [x] `src` 전체 `as any` 제거(검색 기준)

## M4 — 라디오

- [x] `FloatingRadioPlayer`: `radioRef`로 콜백·rAF 내부에서 최신 `radio` 참조
- [ ] 장기: YT Player 생성/파괴를 `videoId` 전환에만 묶이도록 구조 분리 (선택·고비용 리팩터)

## M5 — 제품 확장 (별도 스프린트)

- [x] **종합 트렌드**: 상단 `TrendRadarBar` + **`/trends`** 워드클라우드·상세(`getTrendRadar` + 캐시)
- [x] **피드 Q&A**: 멀티턴·`localStorage`·마크다운 복사·Todoist 빠른 추가 링크·Free 한도·`002_usage_daily_feed_qa.sql`
- [ ] **Notion OAuth·양방향 동기화** 등 — 별도 제품 결정 후

## M6 — 모바일·회귀

- [x] 메인 `touch-pan-y`·`overscroll-y-contain`, 드로어 `overscroll-contain`, 사용량 임박 배너
- [x] GitHub Actions: `lint`, `build`, `test:unit`, **`test:e2e`** (`main`/`master` push·PR)
- [x] 실기기 QA 목록: `docs/MOBILE_QA_CHECKLIST.md` (수동 실행)
- [x] Playwright 스모크: `e2e/smoke.spec.ts`

## M7 — 품질 안정화 (2026-06-11 브라우저 감사 후속)

- [x] **P0 플레이리스트 보안**: 서버 DB 플레이리스트는 **로그인 사용자 전용**(저장 401, 조회 격리, rename/delete 소유권 `.eq("user_id")`). 기존 `user_id IS NULL` 행은 노출·자동귀속 금지, 운영자 수동 검토(`005_playlists_owner_required.sql`).
- [x] **PWA**: SW 캐시 재설계(navigation network-first·HTML 미캐시, API/RSC/auth 미캐시, `/offline.html`), manifest 단일화·정사각 아이콘 192/512, orientation 제한 제거.
- [x] **모바일 UX**: 모달 body 스크롤 잠금(`src/lib/body-scroll-lock.ts`), Q&A z-index·safe-area, 필터/뷰 전환 360px 대응, 핵심 버튼 44px, 빈 라디오 안내 모바일 dismissible, ThemeToggle UI 연결.
- [x] **API 오류 분류**: YouTube `API key expired` 등 → `invalid_api_key`(연동 설정 오류), Gemini `GeminiFailureKind` 분류·공용 메시지, RSS HTML 엔티티 디코딩, 비로그인 custom-sources 401 콘솔 소음 제거.
- [x] **E2E**: 데스크톱/모바일 Chromium 프로젝트 분리, 라우트·필터·뷰 전환·Q&A·스크롤 잠금·터치 타깃·테마·PWA 캐시·익명 401 회귀. WebKit 모바일은 수동 QA로 명시.
- [ ] 운영: `005` 마이그레이션 운영 DB 적용, 실 OAuth·Stripe·iOS Safari PWA 수동 검증.

## M8 — 보안·법적 정합 + 개인 연구 기반 + UX P0 (2026-06-20)

> PR #5~#10. **주의: 모든 검증이 빌드·타입·린트·단위테스트 레벨이며 실제 브라우저 런타임은 미검증이다.** 상세 적대적 검증·잔여 작업·다음 세션 프롬프트는 `docs/HANDOFF_2026-06-20_NEXT_SESSION.md`.

- [x] **보안(PR #5)**: 자동 Notion 동기화 제거·서버액션 owner 전용+레이트리밋, `next 16.2.9`(prod critical/high 0), 보안 응답 헤더 5종, resolve-channel IP 레이트리밋·trends 강제 새로고침 owner 전용.
- [x] **계정·법적(PR #5)**: 데이터 내보내기(`/api/account/export` + 내 계정 UI), 약관·개인정보 실제 구현에 맞게 정정(Gemini·Notion 전송 명시, 해지·삭제 문의처 안내).
- [x] **콘텐츠 상태 모델(PR #5/#6)**: `008_content_states.sql`(RLS·전이 검증), 타입·전이규칙, 인박스 선별 UI(처리 대기/제외 + 상태 필터 칩, 제외 항목 피드 숨김).
- [x] **UX P0(PR #7/#10)**: 라이트 아이콘 400 수정, 카드 버튼 줄바꿈 방지·모바일 아이콘화, 카드 액션 과밀 완화(선별→더보기), ScrollToTop↔Q&A 겹침 제거, 환영 배너 모바일 컴팩트, 모바일 메뉴 햄버거 affordance.
- [ ] **런타임 검증**: 로그인 + Supabase + `005`/`008` 적용 상태에서 인박스 선별·데이터 내보내기·보안 헤더·proxy 회귀를 실제 브라우저로 확인.
- [ ] **잔여 UX**: UX-21 e2e 회귀 테스트, UX-40/41(라디오 피드백·카드 밀도), UX-12 잔여, UX-50~52(제품 차별화).

## M9 — 모바일 UX 대수술 + 런타임 검증 (2026-06-24)

> PR #16 (main 머지·squash `6c5f0aa`). **이전 M8과 달리 실제 브라우저(playwright 모바일 360/390) 런타임까지 검증함.** 상세·교훈은 `docs/devlog/2026-06-24-mobile-ux-overhaul.md`, 다음 세션은 `docs/HANDOFF_2026-06-24_NEXT_SESSION.md`.

- [x] **카드(#16)**: AI 요약 버튼 솔리드 보라+흰글자·`fullWidth`+truncate(360px 오버플로 해소)·높이 44px, 액션행 4개 동일 36px 원형+44px 터치영역(투명 `::before`), 펼침 패널 클리핑/오버랩 제거.
- [x] **홈 상단 정리(#16)**: 히어로·환영 배너 제거 → 검색→트렌딩→필터, MY FOCUS·사용량 하단 이동, max-width 캡 제거(2xl)+5열, 카드/제목 확대.
- [x] **트렌드 필터(#16)**: 클릭 시 빈 결과 버그 수정(`sampleTitles`+토큰 부분매칭), 비문자열 가드(렌더 크래시 방지)·역방향 과매칭 가드.
- [x] **모바일·a11y(#16)**: 릴뷰 라디오 플레이어 가림 보정, 터치타깃 44px, aria 보강, 북마크 이중탭 가드, 트렌드칩 컴팩트.
- [x] **PWA(#16)**: dev 서비스워커 등록 차단+기존 SW/캐시 정리 — dev SW가 옛 CSS를 cache-first로 서빙해 변경이 반영 안 되던 근본 원인 해결(→ `docs/patterns/PAT-001-dev-service-worker-stale-assets.md`).
- [x] **정리(#16)**: `lib/ui.ts` 공통 클래스 상수, 게이트(tsc·eslint·build·vitest 82·verify·vhk:policy) + 적대적 코드리뷰 통과.
- [ ] **잔여(다음 세션)**: WelcomeBanner 고아 파일 처리·온보딩 재배치 여부, 트렌드 2토큰 매칭 정밀도(현재 빈결과 회피 우선), M8 런타임 검증 항목(로그인+Supabase+마이그레이션) 여전히 미완.

## M10 — 검색 중심 탐색 UX (2026-07-12)

- [x] 글로벌 카운트·수동 새로고침 헤더 제거, 검색을 첫 콘텐츠로 배치.
- [x] 검색·트렌드 칩·콘텐츠 종류·접힌 상세 필터를 단일 탐색 패널로 통합.
- [x] `전체/유튜브/RSS` 전환을 클라이언트 필터로 변경해 서버 재렌더 지연 제거, URL은 History API로 유지.
- [x] 유튜브 카드의 AI 3줄 요약 CTA를 카드 하단에 고정해 같은 행의 폭·높이 정렬.
- [x] 운영 데이터 기준 데스크톱 1440px·모바일 393px Chromium 확인(가로 오버플로 0px, 보기 전환 82ms).
- [x] 시스템 다크 선호와 앱 테마 클래스 불일치 수정, RSS 중복 라벨 제거·플랫 리스트 행으로 정리.
- [x] Apple HIG·Spotify Encore 참고 `docs/FOCUS_FEED_UI_UX_REPORT.html` 시각 적용 보고서.
- [x] YouTube 홈·영상 그리드·Shorts, Apple Music, Spotify Web Player와 현행 3화면을 Playwright로 캡처한 `docs/FOCUS_FEED_REFERENCE_BOARD.html`.

## M11 — 디자인 시스템·영상/플레이어 재구성 (2026-07-12~)

- [x] `docs/DESIGN_SYSTEM.md`: 제품별 역할·색·간격·radius·타입·버튼·모션·완료 게이트 확정.
- [x] `globals.css`: 라이트·다크 의미 기반 토큰과 기존 `--notion-*` 무변경 호환 별칭.
- [x] YouTube식 홈 카드 본문과 카드 액션 우선순위 (`HOME-01/02`, 로컬 브라우저 검증).
- [x] 롱폼 목록·query 기반 상세·외부 AI 패널 (`VIDEO-01/02`, Preview 인증·실제 요약 검증 완료).
- [x] 숏폼 9:16·라이브 16:9 전용 레이아웃과 재생 정책 (`VIDEO-03`).
- [x] Spotify식 하단 플레이어·큐·확장 플레이어 시각 구조 (`RADIO-01`).
- [x] Apple식 앱 셸·모바일 드로어·고정 UI 충돌 수정 (`SHELL-01`).
- [x] 병합 후 모바일 보완: 채널 아바타·고화질 썸네일, 카드 탭 앱 내부 재생, 채널 전환 요청 축소·로딩 피드백, 80px 라디오 바, 숏폼 검은 화면 수명주기와 48px 홈 버튼 수정.
- [x] 배포 후 숏폼 회귀 보완: YouTube가 교체한 iframe에 `opacity: 0`이 남는 구조를 안정 래퍼로 수정, 홈 버튼을 좌측 52px 타깃으로 강화, 카드 재생 링크를 단일 채널 조회로 제한.
- [x] 숏폼 자동재생 회귀 보완: 모바일의 소리 있는 자동재생 차단을 피하도록 무음 자동재생하고, 종료 시 다음 영상으로 이동해 자동재생하도록 고정.
- [x] 라디오 큐 재정렬·재생 인스턴스 유지 자동 검증 (`RADIO-02/03`).
- [x] Vercel Preview 로그인·Gemini 실생성·사용량·캐시 (`PREVIEW-01`).
- [x] 전 화면 반응형·접근성 감사와 채널 상세 탐색 계층 정리 (`SHELL-02/04`).
- [x] 다중 검수·CI 병합 게이트 (`QA-01`, Draft PR #36 전체 CI 통과).
- 활성 상태·완료 조건·검증 증거: `docs/M11_EXECUTION_PLAN.md`.

## M12 — 지식 캡처·대기열 P0 (2026-07-27~)

- [x] Focus Feed 카드·롱폼 상세·공유 확인 화면을 같은 POST 접수 API로 연결.
- [x] `012_knowledge_jobs.sql`: 사용자별 멱등·active/일 quota, 보강 완료 예약만 가져가는 3개 제한 atomic claim, 최대 3회 시도, lease checkpoint·완료 RPC, 사람 승인 token CAS(`review_required → approving → completed`)를 코드와 함께 준비.
- [x] 영상 설명은 시간표·참고 링크 중심의 소스 가이드로만 선별하고, 전체 자막·Notion·Git 직접 쓰기는 차단.
- [x] 접수는 로그인 쿠키 세션 enqueue RPC로 제한하고, 조회는 인증 확인 뒤 service-role 서버 route가 user_id와 응답 allowlist를 강제한다. 브라우저의 원본 table SELECT를 닫고 최대 50개 배치 조회·active ID backoff polling·7개 처리 상태 UI를 연결.
- [x] enqueue→메타 보강 사이 worker 선점과 늦은 POST 상태 역행을 준비 완료 gate·updated_at 병합으로 차단하고, 중단된 예약 재시도를 연결.
- [x] `012_knowledge_jobs.sql`은 새 설치용 기준선으로 보존한다. 현재 운영 이력은 012 재실행이 아니라 `014_knowledge_jobs_legacy_upgrade.sql` 적용 후 `015_knowledge_job_retry.sql` 적용이다.
- [x] 운영 적용 전 read-only preflight와 비파괴 rollback 순서를 문서화하고, legacy worker RPC overload가 있으면 baseline 재실행을 금지.
- [x] yohan-mcp worker의 checkpoint·NotebookLM source 사전 대조와 public 영상 2건 `review_required`(품질 100)까지 검증.
- [x] 사람 승인→Brain RESOURCE/SUMMARY write-once를 1건 실증하고 동일 job 재승인에서 idempotent 응답·두 파일 hash 불변을 확인.
- [x] `015_knowledge_job_retry.sql`: service-role 전용 단건 retry, 허용 실패 코드·3회 미만 제한, NotebookLM source ID/hash 보존 계약과 CLI를 코드·테스트로 준비.
- [x] `015_knowledge_job_retry.sql`을 `014` 다음 사람 검토 후 운영 Supabase에 적용하고 action_required 1건을 기존 source ID로 재처리해 `review_required` 복구 검증.
- [x] `016_knowledge_job_approval_cas_hardening.sql`: 운영 DB의 worker 완료 RPC가 `review_required`/`action_required`만 허용하고 사람 승인 CAS를 우회하지 못함을 2026-08-10 read-only preflight로 재검증했다.
- [x] `017_knowledge_jobs_browser_read_hardening.sql`: 사람 승인 후 운영 DB에 적용하고 `anon`·`authenticated` 직접 SELECT 차단, 레거시 select policy 제거, service-role 전용 접근을 postflight로 확인했다.
- [x] `018_knowledge_review_invalidation.sql`: 운영 DB에서 invalidation/retry RPC의 정확한 시그니처와 service-role 전용 권한을 read-only preflight로 확인했다. 실데이터 invalidation·재처리는 이번 출시에서 실행하지 않았다.
- [ ] 019~022 레거시 복구 migration은 Git blob SHA-256으로 고정하고 clean 성공률에서 제외한다. 이후 knowledge migration에는 job UUID literal을 금지한다.
- [ ] `023_knowledge_exact_claim_and_no_retry_guard.sql`: owner+job ID exact claim, held canary의 표준 claim 제외, no-retry lease 만료·attempt 소진의 fail-closed 전이, recovery marker retry 차단을 공용 계약과 rollback으로 검증한다. 운영 적용은 별도 사람 승인 전까지 보류한다.
- [ ] 레거시 대상은 운영 read-only 진단을 딱 한 번 수행하고 모든 조건이 맞을 때만 별도 승인으로 exact 처리한다. 결과와 무관하게 clean 통계에서 제외하고 추가 migration·retry·Brain 승인을 하지 않는다.
- [ ] clean 카나리는 신규 콘텐츠 통과 10건(파일럿 3 + 확장 7)과 Control Tower 사람 승인 1건의 Brain RESOURCE·SUMMARY write-once를 완료 조건으로 삼는다.
- [ ] P0 canary 10건 뒤 outbound Realtime 연속 구독·Windows 로그인 시작을 별도 승인으로 구현하고, PC offline 요청 및 다음 시작 시 15분 stale claim 회수를 실측.
- [ ] iPhone 단축어 1개를 실제 기기에서 YouTube 공유 입력으로 검증.
- [x] `/knowledge` 대기열·데스크톱/모바일 탐색 진입점과 지식 CTA 상태 표시를 준비.
- [x] `/knowledge` 목록/상세 API를 분리하고 검토 항목에 요약·주장 유형·검증된 짧은 원문 발췌·타임스탬프·전 구간 커버리지·불확실성·집 Codex용 승인/보류 요청을 노출한다. 내부 경로·hash·NotebookLM ID·원문 전체를 제외하는 API 허용 목록을 검증.
- [x] owner·feature flag로 제한한 `POST /api/knowledge/canary-capture`가 1~7건을 영상별 멱등 접수하고 신규 작업만 held/no-retry clean 표본으로 표시하며, 기존 작업 불변·부분 실패 보존·16KiB 입력 상한을 검증.
- [ ] `013_knowledge_process_requests.sql`: P1로 연기했으며 현재 저장소·운영 이력에 없다. stale worker가 같은 `worker_id`로 새 claim을 완료 처리하지 못하도록 claim fencing token을 추가한 뒤 별도 P1 계약과 UI를 구현.

## 변경 이력

| date | 내용 |
|------|------|
| 2026-05-18 | 초안(M1~M6)·M5/M6·`/trends`·Q&A 멀티턴·Playwright·모바일 QA 문서 |
| 2026-06-11 | M7 품질 안정화: 플레이리스트 로그인 전용, PWA 캐시 재설계, 모바일 UX, API 오류 분류, E2E 확대 |
| 2026-06-20 | M8 보안·법적 정합(자동 Notion 차단·next 16.2.9·헤더·비용 가드·데이터 내보내기·약관 정합), 콘텐츠 상태 모델·인박스 선별, UX P0(아이콘·줄바꿈·플로팅·첫화면). 런타임 미검증 |
| 2026-06-24 | M9 모바일 UX 대수술(PR #16): 카드 AI버튼·터치타깃 44px·홈 상단 정리·5열·트렌드 빈결과 수정·dev SW stale 캐시(PAT-001)·릴뷰 플레이어 가림. **playwright 모바일 런타임 검증 + 적대적 코드리뷰 통과** |
| 2026-07-12 | M10 검색 중심 탐색 UX: 상단 탐색 패널 통합, 보기 전환 서버 왕복 제거, 카드 요약 CTA 하단 정렬 |
| 2026-07-12 | M10 후속: Tailwind dark 변형을 next-themes 클래스에 통일, RSS 카드 대비·중복 배지 수정, UI/UX 시각 보고서 |
| 2026-07-16 | M11 기준선·main 동기화 후 실행 작업대장 도입. 홈·영상 모드·플레이어·앱 셸의 구현 상태와 Preview·라디오·최종 QA 잔여 Task를 분리 |
| 2026-07-27 | M12 지식 캡처·대기열 P0 코드 계약 추가. 운영 DB/NotebookLM/iPhone 실기기 canary는 사람 승인 전 미실행. |

## 작업실 통합 (2026-09-13)

영상·문서·대화를 연결한 작업실과 승인 자료 조회·수정안·활용 메모 기반을 추가했다. 상세 범위와 한계는 docs/WORKSPACE_RELEASE.md를 따른다. 별도의 요금제·팀 제거와 문서 이동은 포함하지 않는다.
