---
id: focus-feed-prd
date: 2026-07-18
tags: [focus-feed, prd, product]
---

# Focus Feed — 제품 요구사항(PRD)

> **유지보수**: 기능·플랜·환경이 바뀌면 이 문서의 해당 절과 상단 `date`를 함께 갱신한다. 구현 세부는 코드·`README.md`·`docs/`를 우선한다.

## 1. 한 줄 정의

**YouTube 채널 + RSS를 한 피드로 모아**, 키워드·카테고리로 걸러 보고, **백그라운드 라디오 재생**과 **Gemini 기반 AI 요약·인사이트·피드 Q&A**를 제공하는 **Next.js 기반 웹/PWA** 서비스.

## 2. 해결하는 문제

| 문제 | Focus Feed 대응 |
|------|-----------------|
| 유튜브·뉴스를 앱마다 따로 본다 | 단일 피드 병합, 소식통(블록) 레이아웃 |
| 긴 영상만 보기엔 부담 | 라디오 큐, 재생 중 AI 요약(가사) 패널 |
| 관심사만 빠르게 보고 싶다 | 키워드 필터(localStorage), 카테고리 URL `?category=` |
| 기기 간 채널·북마크 | Supabase Auth + DB(로그인 시) |

## 3. 사용자·플랜

| 플랜 | 조건 | 요약 |
|------|------|------|
| 비로그인 | — | 피드·쿠키 기반 커스텀 채널 등 (코드 기준) |
| `free` | 로그인, Pro 미구독 | 일일 요약·인사이트·피드 Q&A·주간 브리핑 **한도** (`src/lib/usage-limits.ts` 참고) |
| `pro` | Stripe 구독·`user_plan` | AI 한도 완화(구현 기준) |
| `owner` | `OWNER_EMAIL`과 세션 이메일 일치 | 제한 없음 |

한도 상수(변경 시 PRD·문서 동기화): `FREE_DAILY_SUMMARY`, `FREE_DAILY_INSIGHT`, `FREE_DAILY_FEED_QA`, `FREE_WEEKLY_BRIEFING`.

## 4. 핵심 기능 (현재 제품 범위)

