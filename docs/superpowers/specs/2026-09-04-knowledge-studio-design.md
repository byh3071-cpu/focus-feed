---
id: knowledge-studio-design
date: 2026-09-05
tags: [focus-feed, knowledge, studio, m13, goal-1, goal-3]
---

# 지식 작업실 — Phase 1 계약

Goal 1 Phase 1 (Task 1~3). 구현은 이 문서 승인 후 Phase 2부터.

방금 만든 3열 이미지는 **구조 합의**다. 픽셀·색·타이포 정본은 `docs/DESIGN_SYSTEM.md`와 기존 앱 셸(`/knowledge`, 사이드바, 홈)이다.

## 한 줄

`review_required` job 하나를 열면 Focus Feed 안에서 영상을 보고, 요약 페이지를 손편집하며, 집 PC의 Claude Code·Codex 구독이 오른쪽 채팅으로 같은 초안을 고치고, **브레인에 승인**이 대기열 CAS로 넘어간다. 브라우저는 Brain·Notion·NotebookLM 파일을 쓰지 않는다. NotebookLM은 새 탭으로 연다.

## 범위

**한다 (Goal 1)**

- 대기열 입구에서 job 하나 → 작업실
- 3열(데스크톱) / 탭 3장(모바일)
- 초안 Markdown 손편집 + 미리보기
- 오른쪽은 집 PC 사이드카와 붙는 Claude Code·Codex 실시간 채팅 (Gemini API 아님)
- 승인·보류 버튼 (승인 복붙 CLI 대체)

**하지 않는다 (이후)**

- Electron, 관제탑, GBrain
- 새 마일스톤 번호. 이건 M13 = Goal 1–3

Goal 2(담기·대기열 입구)와 Goal 3(NotebookLM 선택·에이전트 CLI)는 각 goal 파일과 `docs/PRD.md` §4.4.

## 화면 (Task 1)

### 진입

- 목록: 지금 `/knowledge` 대기열. `review_required`를 열면 작업실.
- URL: `/knowledge?job={jobId}` (History API). 새 라우트 트리를 굳이 늘리지 않는다. job 없으면 목록만.
- `queued` / `processing`은 작업실 대신 상태 문구. `action_required` / `failed`는 기존 다음 행동 메시지.

### 데스크톱 (≥1024px)

앱 셸(사이드바·헤더·라디오 바)은 그대로. 본문만 3열.

| 열 | 역할 | 내용 |
|----|------|------|
| 왼쪽 ~28% | 영상·근거 | 16:9 플레이어(자동재생 없음), 제목 2줄·채널 1줄, `source_guide`, 검증된 짧은 발췌+타임스탬프 링크, NotebookLM 새 탭. 원문 전체·NotebookLM ID·hash 없음 |
| 가운데 ~44% | 요약 페이지 | 위 편집 / 아래 미리보기 또는 탭 `편집`·`미리보기`. 제목은 영상 제목보다 버튼이 크면 안 됨 |
| 오른쪽 ~28% | 에이전트 | Claude Code / Codex 토글, 실시간 채팅, 사이드카 꺼짐 안내. `knowledge:draft`는 터미널 CLI만 |

상단 작업실 바:

- 뒤로: 대기열 목록 (`?job` 제거)
- Primary 하나: **브레인에 승인** (dark/`--text-primary` 배경, 화면당 유일한 완료 행동)
- Secondary: **보류**
- 상태 칩: `knowledgeJobStatusLabel`

라디오 바와 겹치면 본문만 `padding-bottom` (기존 셸 규칙). 새 플로팅 FAB를 작업실에 올리지 않는다.

### 모바일 (<768px)

3열을 탭으로 접는다. 탭 이름: `영상` · `페이지` · `에이전트`. 기본 탭 `페이지`.

- 탭+승인은 44px. 승인은 하단 고정이 아니라 상단 바를 유지해 라디오와 이중 고정을 피한다. 좁으면 상단 바는 `뒤로 | 승인`만 남기고 보류는 더보기.
- 가로 오버플로 0px (360 / 393).

### 시각

- 토큰: `--surface-canvas`, `--surface-subtle`, `--text-primary/secondary`, `--border-subtle`. 신규에 `--notion-*` 추가 금지.
- AI 메시지 액센트만 `--ai-accent`. 재생 중이면 `--playback-accent`는 플레이어에만.
- radius: 패널 `--radius-lg`, 입력 `--radius-md`, 칩 `--radius-full`.
- 모션 `--motion-standard`. `prefers-reduced-motion`이면 탭 전환만 opacity.
- 라이트·다크 모두. 에이전트 패널 크롬이 콘텐츠보다 시끄러우면 실패.

## 데이터 (Task 2)

### 초안 Markdown

지금 review API는 `summary`, `keyPoints`, `claims` 등 구조화 필드만 준다. 작업실 초안은 그 필드로 **시드 Markdown**을 만든다 (서버에서 한 번 직렬화).

편집본은 `knowledge_jobs.result.studio_draft`에 둔다.

```json
{
  "markdown": "# ...",
  "revision": 1,
  "updatedAt": "ISO-8601"
}
```

- 새 SQL 컬럼 없음. 기존 `result` jsonb.
- 브라우저·클라이언트는 Brain 경로를 모름.
- NotebookLM id / source_hash / transcript_hash는 계속 API 허용 목록 밖.

