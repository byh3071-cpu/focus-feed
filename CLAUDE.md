@AGENTS.md

---

## id: focus-feed-claude-md

date: 2026-05-17
tags: [focus-feed, claude, context]

# Focus Feed — Claude 세션용 컨텍스트

Claude Code·CLI 등 **저장소 밖의 Claude**가 이 프로젝트를 이해할 때 읽는 짧은 앵커 문서다.

## 무엇을 만드는가

- **Focus Feed**: YouTube + RSS 통합 피드, 키워드·카테고리 필터, **라디오 큐(백그라운드 재생)**, **Gemini AI 요약/인사이트/팀 브리핑**.
- **스택**: Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, Supabase Auth·DB, Stripe(Pro), PWA(`app.webmanifest`).

## 어디를 보나


| 목적              | 경로                            |
| --------------- | ----------------------------- |
| 제품 범위·플랜        | `docs/PRD.md`                 |
| 로컬 실행·환경 변수     | `README.md`, `.env.example`   |
| 에이전트 규칙(Cursor) | `AGENTS.md`, `.cursor/rules/` |
| AI 역할 분담 템플릿    | `AI_COLLABORATION.md`         |
| 공통 작업 헌법·VHK 정책 | `RULES.md`, `docs/VHK_ADOPTION.md` |


## 코딩 시 주의

- 시크릿·API 키를 코드에 넣지 말 것.
- 서버 전용: `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `GEMINI_API_KEY`, `YOUTUBE_API_KEY` 등.
- 배포: `NEXT_PUBLIC_SITE_URL` OAuth/결제 리다이렉트에 필요.
- 플랜·한도: `src/lib/plan.ts`, `src/lib/usage-limits.ts`.

## 검증

```bash
npm run verify:focus-feed
npm run vhk:policy
```

상세 제품 요구는 `**docs/PRD.md**` 를 갱신된 기준으로 따른다.

## VHK

- VHK는 반드시 `npm run vhk -- <command>`로 실행한다.
- 확인된 VHK 자체 결함은 `npm run vhk:incident -- ...`와 `npm run vhk:draft -- <id>`로 기록한다.
- draft를 사용자에게 보여주고 외부 공개 승인을 받은 뒤 `npm run vhk:report -- <id> --approved`로 upstream 이슈를 등록한다.
- 이슈 URL이 연결되지 않은 VHK 결함이 있으면 완료로 선언하지 않는다.
- 사용자 승인 없이 `vhk sync`, Git 자동화, 배포·배포 관련 명령을 실행하지 않는다.