1. **피드**: 유튜브 업로드 + RSS 병합, 최신순, 수동 새로고침, 서버 캐시·재검증(`REVALIDATE_SECRET`).
2. **소스**: 기본 소스 + 커스텀 유튜브 채널(쿠키 + 로그인 시 Supabase 동기화 패턴).
3. **카테고리**: `FEED_CATEGORIES` 및 URL 쿼리.
4. **키워드 필터**: 브라우저 `localStorage`만 사용(`src/lib/storage.ts`). URL 쿼리·서버 동기화는 **현재 제품 범위에 포함하지 않음**(개인 기기 단위).
5. **라디오**: 큐, 하단 플로팅 플레이어, 이전/다음, 재생목록·미니영상·전체화면 등(모바일 터치·safe-area 고려).
6. **AI**: Gemini — 3줄 요약, 인사이트, 팀 브리핑, **피드 Q&A**(병합 피드 상위 항목 컨텍스트) 등(서버 액션·사용량·플랜 검사).
7. **북마크·플레이리스트**: 로그인 연동 페이지·API 존재. **플레이리스트 서버 저장은 로그인 사용자 전용** — 비로그인 큐는 브라우저 메모리에서만 사용(저장 API 401, 목록은 본인 `user_id`만 조회, `docs/DATA_PROTECTION.md` §2).
8. **팀**: 팀 생성·초대·조인·팀별 북마크/브리핑 등 라우트 (`/teams`, `/teams/join`, …).
9. **결제**: `/pricing`, Stripe 환경 변수(`.env.example` 참고).
10. **인증**: Supabase Google OAuth, `NEXT_PUBLIC_SITE_URL` 배포 시 필수.
11. **PWA**: `public/app.webmanifest`(단일 manifest, 정사각 아이콘 192/512), 서비스 워커 `public/sw.js`·`PwaInstaller`. 캐시 정책: navigation은 network 우선·**HTML 미캐시**(stale chunk 방지), `/_next/static/` cache-first, 이미지 stale-while-revalidate, **API·RSC·인증 미캐시**, 오프라인은 정적 `/offline.html`.
12. **테마**: 기본 라이트, 시스템 전환 가능(`ThemeProvider`).
13. **탐색 UX**: 글로벌 피드는 검색→트렌드 키워드→콘텐츠 종류·상세 필터를 하나의 탐색 패널로 제공한다. `전체/유튜브/RSS` 전환은 이미 내려받은 피드를 클라이언트에서 즉시 필터링하고 URL만 History API로 동기화한다.
14. **영상 모드**: YouTube 카드 탭은 외부 사이트 대신 앱 내부 재생으로 연결한다. 롱폼은 `/?viewMode=longform&watch={videoId}` 상세로 진입하고 자동재생하지 않으며, 숏폼은 모바일 자동재생 정책을 만족하도록 무음으로 시작해 해당 영상의 9:16 세로 스냅 위치에서 자동재생하고 종료 시 다음 영상으로 이동한다. 라이브는 16:9 재생 화면으로 진입하되 종료 시 자동으로 넘기지 않는다. 외부 YouTube 열기는 카드 더보기의 보조 행동으로 유지한다.
15. **상세 AI 요약**: 롱폼과 확장 라디오의 AI 요약은 영상 위를 덮지 않는 외부 패널/시트로 표시한다. 미생성·로딩·로그인 필요·성공·오류·로컬 캐시 복원 상태를 제공한다.
16. **지식 캡처(P0)**: 사용자는 카드·롱폼 상세·`/capture` 공유 진입점에서 YouTube 영상을 한 번 눌러 **지식 대기열**에 넣는다. Focus Feed는 영상 제목·채널·정규 URL·설명란의 시간표/참고 링크만 선별한 소스 가이드를 저장하고, 실제 NotebookLM 처리·요약 품질 검사·brain/Notion 반영은 별도 worker가 맡는다.

## 4.1 피드 Q&A (M5)

| 항목 | 정책 |
|------|------|
| 로그인 | **필수**(비로그인은 `checkUsageLimit`에서 거절). |
| 멀티턴 | 직전 **최대 6턴**(사용자+어시스턴트)을 프롬프트에 포함. **브라우저 `localStorage`**에 스레드 저장(소스별 키). |
| 컨텍스트 | 서버 `getMergedFeed` + 사용자 커스텀 소스 병합, 최신순 상위 **50**개(단일 소스 보기 시 해당 소스만). 클라이언트 키워드·카테고리 필터는 반영하지 않을 수 있음. |
| 질문 길이 | 최대 500자, 공백 제외 최소 2자. |
| Free 일일 한도 | `FREE_DAILY_FEED_QA`(기본 5), `usage_daily.feed_qa_count` (`docs/supabase-migrations/002_usage_daily_feed_qa.sql`). |
| 저장 | 서버에 **대화 영구 저장 없음**; 클라이언트 스레드는 `localStorage` + 마크다운 복사. **Todoist**는 첫 질문 텍스트로 빠른 추가 링크만 제공(OAuth 미연동). |
| 모델 | Gemini Flash 계열(`src/app/actions/feed-qa.ts`). |

## 4.2 지식 캡처 P0 (M12)