시드 규칙 (첫 오픈, `studio_draft` 없음):

```md
# {title}

{summary}

## 핵심

- keyPoints…

## 주장

- (사실|해석|권고) statement
```

사람이 가운데를 고치거나 Claude Code·Codex가 `knowledge:draft`로 패치하면 `revision`을 올리고 PATCH로 저장한다. 승인 순간의 `markdown`+`revision`이 worker에 넘어가는 본문이다.

### 에이전트 (현행)

- 집 PC: `npm run knowledge:agent`가 `127.0.0.1:8787`만 listen. 정본 수송은 `ws://127.0.0.1:8787/ws`. HTTP `POST /chat` SSE는 폴백.
- Claude: job당 장수명 `claude -p --input-format stream-json --output-format stream-json`. 한 세션 = 한 프로세스. `claude -p` 한 방이 아님.
- Codex: 장수명 `codex app-server` JSON-RPC. `thread/start` → `turn/start`. `codex exec` 한 방이 아님.
- 구독 로그인. API 키 없음.
- 브라우저가 프롬프트를 만든다. 사용자가 고치라고 말하고 답이 markdown 코드펜스일 때만 `PATCH /api/knowledge/jobs/{id}/studio`. 인사·질문은 대화만.
- 터미널 폴백: `npm run knowledge:draft -- get|patch <jobId>`.
- `POST /api/knowledge/jobs/{id}/studio-chat`은 Goal 1 잔여 라우트다. UI에서 호출하지 않는다.

### 채팅 (Goal 1 이력)

- 옛 계약: Focus Feed 서버 Gemini가 초안을 패치. 현행 화면 계약이 아님.

### 조회

- 목록: 기존 `GET /api/knowledge/jobs`
- 상세: 기존 review + `studio_draft`. 없으면 시드만 클라이언트/서버가 계산.

## 승인 (Task 3)

현재 UI는 `knowledge approve {jobId}` 복사다. Goal 1이 끝나면 복사는 없어도 된다 (숨기거나 더보기).

버튼:

1. **브레인에 승인** → 본인 세션으로 기존 승인 CAS (`review_required → approving`). body에 `studio_draft.revision`과 markdown hash. worker는 이 본문으로 RESOURCE/SUMMARY를 쓴다. Focus Feed는 파일을 쓰지 않음.
2. **보류** → 기존 defer와 같은 의미 (목록의 확인 필요에서 빼고, job은 살아 있음). 구체 RPC/상태가 없으면 `cancelled`가 아니라 **목록에서만 접기 + 메모**로 시작하고, 있는 defer 계약을 재사용한다.

구현 시 운영 RPC 시그니처를 코드에서 다시 읽고 맞춘다. 새 Brain 쓰기 경로를 만들지 않는다.

승인 중(`approving`)이면 편집·승인 버튼을 잠근다. 완료면 작업실은 읽기 전용 + “적재됨”.

## 실패

| 상황 | UI |
|------|-----|
| 401 | 로그인 유도. 초안 로컬에만 두지 않음(유실). 저장은 로그인 후 PATCH |
| review 409 | “아직 검토할 수 없어요” + 대기열로 |
| CLI 패치 충돌 | “다른 곳에서 초안이 바뀌었어요” + GET refresh |
| 사이드카 꺼짐 | “이 PC에서 npm run knowledge:agent 를 켜세요.” 보내기는 보이되 연결 전에는 실패 메시지 |
| 승인 CAS 충돌 | “다시 불러온 뒤 승인” + GET refresh |

## 완료 조건 (Phase 1)

- 이 문서가 Goal 1 Task 1~3 증거다.
- Phase 2는 이 계약을 화면으로 옮긴다. 채팅 패치와 승인 RPC는 Phase 3~4.

## 열린 구현 메모 (Phase 2에서 코드로 확정)

- 승인 RPC가 markdown을 받을 자리가 없으면 **마이그레이션은 별도 사람 승인**. 그 전까지는 `result.studio_draft`만 저장하고 승인 토큰 intent hash에 draft hash를 넣는다.
- 보류의 DB 전이가 없으면 UI만 접고 Goal 1 DONE을 막지 않는다. 전이 추가는 Phase 4에서 기존 함수가 있을 때만.

## Goal 3 추가 (NotebookLM·에이전트)

- NotebookLM은 원문을 볼 때 **바로 쓰는 도구**다. 왼쪽에서 `https://notebooklm.google.com/` 새 탭. UI에 NotebookLM 내부 ID를 내지 않고 앱이 쓰지 않는다. 짧은 근거는 소스 가이드·타임스탬프.
- 에이전트 공개 계약: 작업실 채팅 → 집 PC 사이드카 → 로컬 구독 CLI. 초안 저장은 `GET|PATCH /api/knowledge/jobs/:jobId/studio`. 터미널 폴백 `npm run knowledge:draft -- get|patch <jobId>`. `result.studio_draft`만. Brain 쓰기·승인 RPC 없음.
- Cursor/Claude/Codex는 그 명령만 호출한다. 새 앱을 만들지 않는다. 스킬: `.claude/skills/knowledge-studio-draft/SKILL.md`.
