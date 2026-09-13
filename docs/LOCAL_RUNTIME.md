---
id: focus-local-runtime
date: 2026-09-13
tags: [focus-feed, runtime, recovery]
---

# 로컬 실행과 로그인 복구

Windows에서 Focus Feed 저장소를 열고 실행한다.

```powershell
npm run local:status
npm run local:start
```

`local:start`는 앱(3000), 대화 사이드카(8787), Qdrant(6333), Ollama(11434)를 확인하고 종료된 서비스만 켠다. 정상인 기존 프로세스는 재사용한다. 앱은 개발 모드로 실행하며 주소는 `http://127.0.0.1:3000`이다. 재부팅 자동 실행을 등록하는 명령은 아니다.

Node·프로젝트 의존성·Ollama와 `bge-m3` 모델·기존 Qdrant 실행 도구가 먼저 설치되어 있어야 한다. 자동 설치나 색인 재생성은 하지 않는다. 현재 PC의 Qdrant 도구 기본 경로는 `C:\Users\Public\dev\_runtime\qdrant\start-qdrant.ps1`이다. 실행 파일은 도구 옆 `1.18.3/qdrant.exe`, 설정은 `config.yaml`인 기존 설치 구성을 지원한다. 같은 구성을 다른 위치에 설치했다면 `-QdrantStartScript`로 지정한다. 다른 Qdrant 버전·설정 배치는 현재 지원하지 않는다.

Focus `.env.local`의 `FOCUS_FEED_MCP_ROOT`·`FOCUS_FEED_BRAIN_ROOT`를 사용한다. MCP `.env`의 검색 서버·모델·Brain 경로가 관리 대상과 충돌하면 중단한다. 상세 실행 옵션은 `scripts/focus-runtime.ps1`에 있다. 로그와 시작 결과는 Git에서 제외된 `.cache/focus-runtime/`에 남는다.

| 상태 | 의미와 조치 |
|---|---|
| `healthy` | 해당 서비스 응답과 프로세스 소유를 확인했다. 로그인 성공을 뜻하지 않는다. |
| `stopped` | 서비스가 꺼져 있다. `local:start`로 시작한다. |
| `needs_identity_check` | 응답은 맞지만 실행 파일·저장소 경로를 확인하지 못했다. 해당 프로세스의 소유를 확인한다. 상대 경로로 수동 실행한 사이드카도 여기에 해당할 수 있다. |
| `collision` | 포트의 서비스나 바인딩이 예상과 다르다. 소유를 확인한 후 포트 설정을 조정한다. 도구는 기존 프로세스를 강제 종료하지 않는다. |
| `dependency_missing` | Ollama는 실행 중이지만 `bge-m3`가 없다. 설치할 모델을 확인하고 `ollama pull bge-m3`를 실행한다. |

## 로그인은 별도로 확인

서비스 상태의 `auth: not_checked`는 의도된 값이다. 실행 파일 존재와 계정 인증·모델 사용 가능 여부는 서로 다르다.

- **Focus 승인 자료 검색·첨부:** 세션이 없거나 만료되면 새 탭 로그인 링크가 나온다. 로그인 후 기존 탭에서 다시 검색하거나 질문한다. 입력 중인 질문과 첨부 선택은 유지한다. 인증 서비스 오류는 503과 재시도 안내로 구분한다. 이 분류는 `/api/knowledge/approved`에 적용되며 앱 전체 인증 API를 바꾼 것은 아니다.
- **Codex 대화:** `codex login status`로 현재 계정을 확인한다. 인증이 필요하면 `codex login` 후 다시 질문한다. 다른 대화 제공자의 인증과 모델 권한은 각각 확인해야 한다.
- **NotebookLM:** MCP 조회가 인증 만료를 반환하면 `nlm login`을 실행한다. 브라우저 인증이 끝난 뒤 MCP 조회를 다시 확인한다. 기존 Google 로그인이 유효하면 추가 입력 없이 갱신될 수 있다.

복구 도구는 지식 접수·승인·재적재 명령을 호출하지 않는다. 중단된 지식 작업을 새로 생성하지 말고 기존 작업 화면에서 상태를 확인한다. 모든 외부 제공자의 오류를 동일한 형태로 분류하거나 재부팅 뒤 전체 흐름을 자동으로 복원하는 기능은 아직 포함하지 않는다.

## 검증

`npm run test:runtime`은 서비스 상태·재사용·충돌·모델 누락·시작 실패를 격리된 테스트로 확인한다. 웹 인증 분류는 `src/lib/knowledge-auth.test.ts`와 승인 자료 API 테스트로 확인한다. 실제 재부팅 검증은 별도다.

2026-09-13 검증: 전체 웹 검증 487개 테스트·타입·빌드 통과. 런타임 검사와 시작 명령 종료 후 PowerShell 자식의 지연 출력 확인 통과. 실제 사이드카 재시작 후 네 서비스 정상, 두 번째 시작은 새 프로세스 없이 재사용했다. NotebookLM 인증 갱신 후 MCP 목록 조회 성공, Codex 로그인 상태 확인. 무인증 승인 자료 요청은 실제 401 응답으로 확인했다. 장애 503 분기는 단위 테스트로 검증했다.