| 항목 | 정책 |
|------|------|
| 접수 | **POST만** `knowledge_jobs` 행을 만든다. `/capture`의 GET·PWA share target·iPhone 단축어는 확인 화면만 열며, 사용자가 [지식으로 담기]를 눌러야 한다. 접수는 로그인 쿠키 세션의 enqueue RPC가 auth.uid·멱등·active 10건·일 50건을 원자 검증하고, table 직접 write는 닫는다. 조회는 인증을 확인한 서버 route가 service role로 `user_id`를 강제하고 허용 필드만 반환하며, 브라우저의 원본 table SELECT는 닫는다. |
| 멱등 | 사용자+YouTube video ID가 같은 요청은 새 행을 만들지 않고 기존 상태를 돌려준다. API burst 제한 뒤 enqueue RPC가 DB 멱등·quota를 먼저 확정한다. 준비가 끝난 중복은 외부 메타를 다시 조회하지 않고, 첫 요청이 끊긴 미완료 예약만 같은 행에서 보강을 재개한다. |
| clean 카나리 도우미 | `POST /api/knowledge/canary-capture`는 feature flag와 설정된 owner UUID가 모두 일치하는 로그인 사용자만 1~7개 HTTPS YouTube URL을 한 번에 접수한다. 요청은 16KiB, 제목 300자, 채널명 180자로 제한하고 정규 URL 목록 SHA-256을 run ID로 기록한다. 신규 작업에만 `_canary_hold=true`·`_canary_no_retry=true`를 서버가 부여하며, 이미 존재하는 작업은 보강·변경하지 않고 clean 통계에서 제외한다. 묶음 전체 transaction은 약속하지 않고 영상별 멱등 작업 ID와 부분 실패를 그대로 반환한다. |
| 보존 | 제목·채널·정규 URL·설명란에서 선별한 시간표/참고 링크만 `source_guide`에 넣는다. CTA·광고·문의 문구와 전체 자막은 Focus Feed DB에 저장하지 않는다. |
| 상태 | 내부 상태는 `queued → processing → review_required → approving → completed`와 `action_required/failed/cancelled`다. 최초 조회는 영상 ID를 최대 50개씩 순차 처리한다. 대기·처리 중 ID만 15초에서 최대 120초까지 backoff polling하고 숨은 탭에서는 늦춘다. 창으로 돌아오면 모든 상태를 새로 읽는다. 담김·처리 중·검토 필요·승인 적재 중·완료·조치 필요·실패·취소를 그대로 표시한다. |
| 검토 | `/knowledge`의 `review_required` 항목은 요약·핵심 요점·사실/해석/권고 분리·영상 시작/중간/끝 커버리지·불확실성을 접어서 보여 준다. 목록 응답에는 검토 가능 여부만 포함하고, 펼칠 때 본인 `job_id`로 상세 API를 호출한다. 검증된 사실과 구간 근거는 공개 자막에서 실제 위치가 확인된 20단어 이하 짧은 발췌와 YouTube 타임스탬프 링크로 원본 확인이 가능하다. 품질 점수는 `자동 구조 검증`으로 표시하며 외부 사실 진위를 보증하지 않는다고 명시한다. 브라우저 API는 허용 목록만 직렬화하고 로컬 review 경로·source/transcript hash·NotebookLM 내부 ID·원문 전체를 반환하지 않는다. 검토가 끝나면 사용자는 승인·보류 명령을 복사해 집의 Codex에 전달하며, Focus Feed가 Brain에 직접 기록하지 않는다. |
| 경계 | Focus Feed는 Notion·Git·NotebookLM에 직접 쓰지 않는다. enqueue는 `capture_ready=false` 예약만 만들고, 메타 보강 RPC가 완료된 행만 worker가 claim한다. `docs/supabase-migrations/012_knowledge_jobs.sql`은 최대 3건 claim, 작업별 최대 3회 시도, 현재 lease token 기반 checkpoint·연장·완료를 제공한다. 다음 단계는 yohan-mcp의 단일 `knowledge` CLI가 처리한다. |
| 후속 전이 | `review_required → approving → completed`는 Control Tower의 사람 결정을 받은 yohan-mcp 승인 명령이 맡는다. DB RPC가 approval token·intent hash를 CAS하고, 사람 메모는 Git 제외 로컬 intent에만 고정해 RESOURCE/SUMMARY pair의 중간 crash를 복구한다. `action_required`·`failed`는 인증·자막·접근 제한·한도·처리 지연별 다음 행동을 `/knowledge`에 표시한다. `023_knowledge_exact_claim_and_no_retry_guard.sql` 이후 clean canary는 `_canary_hold=true`로 표준 claim에서 제외하고 exact job ID로만 처리한다. `_canary_no_retry=true` 또는 과거 recovery marker가 있는 작업은 retry를 거부하며, lease 만료·attempt 소진은 `action_required`로 종결한다. 019~022는 운영 이력으로만 보존하고 이후 migration에 job UUID를 넣지 않는다. |
| iPhone | iOS는 PWA share target을 신뢰하지 않는다. YouTube 공유 → “FF 지식 담기” 단축어 → `/capture?url=...` → 사용자 확인 순서를 사용한다. PWA share target은 `/capture` 하나로 받고 같은 화면에서 지식 담기와 채널 추가를 선택한다. |
| 적용 | `012_knowledge_jobs.sql`은 새 설치용 기준선이다. 019~022의 레거시 복구 작업은 clean 성공률에서 제외하고 더 이상 queued로 되돌리지 않는다. `023`은 특정 작업을 복구하지 않는 공용 실행 안전 계약이며, 운영 적용·권한 postflight·레거시 실데이터 진단은 각각 별도 사람 승인 뒤에만 수행한다. clean 완료 기준은 신규 작업의 콘텐츠 통과 10건과 Control Tower 사람 승인 후 Brain RESOURCE·SUMMARY 각 1개, 동일 승인 재요청 시 파일 hash 불변이다. |

## 4.3 지식 처리 요청 P1 (M12 후속)

`013_knowledge_process_requests.sql`, process-request API/UI, Realtime bridge는 P1로 연기했다. 현재 P0 코드·SQL·운영 이력에는 포함하지 않는다.

## 5. 비기능·품질

- **스택**: Next.js 16, React 19, TypeScript, Tailwind 4.
- **보안**: API 키·서비스 롤은 서버만; 클라이언트는 `NEXT_PUBLIC_*`만.
- **Gemini 남용 완화**: 로그인 사용자·비로그인(IP)별 **분당 버스트 제한**(`src/lib/gemini-rate-limit.ts`, 액션 종류에 `feed_qa` 포함). 트렌드 레이더는 **IP당 시간당** Gemini 호출 제한.
- **검증**: `npm run lint`, `npm run build`; 주요 플로우는 README 점검 목록 참고.

## 6. 환경 변수 (요약)

전체 목록·설명은 **`.env.example`** 이 단일 소스. 배포 시 특히:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL` (OAuth·결제 리다이렉트)
- `YOUTUBE_API_KEY`, `GEMINI_API_KEY`
- Stripe·`OWNER_EMAIL` (해당 기능 켤 때)

선택(기본값 있음, 상세는 `.env.example`):

- `GEMINI_ACTIONS_PER_MINUTE`, `GEMINI_ANON_ACTIONS_PER_MINUTE`, `GEMINI_TREND_PER_HOUR_PER_IP`
- `MAX_MERGED_FEED_ITEMS` — 병합 피드 최대 노출(50~2000, 기본 500)
- `ENABLE_DEBUG_YOUTUBE` — **프로덕션**에서만 `/api/debug-youtube` 노출 시 `true`/`1` (기본 비활성)

## 7. 문서 역할 분리

| 문서 | 역할 |
|------|------|
| `docs/MILESTONES.md` | **우선순위 마일스톤**(M1~M11, 완료 체크) |
| `docs/M11_EXECUTION_PLAN.md` | M11의 활성 Phase/Task·완료 조건·검증 증거 |
| `docs/MOBILE_QA_CHECKLIST.md` | **모바일·PWA 수동 QA** 체크리스트 |
| `docs/PRD.md` (본 문서) | 제품 범위·플랜·기능 개요 |
| `README.md` | 설치·실행·환경 변수 요약·점검 체크리스트 |
| `AGENTS.md` | Cursor Agent용 리포지토리 지침 |
| `CLAUDE.md` | Claude Code 등 외부 Claude 세션용 컨텍스트 |
| `.cursor/rules/*.mdc` | 에디터 내 코딩 규칙 |
| `CURSOR_HANDOFF.md` | 과거 Supabase 페이즈 핸드오프(**내용이 오래됐을 수 있음**; 상충 시 코드·본 PRD 우선) |
| `docs/cursor_implementation_guide.md` | 구현 상세 가이드(있는 경우) |
| `docs/DEPLOYMENT_CHECKLIST.md` | Vercel 등 배포 전 환경 변수·동작 확인 |

## 8. 범위 밖·향후 (예시)

- 앱 스토어 네이티브 앱(현재는 웹/PWA 중심).
- PRD에 없는 기능은 **이슈/로드맵**에 올린 뒤 본 문서에 반영.

## 9. 기술 백로그 (후속 우선순위 참고)

| 구분 | 내용 | 상태 |
|------|------|:----:|
| 성능 | 피드 대량 시 **가상 스크롤·소스별 페이지네이션**, YouTube 쿼터 추가 절감 | 남음 |
| 성능 | 티커 아닌 단일 리스트 **더 보기** 절진 로드(`FeedList`) | 반영 |
| 성능 | 병합 피드 **상한** `MAX_MERGED_FEED_ITEMS`(기본 500, `src/lib/feed.ts`) | 반영 |
| 성능 | `전체/유튜브/RSS` 보기 전환 시 App Router 서버 재실행 제거(클라이언트 필터 + History API) | 반영 |
| 품질 | Vitest·스모크·GitHub Actions·Playwright E2E(`e2e/`) | 부분 |
| 품질 | 세그먼트별 `error` 경계 확대 | 남음 |
| 제품 | 종합 트렌드(`TrendRadarBar` + `/trends`), 피드 Q&A 멀티턴·복사·Todoist 링크 — `docs/focus_feed_audit_report.md` | 부분 |
| UX | 모바일 라디오·드로어 잔여 이슈 | 남음 |
| UX | Free **한도 임박** 안내(`UsageBadge` 앰버 배너) | 반영 |
| UX | 메인 스크롤 `touch-pan-y`·`overscroll-y-contain` (`AppLayout`) | 반영 |
| 코드 | `FloatingRadioPlayer` `radioRef` + rAF 내부 최신 큐 | 반영 |
| 코드 | YT Player 수명·남은 `exhaustive-deps` 정리 | 부분 |
| 코드 | Supabase `as any` → `Insert`/`Update` + `as never` (`src` 기준) | 반영 |

## 10. 변경 이력

| date | 내용 |
|------|------|
| 2026-05-17 | 초안: 코드베이스·README·`.env.example` 기준으로 통합 작성 |
| 2026-05-17 | 배포 체크리스트·Gemini 레이트 리밋·프로덕션 debug-youtube 차단·루트 `error.tsx`·팀 생성 타입 정리 |
| 2026-05-17 | P2/P3 부분: 피드 상한·Vitest·한도 임박 배너·메인 터치 스크롤·라디오 훅 의도 주석 |
| 2026-05-18 | 키워드 필터 저장 정책 확정: **B** — `localStorage`만 사용, URL·Supabase 동기화는 범위 밖 |
| 2026-05-18 | 유튜브 카드(`YouTubeCard`) 제목·채널·메타 타이포 상향, 음수 마진 제거, 액션 줄 간격 |
| 2026-05-18 | `FeedHeader`·`KeywordFilter` 레이아웃: 음수 마진·`translateY`·픽셀 마진 props 제거, `flex`/간격으로 정리 |
| 2026-05-18 | 피드 Q&A(M5)·`usage_daily.feed_qa_count` 마이그레이션·UsageBadge·CI 워크플로 |
| 2026-05-18 | `/trends` 대시보드·피드 Q&A 멀티턴·Playwright·모바일 QA 문서·피드 `content-visibility` |
| 2026-06-11 | QA 후속(M7): 플레이리스트 로그인 전용 서버 저장, PWA 캐시 정책·manifest 단일화, 모바일 모달 잠금·44px·테마 토글, YouTube/Gemini 설정 오류 분류, RSS 엔티티 디코딩 |
| 2026-07-12 | 글로벌 피드 상단을 검색 중심 탐색 패널로 통합(트렌드 칩·콘텐츠 종류·접힌 상세 필터), 글로벌 카운트/새로고침 헤더 제거, 보기 전환 즉시화, AI 요약 버튼 카드 하단 정렬 |
| 2026-07-12 | 앱 테마 클래스와 Tailwind 다크 변형을 통일하고 RSS 항목을 단일 소스 아이콘 기반 플랫 리스트로 정리 |
| 2026-07-16 | M11 영상 모드·롱폼 상세 AI 패널·라디오/앱 셸의 현재 제품 계약과 활성 실행 작업대장 반영 |
| 2026-07-18 | M11 Draft PR #36 전체 CI와 Vercel Preview Google OAuth·롱폼 상세 복귀·Gemini 실제 요약·사용량·캐시 검증 완료 |
| 2026-07-18 | 병합 후 모바일 후속: 구독 채널 아바타, 고화질 썸네일 선택, 카드 앱 내부 재생, 전환 로딩 피드백, 80px 라디오 바, 숏폼 iframe 가시성 래퍼·좌측 52px 홈 버튼·단일 채널 재생 조회 보완 |
| 2026-07-18 | 숏폼 재생 정책 보완: 데스크톱·모바일 모두 무음 자동재생으로 시작하고 YouTube 종료 이벤트에서 다음 숏폼을 자동재생하도록 검증 |
| 2026-07-27 | 지식 캡처 P0: `/capture` 확인형 공유 진입점·영상 화면 CTA·멱등 `knowledge_jobs` 스키마와 worker lease 계약을 추가. 운영 DB 적용·NotebookLM canary는 별도 승인 전 보류. |
| 2026-08-05 | 지식 대기열 화면·처리 요청 P1 계약을 추가. 브라우저 직접 연결과 polling을 금지하고, Realtime bridge는 P0 canary 10건 뒤 활성화하도록 분리. |
| 2026-08-07 | 최종 적대 리뷰에 따라 service-role 전용 단건 retry 계약, attempt ceiling, source ID/hash 보존 및 worker 산출물 초기화를 `015_knowledge_job_retry.sql`로 추가. 실제 DB 적용은 사람 승인 게이트로 유지. |
| 2026-08-08 | 운영 Supabase에 015를 적용하고 기존 source ID 재사용 retry를 검증. `/knowledge`에 승인 전 요약·주장 유형·짧은 검증 발췌·타임스탬프·전 구간 커버리지·불확실성을 확인하는 상세 UI와 민감 필드 제거 API 계약을 추가. 목록/상세 조회를 분리하고 집 Codex용 승인·보류 요청 복사를 추가. |
| 2026-08-10 | 사람 승인으로 017을 운영 Supabase에 적용하고 브라우저 역할의 원본 table SELECT 차단을 postflight로 확인. 016·018 함수 계약과 service-role 경계는 read-only preflight로 검증했으며, 018 실데이터 invalidation·재처리는 실행하지 않음. |

### 작업실 디자인과 집중 흐름 (2026-09-13)

영상 아래의 재생·일시정지 버튼은 준비된 공식 YouTube IFrame API에 연결한다. 화면 보기나 칸 크기를 바꾼 직후에도 프레임 내부 클릭에 의존하지 않고 조작할 수 있다. 재생 요청은 사용자가 버튼을 누를 때만 보내고, 버튼 상태는 실제 플레이어 이벤트에 맞춘다. 브라우저가 재생을 거부하면 영상 내부 재생 버튼을 안내한다. 원래 YouTube 조작부도 유지한다. 호스트 앱이 외부 iframe을 차단하는 경우에는 일반 브라우저에서 작업실을 사용해야 하며 Focus Feed가 호스트의 제한을 해제하지 않는다.

자료와 정리·영상 집중·문서 집중은 같은 문서와 영상 인스턴스를 사용한다. 문서 집중은 선택한 문단 바로 아래에서 요청·전후 비교·적용·되돌리기를 지원한다. AI를 접어도 오른쪽 아래에서 같은 대화로 돌아온다. 도구·모델 선택은 AI 패널 상단이다.

영상 집중은 자막 발췌·메모와 확인된 시점 탐색, 하단 질문 입력을 제공한다. 질문은 기존 채팅으로 이어지며 자동 전송하지 않는다. 시점 메모는 현재 Markdown의 ‘시점 메모’에 추가되어 같은 초안 저장을 사용한다. 플레이어가 연결되면 시점 이동·현재 시점·따라가기가 동작하고, 연결되지 않으면 원본 링크와 수동 시점 입력을 제공한다. 플레이어 오류 또는 15초 준비 시간 초과에는 영상 안에 실패 안내·다시 시도·YouTube에서 열기를 표시한다. API 스크립트의 로드 실패는 더 빨리 안내할 수 있다. 재시도는 영상 프레임만 다시 연결하며 문서와 대화 입력을 유지한다. 현재 시도의 늦은 연결 성공은 안내를 해제하고, 이전 시도의 응답은 무시한다. 시간 위치가 있는 짧은 발췌를 전체 자막이나 생성된 챕터로 표시하지 않는다. 댓글 수집과 NotebookLM 내부 처리 자동화는 별도 연결 범위다.

디자인/반응형/상호작용 검증과 실서비스 재생·모델 응답 검증을 구분한다. 근거: `docs/screenshots/design-qa.md`.

### 승인 자료 활용 메모 (2026-09-13)

완료 자료의 ‘활용 메모’에서 저장 이유와 프로젝트 이름·질문·문서 링크를 남긴다. 승인 본문과 메모는 별개이며 최신 승인 버전별로 저장한다. 프로젝트 이름은 자유 텍스트이고 자동 할 일이나 정본 등록을 뜻하지 않는다.

메모는 FOCUS_FEED_USAGE_ROOT의 서버 로컬 파일에 저장한다. 로그인 사용자·완료 job·승인 해시를 확인한 뒤 읽고 쓰며, 동시 수정은 충돌로 알리고 입력을 유지한다. 새 승인본에 이전 메모를 자동 복사하지 않는다. 현재 파일의 손상을 검사하며 전체 과거 메모 감사나 과거 메모 조회 화면은 제공하지 않는다. 서버 간 동기화·클라우드 저장은 후속 범위다.

지식함과 메모 편집 화면의 ‘활용 메모 찾기’에서 현재 승인본의 저장 이유·프로젝트·질문·문서 링크를 검색한다. 단어를 공백으로 나누면 모두 포함한 메모를 찾는다. 제목·원문 본문은 이 검색 대상이 아니다. 저장 시각순으로 페이지당 20개를 보여준다. 메모 폴더가 있는 자료를 기준으로 읽으므로 최근 승인 자료 100개 밖의 메모도 포함한다. 사용자당 자료 폴더 1,000개를 넘으면 부분 결과를 완전한 결과로 표시하지 않고 조회를 중단한다. 이전 버전에만 메모가 있거나 현재 메모를 비운 경우를 별도로 안내한다.
