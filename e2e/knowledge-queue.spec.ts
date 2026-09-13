import { expect, test, type Page } from "@playwright/test";

async function showStudioDraftEditor(page: Page) {
  await page.getByLabel("요약 페이지").getByRole("button", { name: "편집", exact: true }).locator("visible=true").click();
  await expect(page.getByLabel("초안 마크다운")).toBeVisible();
}

const JOB_ID = "123e4567-e89b-42d3-a456-426614174000";

test("화면 전환 직후 재생 버튼은 플레이어 상태와 동기화된다", async ({ page }) => {
  await page.route("https://www.youtube.com/iframe_api", route => route.fulfill({ contentType: "application/javascript", body: `
    window.__playCalls=0;window.__pauseCalls=0;
    window.YT={Player:class {
      state=-1;
      constructor(frame,options){this.events=options.events;window.__player=this;queueMicrotask(()=>this.events.onReady());}
      getCurrentTime(){return 0}seekTo(){}destroy(){}getPlayerState(){return this.state}
      playVideo(){window.__playCalls++;this.state=1;this.events.onStateChange({data:1})}
      pauseVideo(){window.__pauseCalls++;this.state=2;this.events.onStateChange({data:2})}
    }};window.onYouTubeIframeAPIReady?.();` }));
  await page.goto(`/knowledge?job=${JOB_ID}`);
  await expect(page.getByRole("button", {name:"영상 재생",exact:true})).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as {__playCalls:number}).__playCalls)).toBe(0);
  await page.getByRole("button", {name:"영상 집중",exact:true}).click();
  await page.getByRole("button", {name:"영상 재생",exact:true}).click();
  await expect(page.getByRole("button", {name:"영상 일시정지",exact:true})).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as {__playCalls:number}).__playCalls)).toBe(1);
  await page.getByRole("button", {name:"자료와 정리",exact:true}).click();
  await page.getByRole("button", {name:"영상 일시정지",exact:true}).click();
  expect(await page.evaluate(() => (window as unknown as {__pauseCalls:number}).__pauseCalls)).toBe(1);
  await page.evaluate(() => (window as unknown as {__player:{events:{onStateChange:(e:{data:number})=>void}}}).__player.events.onStateChange({data:1}));
  await expect(page.getByRole("button", {name:"영상 일시정지",exact:true})).toBeVisible();
  await page.evaluate(() => (window as unknown as {__player:{events:{onAutoplayBlocked:()=>void}}}).__player.events.onAutoplayBlocked());
  await expect(page.getByRole("status", {name:"영상 재생 안내"})).toContainText("영상 안의 재생 버튼");
});

test("영상 연결 실패 후 다시 시도해도 문서와 채팅 입력을 유지한다", async ({ page }) => {
  await page.route("https://www.youtube.com/iframe_api", route => route.fulfill({ contentType: "application/javascript", body: `
    window.YT={Player:class {
      constructor(frame,options){window.__videoAttempt=(window.__videoAttempt||0)+1;
        if(window.__videoAttempt===1){window.__oldVideoEvents=options.events;queueMicrotask(()=>options.events.onError({data:153}));}
        else queueMicrotask(()=>{options.events.onReady();window.__oldVideoEvents.onReady();window.__oldVideoEvents.onError({data:153});});
      } getCurrentTime(){return 0} seekTo(){} destroy(){}
    }};window.onYouTubeIframeAPIReady?.();` }));
  await page.goto(`/knowledge?job=${JOB_ID}`);
  const notice = page.getByRole("status", { name: "영상 연결 안내" });
  await expect(notice).toContainText("영상을 연결하지 못했어요");
  await page.getByRole("textbox", { name: "채팅 메시지", exact: true }).fill("재시도해도 남을 입력");
  await showStudioDraftEditor(page);
  const draft = await page.getByLabel("초안 마크다운").inputValue();
  const originalFrame = await page.locator(".workspace-player iframe").elementHandle();
  await page.getByRole("button", { name: "영상 다시 시도", exact: true }).click();
  await expect(page.locator(".knowledge-workspace")).toHaveAttribute("data-player-ready", "true");
  await expect(notice).toHaveCount(0);
  expect(await originalFrame!.evaluate(frame => frame.isConnected)).toBe(false);
  await expect(page.getByLabel("초안 마크다운")).toHaveValue(draft);
  await expect(page.getByRole("textbox", { name: "채팅 메시지", exact: true })).toHaveValue("재시도해도 남을 입력");
});

test("영상이 응답하지 않으면 원본 열기와 재시도를 제공한다", async ({ page }) => {
  await page.route("https://www.youtube.com/iframe_api", route => route.fulfill({contentType:"application/javascript",body:'window.YT={Player:class{constructor(frame,options){window.__lateVideoReady=options.events.onReady}getCurrentTime(){return 0}seekTo(){}destroy(){}}};window.onYouTubeIframeAPIReady?.();'}));
  await page.goto(`/knowledge?job=${JOB_ID}`);
  const notice = page.getByRole("status", { name: "영상 연결 안내" });
  await expect(notice).toBeVisible({timeout:20_000});
  await expect(notice.getByRole("link", {name:"YouTube에서 열기"})).toHaveAttribute("href", "https://www.youtube.com/watch?v=abc_DEF-123");
  await expect(notice.getByRole("button", {name:"영상 다시 시도"})).toBeEnabled();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole("button", {name:"영상 집중",exact:true}).click();
  await expect(notice).toBeVisible();
  await page.screenshot({path:test.info().outputPath("video-unavailable-mobile.png")});
  await page.evaluate(() => (window as Window & { __lateVideoReady?: () => void }).__lateVideoReady?.());
  await expect(notice).toHaveCount(0);
  await expect(page.locator(".knowledge-workspace")).toHaveAttribute("data-player-ready", "true");
});

test("실제 YouTube 재생과 작업실 시점 이동을 확인한다", async ({ page }) => {
  test.skip(process.env.FOCUS_FEED_LIVE_VIDEO !== "1", "외부 YouTube 연결은 명시적으로 실행하는 로컬 검증");
  test.setTimeout(90_000);
  await page.unroute("**/embed/**");
  await page.unroute("https://www.youtube.com/iframe_api");
  // Only the job data is a fixture. The iframe, API script and media are real.
  await page.route("**/api/knowledge/jobs/*/studio", route => route.fulfill({ json: {
    studioAvailable: true, statusLabel: "검토 필요",
    job: { id: JOB_ID, videoId: "RjfbvDXpFls", sourceUrl: "https://www.youtube.com/watch?v=RjfbvDXpFls", title: "Building pi in a World of Slop — Mario Zechner", channelName: "AI Engineer", status: "review_required", captureReady: true },
    review: { ...STUDIO_REVIEW, claims: [{ ...STUDIO_REVIEW.claims[0], citation: "[02:01]" }] },
    studioDraft: { markdown: "# 실제 영상 연결 검증\n\n사용자 문서는 변경하지 않습니다.\n", revision: 0, seeded: false },
  } }));
  await page.goto(`/knowledge?job=${JOB_ID}`);
  const workspace = page.locator(".knowledge-workspace");
  await expect(workspace).toHaveAttribute("data-player-ready", "true", { timeout: 30_000 });
  await page.getByRole("button", { name: "영상 집중", exact: true }).click();
  const player = page.frameLocator(".workspace-player iframe");
  const activateControl = async (name: RegExp) => {
    const control = player.getByRole("button", {name});
    if (process.env.FOCUS_FEED_VIDEO_INPUT !== "keyboard") {
      await page.getByRole("button", {name:name.source.includes("Pause") ? "영상 일시정지" : "영상 재생",exact:true}).click();
    } else await control.press("Enter");
  };
  await activateControl(/동영상 재생|Play video/i);
  const video = player.locator("video");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 30_000 }).toBeGreaterThan(1);
  expect(await video.evaluate((element: HTMLVideoElement) => ({ paused: element.paused, error: element.error?.code ?? null }))).toEqual({ paused: false, error: null });
  await page.getByRole("link", { name: "[02:01] 원본에서 확인", exact: true }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 15_000 }).toBeGreaterThanOrEqual(120);
  await page.getByRole("button", { name: "현재 시점에 메모", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "메모 시점", exact: true })).toHaveValue(/^02:/);
  await page.getByRole("button", { name: "문서 집중", exact: true }).click();
  await page.getByRole("button", { name: "작은 영상", exact: true }).click();
  await expect(workspace).toHaveAttribute("data-player-ready", "true");
  expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThanOrEqual(120);
  await page.getByRole("button", { name: "자료와 정리", exact: true }).click();
  await expect(workspace).toHaveAttribute("data-player-ready", "true");
  await activateControl(/동영상 일시중지|Pause video/i);
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("video-live-workspace.png") });
});

// Approved image copy. These fixtures never write to a user's job or call a model.
const APPROVED_PARAGRAPH = "AI는 별도의 공간에 있는 도구가 아니라, 우리가 이미 하는 일의 연장선에 있어야 합니다. 유튜브에서 얻은 인사이트를 NotebookLM으로 정리한 자료, 그리고 댓글 속 다양한 관점은 하나의 흐름으로 연결될 때 더 큰 가치를 만들 수 있습니다. 중요한 것은 도구의 개수가 아니라, 내 작업 흐름 속에서 자연스럽게 연결해 실질적인 결과로 이어가는 것입니다.";
const APPROVED_REPLACEMENT = "AI는 별도의 공간에 있는 도구가 아니라, 우리가 이미 하는 일의 연장선에 있습니다. 유튜브의 인사이트를 수집하고, NotebookLM으로 정리하며, 댓글의 다양한 관점을 연결해 하나의 작업 흐름으로 만들 때 더 큰 가치를 만들 수 있습니다. 앞으로는 각 도구를 나의 업무 흐름 속에 자연스럽게 연결해 실질적인 결과로 이어가겠습니다.";
const APPROVED_MARKDOWN = `# 작은 도구가 만드는 차이

AI 지식을 내 일에 적용할 때 생기는 실제 변화에 대하여

## 1. 핵심 요약

${APPROVED_PARAGRAPH}

## 2. 내 생각

오늘 영상을 보면서 내가 AI 도구들을 너무 세분화해서 사용했음을 깨달았다. 각 도구가 가진 강점은 분명하지만, 서로 연결될 때 비로소 업무 속에서 진짜 힘을 발휘한다. 앞으로는 정보를 모으는 단계부터 정리하고, 생각을 발전시키고, 실행으로 옮기는 흐름을 하나로 설계해보고 싶다.

## 3. 다음에 해볼 것

- 이번 주에 유튜브 시청 → NotebookLM 정리 → 실행 계획 수립까지 하나의 주제로 연결해보기
- 자주 쓰는 도구들을 연동하는 간단한 작업 템플릿 만들기
- 한 달 뒤, 실제로 어떤 변화가 있었는지 정리해 다시 보기
`;

const SIDECAR_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const STUDIO_REVIEW = {
  formatVersion: 2,
  summary: "원문 사실과 해석을 구분한 검토 요약입니다.",
  keyPoints: ["핵심 요점 하나"],
  claims: [{
    type: "fact",
    statement: "타임스탬프로 확인한 사실 주장",
    evidenceExcerpt: "검증에 사용한 실제 원문 근거입니다",
    citation: "[00:51]",
    citationVerified: true,
    requiresCrosscheck: false,
  }],
  coverage: [],
  uncertainties: ["없음"],
  category: "YT · AI · Workflow",
  qualityScore: 96,
  qualityWarnings: [],
  ecosystemApplications: [],
  evidenceMap: [],
};

async function mockKnowledgeQueue(page: Page) {
  await page.route("**/api/knowledge/jobs", async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/knowledge/jobs") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jobs: [
          {
            id: JOB_ID,
            videoId: "abc_DEF-123",
            sourceUrl: "https://www.youtube.com/watch?v=abc_DEF-123",
            title: "검토할 지식 영상",
            channelName: "테스트 채널",
            status: "review_required",
            failureCode: null,
            captureReady: true,
            createdAt: "2026-08-08T00:00:00.000Z",
            updatedAt: "2026-08-08T00:01:00.000Z",
            reviewAvailable: true,
          },
          {
            id: "223e4567-e89b-42d3-a456-426614174001",
            videoId: "processing-123",
            title: "처리 중인 영상",
            status: "processing",
            captureReady: true,
            createdAt: "2026-08-09T00:00:00.000Z",
            updatedAt: "2026-08-09T00:01:00.000Z",
          },
          {
            id: "323e4567-e89b-42d3-a456-426614174002",
            videoId: "completed-123",
            title: "완료된 영상",
            status: "completed",
            captureReady: true,
            createdAt: "2026-08-10T00:00:00.000Z",
            updatedAt: "2026-08-10T00:01:00.000Z",
          },
          {
            id: "423e4567-e89b-42d3-a456-426614174003",
            videoId: "action-123",
            title: "조치가 필요한 영상",
            status: "action_required",
            failureCode: "TRANSCRIPT_DISABLED",
            captureReady: true,
            createdAt: "2026-08-11T00:00:00.000Z",
            updatedAt: "2026-08-11T00:01:00.000Z",
          },
        ],
      }),
    });
  });

  await page.route("**/api/knowledge/jobs/*/approve", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        statusLabel: "승인 적재 중",
        job: {
          id: JOB_ID,
          videoId: "abc_DEF-123",
          sourceUrl: "https://www.youtube.com/watch?v=abc_DEF-123",
          title: "검토할 지식 영상",
          channelName: "테스트 채널",
          status: "approving",
          captureReady: true,
          createdAt: "2026-08-08T00:00:00.000Z",
          updatedAt: "2026-08-08T00:02:00.000Z",
          reviewAvailable: true,
        },
        studioDraft: {
          markdown: "# 검토할 지식 영상\n\n## 핵심 요약\n\n원문 사실과 해석을 구분한 검토 요약입니다.\n\n## 내 생각\n\n내 작업에서 적용할 부분을 남깁니다.\n",
          revision: 1,
          updatedAt: "2026-09-04T02:10:00.000Z",
          seeded: false,
        },
      }),
    });
  });

  await page.route("**/api/knowledge/jobs/*/studio", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/studio-chat")) {
      await route.fallback();
      return;
    }
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { markdown?: string; expectedRevision?: number };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          studioDraft: {
            markdown: body.markdown,
            revision: (body.expectedRevision ?? 0) + 1,
            updatedAt: "2026-09-04T02:00:00.000Z",
            seeded: false,
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        studioAvailable: true,
        statusLabel: "검토 필요",
        job: {
          id: JOB_ID,
          videoId: "abc_DEF-123",
          sourceUrl: "https://www.youtube.com/watch?v=abc_DEF-123",
          title: "검토할 지식 영상",
          channelName: "테스트 채널",
          status: "review_required",
          captureReady: true,
          createdAt: "2026-08-08T00:00:00.000Z",
          updatedAt: "2026-08-08T00:01:00.000Z",
          reviewAvailable: true,
        },
        sourceGuide: "## YouTube 소스 가이드\n- 제목: 검토할 지식 영상",
        review: STUDIO_REVIEW,
        studioDraft: {
          markdown: "# 검토할 지식 영상\n\n## 핵심 요약\n\n원문 사실과 해석을 구분한 검토 요약입니다.\n\n## 내 생각\n\n내 작업에서 적용할 부분을 남깁니다.\n",
          revision: 0,
          updatedAt: null,
          seeded: true,
        },
      }),
    });
  });

  await page.route("http://127.0.0.1:8787/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: SIDECAR_CORS });
      return;
    }
    await route.abort("failed");
  });
  await page.routeWebSocket("ws://127.0.0.1:8787/**", (socket) => {
    socket.close();
  });
}

test.beforeEach(async ({ page }) => {
  await page.route("**/embed/**", route => route.fulfill({contentType:"text/html; charset=utf-8",body:'<body style="margin:0;background:#eef0f4;color:#596270;display:grid;place-items:center;height:100vh;font:14px sans-serif">영상 검증용 자리</body>'}));
  await page.route("https://www.youtube.com/iframe_api", route => route.fulfill({contentType:"application/javascript",body:'window.YT={Player:class {constructor(frame,options){queueMicrotask(options.events.onReady)}getCurrentTime(){return 0}seekTo(){}destroy(){}}};window.onYouTubeIframeAPIReady?.();'}));
  await page.addInitScript(() => {
    try { localStorage.removeItem("ff_knowledge_deferred_jobs"); } catch {}
    try { sessionStorage.setItem("ff_dev_sw_cleaned", "1"); } catch {}
  });
  await mockKnowledgeQueue(page);
});

test("지식함은 확인 필요·처리 중·완료를 분리하고 뒤로가기를 제공한다", async ({ page }) => {
  await page.goto("/knowledge", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "지식함" })).toBeVisible();
  await expect(page.getByRole("button", { name: "이전 화면으로 돌아가기" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "지식함 상태" })).toBeVisible();
  await expect(page.getByRole("button", { name: /확인 필요/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("검토할 지식 영상")).toBeVisible();
  await expect(page.getByText("처리 중인 영상")).not.toBeVisible();

  await page.getByRole("button", { name: /처리 중/ }).click();
  await expect(page.getByText("처리 중인 영상")).toBeVisible();
  await expect(page.getByText("검토할 지식 영상")).not.toBeVisible();

  await page.getByRole("button", { name: /완료/ }).click();
  await expect(page.getByText("완료된 영상")).toBeVisible();
  await expect(page.getByText("브레인에 적재됨")).toBeVisible();
  await expect(page.getByRole("button", { name: "작업실 보기" })).toBeVisible();
});

test("처리 중은 요약 카드만 보이고 확인 필요는 작업실로 연다", async ({ page }) => {
  await page.goto("/knowledge", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "작업실 열기" })).toBeVisible();
  await expect(page.getByText("조치가 필요한 영상")).toBeVisible();
  await expect(page.getByText("이 영상은 공개 자막이 비활성화되어 자동 검증을 진행할 수 없습니다.")).toBeVisible();

  await page.getByRole("button", { name: /처리 중/ }).click();
  await expect(page.getByText("처리 중인 영상")).toBeVisible();
  await expect(page.getByText("초안이 준비되면 작업실이 열려요.")).toBeVisible();
  await expect(page.getByRole("button", { name: /작업실/ })).toHaveCount(0);
});

test("비로그인은 지식함 로그인 CTA를 보여 준다", async ({ page }) => {
  await page.route("**/api/knowledge/jobs", async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/knowledge/jobs") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "로그인해야 지식함을 볼 수 있어요." }),
    });
  });
  await page.goto("/knowledge", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("로그인하면 지식함을 볼 수 있어요.")).toBeVisible();
  await expect(page.getByRole("link", { name: "로그인하기" })).toHaveAttribute("href", "/login?next=/knowledge");
});

test("/capture 담기 후 지식함 또는 작업실로 이어진다", async ({ page }) => {
  await page.route("**/api/knowledge/preview**", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/knowledge/capture**", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        created: true,
        job: {
          id: JOB_ID,
          videoId: "abc_DEF-123",
          sourceUrl: "https://www.youtube.com/watch?v=abc_DEF-123",
          title: "검토할 지식 영상",
          status: "queued",
          captureReady: true,
          createdAt: "2026-09-04T00:00:00.000Z",
          updatedAt: "2026-09-04T00:00:00.000Z",
        },
      }),
    });
  });
  const previewed = page.waitForResponse((response) => response.url().includes("/api/knowledge/preview"));
  await page.goto("/capture?url=https://youtu.be/abc_DEF-123", { waitUntil: "domcontentloaded" });
  const submit = page.getByTestId("knowledge-capture-submit");
  await expect(submit).toBeEnabled();
  await previewed;
  const posted = page.waitForRequest((request) => (
    request.method() === "POST"
    && new URL(request.url()).pathname === "/api/knowledge/capture"
  ));
  await submit.click();
  await posted;
  await expect(page.getByText("지식함에 담았어요.")).toBeVisible();
  await expect(page.getByText("현재 상태: 담김")).toBeVisible();
  await expect(page.getByRole("link", { name: "지식함 보기" })).toHaveAttribute("href", "/knowledge");
});

test("검토 항목을 열면 작업실에서 초안을 고치고 저장한다", async ({ page }) => {
  await page.goto("/knowledge", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "작업실 열기" }).click();

  await expect(page).toHaveURL(/\/knowledge\?job=/);
  await expect(page.getByLabel("영상과 근거").getByRole("heading", { name: "검토할 지식 영상" })).toBeVisible();
  await page.getByRole("button", { name: "소스 가이드", exact: true }).click();
  await expect(page.getByText("YouTube 소스 가이드")).toBeVisible();
  await page.getByRole("button", { name: "근거 발췌", exact: true }).click();
  await expect(page.getByRole("link", { name: /\[00:51\] 원본에서 확인/ })).toHaveAttribute("href", /[?&]t=51s/);
  await expect(page.getByLabel("요약 페이지").getByRole("heading", { name: "검토할 지식 영상" })).toBeVisible();
  await expect(page.getByRole("button", { name: "브레인에 승인" })).toBeEnabled();
  await expect(page.getByTestId("studio-notebooklm-open")).toHaveAttribute("href", "https://notebooklm.google.com/");
  await expect(page.getByRole("button", { name: "보내기" })).toBeVisible();
  await expect(page.getByLabel("채팅 메시지")).toBeVisible();
  await expect(page.getByTestId("studio-agent-status")).toContainText("knowledge:agent");

  await showStudioDraftEditor(page);
  await expect(page.getByLabel("초안 마크다운")).toHaveValue(/원문 사실과 해석을 구분한 검토 요약입니다/);

  const patchPromise = page.waitForRequest((request) => {
    const pathname = new URL(request.url()).pathname;
    return request.method() === "PATCH" && pathname.endsWith("/studio");
  });
  await page.getByLabel("초안 마크다운").fill("# 고친 초안\n\n한 줄 수정");
  const patch = await patchPromise;
  expect(patch.postDataJSON()).toMatchObject({
    markdown: "# 고친 초안\n\n한 줄 수정",
    expectedRevision: 0,
  });
  await expect(page.getByText("저장됨")).toBeVisible();

  const approvePromise = page.waitForRequest((request) => (
    request.method() === "POST" && new URL(request.url()).pathname.endsWith("/approve")
  ));
  await page.getByRole("button", { name: "브레인에 승인" }).click();
  const approve = await approvePromise;
  expect(approve.postDataJSON()).toMatchObject({
    expectedRevision: 1,
    markdown: "# 고친 초안\n\n한 줄 수정",
  });
  await expect(page.getByRole("button", { name: "승인 적재 중" })).toBeDisabled();

  await page.getByRole("button", { name: "지식함 목록으로" }).click();
  await expect(page.getByRole("heading", { name: "지식함" })).toBeVisible();
});

test("지식함 나가기는 작업실로 돌아가지 않는다", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.goto("/knowledge", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "작업실 열기" }).click();
  await expect(page).toHaveURL(/\/knowledge\?job=/);
  await page.getByRole("button", { name: "지식함 목록으로" }).click();
  await expect(page.getByRole("heading", { name: "지식함" })).toBeVisible();
  await page.getByRole("button", { name: "이전 화면으로 돌아가기" }).click();
  await expect(page).not.toHaveURL(/[?&]job=/);
  await expect(page.getByRole("heading", { name: "지식함" })).toHaveCount(0);
});

test("보류하면 확인 필요 목록에서 접힌다", async ({ page }) => {
  await page.goto("/knowledge", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "작업실 열기" }).click();
  await page.locator("header").getByRole("button", { name: "보류" }).last().click();
  await expect(page.getByRole("heading", { name: "지식함" })).toBeVisible();
  await expect(page.getByText("검토할 지식 영상")).not.toBeVisible();
  await expect(page.getByRole("button", { name: /보류한 검토 1개 다시 보기/ })).toBeVisible();
});

test("작업실은 NotebookLM과 PC 에이전트 채팅을 쓰고 Gemini API는 부르지 않는다", async ({ page }) => {
  const studioChatCalls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/studio-chat")) {
      studioChatCalls.push(request.url());
    }
  });
  await page.goto("/knowledge", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "작업실 열기" }).click();
  await expect(page.getByLabel("요약 페이지").getByRole("heading", { name: "검토할 지식 영상" })).toBeVisible();
  await showStudioDraftEditor(page);
  await expect(page.getByLabel("초안 마크다운")).toHaveValue(/원문 사실과 해석을 구분한 검토 요약입니다/);
  await expect(page.getByTestId("studio-agent-panel")).toContainText("Claude Code");
  await expect(page.getByTestId("studio-agent-model")).toHaveValue("claude-fable-5-1");
  await expect(page.getByRole("button", { name: "보내기" })).toBeVisible();
  await expect(page.getByLabel("채팅 메시지")).toBeVisible();
  await expect(page.getByTestId("studio-agent-status")).toContainText("knowledge:agent");
  await expect(page.getByTestId("studio-notebooklm-open")).toBeVisible();
  await expect(page.getByText("터미널에서 직접 패치")).toHaveCount(0);
  expect(studioChatCalls).toEqual([]);
});

test("사이드카 수정안은 비교 후 반영하고 되돌릴 수 있다", async ({ page }) => {
  await page.route("http://127.0.0.1:8787/health", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: SIDECAR_CORS });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: SIDECAR_CORS,
      body: JSON.stringify({ ok: true, providers: { claude: true, codex: false, cursor: false } }),
    });
  });
  await page.routeWebSocket("ws://127.0.0.1:8787/ws", (socket) => {
    socket.onMessage((message) => {
      const body = JSON.parse(String(message)) as {
        type?: string;
        provider?: string;
        prompt?: string;
        model?: string;
      };
      expect(body.provider).toBe("claude");
      expect(body.model).toBe("claude-fable-5-1");
      expect(body.prompt).toContain("더 짧게");
      socket.send(JSON.stringify({
        type: "delta",
        text: "```markdown\n# 에이전트가 고친 초안\n\n한 줄\n```",
      }));
      socket.send(JSON.stringify({
        type: "done",
        text: "```markdown\n# 에이전트가 고친 초안\n\n한 줄\n```",
        provider: "claude",
        sessionId: "sess-1",
      }));
    });
  });
  await page.route("http://127.0.0.1:8787/chat", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: SIDECAR_CORS });
      return;
    }
    const body = route.request().postDataJSON() as {
      provider?: string;
      prompt?: string;
      model?: string;
    };
    expect(body.provider).toBe("claude");
    expect(body.model).toBe("claude-fable-5-1");
    expect(body.prompt).toContain("더 짧게");
    await route.fulfill({
      status: 200,
      headers: {
        ...SIDECAR_CORS,
        "content-type": "text/event-stream; charset=utf-8",
      },
      body: [
        "event: delta",
        "data: {\"text\":\"```markdown\\n# 에이전트가 고친 초안\\n\\n한 줄\\n```\"}",
        "",
        "event: done",
        "data: {\"text\":\"```markdown\\n# 에이전트가 고친 초안\\n\\n한 줄\\n```\",\"provider\":\"claude\",\"sessionId\":\"sess-1\"}",
        "",
        "",
      ].join("\n"),
    });
  });

  await page.goto("/knowledge", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "작업실 열기" }).click();
  await expect(page.getByTestId("studio-agent-status")).toContainText("Claude Code · Fable 5.1 실행 도구 확인됨");
  let patchCount = 0;
  page.on("request", request => { if (request.method() === "PATCH" && new URL(request.url()).pathname.endsWith("/studio")) patchCount++; });
  await page.getByLabel("채팅 메시지").fill("더 짧게");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  const proposal = page.getByRole("region", { name: "수정안 검토" });
  await expect(proposal).toBeVisible();
  await proposal.getByText("변경 비교", { exact: true }).click();
  expect(patchCount).toBe(0);
  await expect(page.getByLabel("요약 페이지").getByRole("heading", { name: "검토할 지식 영상" })).toBeVisible();
  const patchPromise = page.waitForRequest(r => r.method() === "PATCH" && new URL(r.url()).pathname.endsWith("/studio"));
  await proposal.getByRole("button", { name: "문서에 반영" }).click();
  expect((await patchPromise).postDataJSON()).toMatchObject({ markdown: "# 에이전트가 고친 초안\n\n한 줄\n", expectedRevision: 0 });
  await expect(page.getByLabel("요약 페이지").getByRole("heading", { name: "에이전트가 고친 초안" })).toBeVisible();
  await page.getByRole("button", { name: "반영 되돌리기" }).click();
  await expect(page.getByLabel("요약 페이지").getByRole("heading", { name: "검토할 지식 영상" })).toBeVisible();
  expect(patchCount).toBe(2);
  await page.getByLabel("채팅 메시지").fill("더 짧게");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(proposal).toBeVisible();
  await showStudioDraftEditor(page);
  await page.getByLabel("초안 마크다운").fill("# 직접 고친 제목\n\n보존해야 하는 사용자 편집");
  await expect.poll(() => patchCount).toBe(3);
  await expect(proposal.getByRole("button", { name: "문서에 반영" })).toBeEnabled();
  await proposal.getByRole("button", { name: "문서에 반영" }).click();
  await expect(page.getByText("문서가 바뀌어 이 수정안을 적용할 수 없어요. 현재 문서로 다시 요청해 주세요.")).toBeVisible();
  expect(patchCount).toBe(3);
  await expect(page.getByLabel("초안 마크다운")).toHaveValue(/보존해야 하는 사용자 편집/);
  await proposal.getByRole("button", { name: "취소", exact: true }).click();
  await expect(proposal).toBeHidden();
});

test("인사만 보내면 가운데 초안을 덮지 않는다", async ({ page }) => {
  await page.route("http://127.0.0.1:8787/health", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: SIDECAR_CORS });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: SIDECAR_CORS,
      body: JSON.stringify({ ok: true, providers: { claude: true, codex: false, cursor: false } }),
    });
  });
  await page.routeWebSocket("ws://127.0.0.1:8787/ws", (socket) => {
    socket.onMessage(() => {
      socket.send(JSON.stringify({
        type: "done",
        text: "ㅎㅇ. 초안 보고 있어.\n\n```markdown\n# 덮이면 안 됨\n\n- 항목\n```",
        provider: "claude",
        sessionId: "sess-hi",
      }));
    });
  });
  await page.route("http://127.0.0.1:8787/chat", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: SIDECAR_CORS });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: {
        ...SIDECAR_CORS,
        "content-type": "text/event-stream; charset=utf-8",
      },
      body: [
        "event: done",
        "data: {\"text\":\"ㅎㅇ. 초안 보고 있어.\\n\\n```markdown\\n# 덮이면 안 됨\\n\\n- 항목\\n```\",\"provider\":\"claude\",\"sessionId\":\"sess-hi\"}",
        "",
        "",
      ].join("\n"),
    });
  });

  const studioPatches: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "PATCH" && pathname.endsWith("/studio")) {
      studioPatches.push(request.url());
    }
  });

  await page.goto("/knowledge", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "작업실 열기" }).click();
  await expect(page.getByTestId("studio-agent-status")).toContainText("Claude Code · Fable 5.1 실행 도구 확인됨");
  await page.getByLabel("채팅 메시지").fill("ㅎㅇ");
  await page.getByRole("button", { name: "보내기" }).click();
  await expect(page.getByTestId("studio-agent-panel")).toContainText("ㅎㅇ. 초안 보고 있어");
  await expect(page.getByLabel("요약 페이지").getByRole("heading", { name: "검토할 지식 영상" })).toBeVisible();
  await expect(page.getByLabel("요약 페이지").getByRole("paragraph").filter({ hasText: "원문 사실과 해석을 구분한 검토 요약입니다" })).toBeVisible();
  await expect(page.getByLabel("요약 페이지").getByText("덮이면 안 됨")).toHaveCount(0);
  expect(studioPatches).toEqual([]);
});

test("390px 모바일에서 작업실 탭과 캡처 화면이 가로로 넘치지 않는다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/knowledge", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "작업실 열기" }).click();

  await expect(page.getByRole("tab", { name: "페이지" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("요약 페이지").getByRole("heading", { name: "검토할 지식 영상" })).toBeVisible();
  await showStudioDraftEditor(page);
  await expect(page.getByTestId("studio-notebooklm-page-open")).toHaveAttribute("href", "https://notebooklm.google.com/");
  await page.getByRole("tab", { name: "영상" }).click();
  await expect(page.getByLabel("영상과 근거").getByRole("heading", { name: "검토할 지식 영상" })).toBeVisible();
  await page.getByRole("tab", { name: "에이전트" }).click();
  await expect(page.getByTestId("studio-agent-panel")).toBeVisible();
  await expect(page.getByLabel("채팅 메시지")).toBeVisible();
  await expect(page.getByRole("button", { name: "보내기" })).toBeVisible();

  const knowledgeDimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(knowledgeDimensions.scrollWidth).toBeLessThanOrEqual(knowledgeDimensions.clientWidth);

  const approveButton = page.getByRole("button", { name: "브레인에 승인" });
  const approveBox = await approveButton.boundingBox();
  expect(approveBox).not.toBeNull();
  expect(approveBox!.height).toBeGreaterThanOrEqual(44);

  await page.goto("/capture", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "지식으로 담기" })).toBeVisible();
  await expect(page.getByRole("button", { name: "이전 화면으로 돌아가기" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "데스크톱 빠른 캡처" })).not.toBeVisible();

  const captureDimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(captureDimensions.scrollWidth).toBeLessThanOrEqual(captureDimensions.clientWidth);
});


test("작업실 보기 전환과 AI 접기는 같은 영상과 입력을 보존한다", async ({ page }) => {
  await page.setViewportSize({width:1536,height:1024});
  await page.goto(`/knowledge?job=${JOB_ID}`);
  const frame = page.getByLabel("영상과 근거").locator("iframe");
  await expect(frame).toHaveCount(1);
  const original = await frame.elementHandle();
  await expect(page.getByRole("navigation", { name: "문서 목차" })).toBeVisible();
  await page.getByRole("navigation", { name: "문서 목차" }).getByRole("link", { name: "내 생각" }).click();
  await expect(page.getByRole("navigation", { name: "문서 목차" }).getByRole("link", { name: "내 생각" })).toHaveAttribute("aria-current", "location");
  await page.getByLabel("채팅 메시지").fill("이어 쓸 질문");
  await page.getByRole("button", { name: "AI 접기", exact: true }).click();
  await expect(page.getByTestId("studio-agent-panel")).toBeHidden();
  await page.getByRole("button", { name: "영상 집중", exact: true }).click();
  await expect(page.getByLabel("요약 페이지")).toBeHidden();
  await expect(frame).toBeVisible();
  await page.getByRole("button", { name: "문서 집중", exact: true }).click();
  await expect(frame).toBeHidden();
  await page.getByRole("button", { name: "작은 영상", exact: true }).click();
  await expect(frame).toBeVisible();
  await page.getByRole("button", { name: "자료와 정리", exact: true }).click();
  await page.getByRole("button", { name: "AI 열기", exact: true }).click();
  await expect(page.getByLabel("채팅 메시지")).toHaveValue("이어 쓸 질문");
  expect(await original!.evaluate(el => el.isConnected)).toBe(true);
  await expect(frame).toHaveCount(1);
  const pane = page.getByLabel("영상과 근거");
  const before = (await pane.boundingBox())!.width;
  await page.getByRole("button", { name: "원본 칸 너비", exact: true }).press("ArrowRight");
  await expect.poll(async () => (await pane.boundingBox())!.width).toBeGreaterThan(before);
  const dragBefore = (await pane.boundingBox())!.width;
  const grip = (await page.getByRole("button",{name:"원본 칸 너비",exact:true}).boundingBox())!;
  await page.mouse.move(grip.x+grip.width/2,grip.y+50);
  await page.mouse.down(); await page.mouse.move(grip.x+grip.width/2+25,grip.y+50,{steps:5}); await page.mouse.up();
  await expect.poll(async()=>(await pane.boundingBox())!.width).toBeGreaterThan(dragBefore);
  for (const width of [360, 432, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/workspace-${width}.png`, fullPage: false });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "에이전트", exact: true }).click();
  await page.getByRole("button", { name: "AI 접기", exact: true }).click();
  await expect(page.getByLabel("요약 페이지")).toBeVisible();
  await page.getByRole("tab", { name: "에이전트", exact: true }).click();
  await expect(page.getByLabel("채팅 메시지")).toBeVisible();
  for(const mode of ["영상 집중","문서 집중"]) {
    await page.getByRole("button",{name:mode,exact:true}).click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`docs/screenshots/workspace-mobile-${mode==="영상 집중"?"watch":"write"}.png`});
  }
});


test("시안 배치와 문서 서식 도구를 실제 화면에서 확인한다", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.route("**/embed/**", route => route.fulfill({contentType:"text/html; charset=utf-8",body:'<body style="background:#172131;color:#dde4ef;font:16px sans-serif;display:grid;place-items:center;height:100vh;margin:0">검증용 영상 자리 · 실제 재생 아님</body>'}));
  await page.goto(`/knowledge?job=${JOB_ID}`);
  const document = page.getByLabel("요약 페이지");
  await expect(document.getByRole("heading", {name:"검토할 지식 영상"})).toBeVisible();
  const header = await page.locator(".workspace-header").boundingBox();
  expect(header!.height).toBeLessThanOrEqual(64);
  const composer = await page.locator(".workspace-composer > div").boundingBox();
  expect(composer!.height).toBeLessThanOrEqual(80);
  const outline = await page.locator(".workspace-outline").boundingBox();
  const body = await page.locator(".workspace-page-content").boundingBox();
  expect(outline!.x).toBeGreaterThan(body!.x + body!.width * 0.7);
  await page.screenshot({animations:"disabled",path:"docs/screenshots/workspace-study-revised.png"});
  await page.getByRole("button", {name:"영상 집중",exact:true}).click();
  const watchVideo = await page.getByLabel("영상과 근거").locator("iframe").boundingBox();
  const watchTitle = await page.getByLabel("영상과 근거").getByRole("heading").boundingBox();
  expect(watchTitle!.y).toBeGreaterThanOrEqual(watchVideo!.y + watchVideo!.height);
  expect(watchTitle!.x).toBeLessThan(100);
  await page.screenshot({animations:"disabled",path:"docs/screenshots/workspace-watch-revised.png"});
  await page.getByRole("button", {name:"문서 집중",exact:true}).click();
  await page.getByRole("button", {name:"작은 영상",exact:true}).click();
  const video = await page.getByLabel("영상과 근거").boundingBox();
  expect(video!.x).toBeGreaterThan(1100);
  await page.screenshot({animations:"disabled",path:"docs/screenshots/workspace-write-revised.png"});
  await page.getByRole("button", {name:"작은 영상 닫기",exact:true}).click();
  await expect(page.getByLabel("영상과 근거")).toBeHidden();
  await showStudioDraftEditor(page);
  const editor = page.getByLabel("초안 마크다운");
  await editor.fill("선택 문장");
  await editor.press("ControlOrMeta+a");
  await page.getByRole("button", {name:"굵게",exact:true}).click();
  await expect(editor).toHaveValue("**선택 문장**");
  await expect(page.getByText("저장됨", {exact:true})).toBeVisible();
  await page.getByRole("button", {name:"미리보기",exact:true}).click();
  await expect(document.locator("strong").filter({hasText:"선택 문장"})).toBeVisible();
});

test("승인 시안과 같은 문서와 대화에서 선택 문단만 반영한다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("https://www.youtube.com/iframe_api", route => route.fulfill({contentType:"application/javascript",body:'window.YT={Player:class {constructor(frame,options){queueMicrotask(options.events.onReady)}getCurrentTime(){return window.__testVideoTime ?? 754}seekTo(t){window.__testVideoTime=t}destroy(){}}};window.onYouTubeIframeAPIReady?.();'}));
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => { localStorage.removeItem("ff_studio_pane_widths"); });
  await page.route("**/embed/**", route => route.fulfill({ contentType:"text/html; charset=utf-8", body:'<body style="margin:0;background:#edf0f4;color:#52617a;font:14px sans-serif;display:grid;place-items:center;height:100vh">영상 프레임 비교 제외 · 검증용 자료</body>' }));
  let stored = APPROVED_MARKDOWN;
  let version = 3;
  const patches: string[] = [];
  const excerpts = [
    ["12:17", "결국 중요한 건 도구를 얼마나 잘 쓰느냐가 아니라,"],
    ["12:21", "내 작업 흐름 안에 얼마나 자연스럽게 녹아드느냐입니다."],
    ["12:34", "AI는 별도의 공간에 있는 도구가 아니라, 우리가 이미 하는 일의 연장선에 있어야 합니다."],
    ["12:40", "예를 들어, 유튜브로 정보를 보고,"],
    ["12:53", "NotebookLM으로 관련 자료를 정리하고,"],
    ["13:01", "다른 사람들의 댓글에서 새로운 관점을 발견하는 것."],
    ["13:08", "이 모든 것이 하나의 작업 흐름 안에서 이어질 때"],
    ["13:14", "비로소 생산성이 크게 올라갑니다."],
    ["13:21", "중요한 건 더 많은 도구가 아니라,"],
    ["13:28", "지금 하는 일을 더 깊이 이해하고 연결하는 방식입니다."],
  ];
  await page.route("**/api/knowledge/jobs/*/studio", async route => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      expect(body.expectedRevision).toBe(version);
      stored = body.markdown; version++; patches.push(stored);
      await route.fulfill({ json:{studioDraft:{markdown:stored,revision:version,updatedAt:"2026-09-13T01:00:00Z",seeded:false}} });
      return;
    }
    await route.fulfill({ json:{studioAvailable:true,statusLabel:"검토 필요",job:{id:JOB_ID,videoId:"abc_DEF-123",sourceUrl:"https://www.youtube.com/watch?v=abc_DEF-123",title:"AI 도구를 내 작업에 연결하기",channelName:"김도현",status:"review_required",createdAt:"2026-09-13T00:00:00Z",captureReady:true},sourceGuide:"## 소스 가이드\n도구를 작업 흐름에 연결하는 방법",review:{...STUDIO_REVIEW,claims:excerpts.map(([time,text])=>({...STUDIO_REVIEW.claims[0],statement:text,evidenceExcerpt:text,citation:`[${time}]`}))},studioDraft:{markdown:stored,revision:version,updatedAt:"2026-09-13T00:00:00Z",seeded:false}} });
  });
  await page.route("http://127.0.0.1:8787/health", route => route.fulfill({ status:200,headers:SIDECAR_CORS,json:{ok:true,providers:{claude:true,codex:true,cursor:true}} }));
  await page.routeWebSocket("ws://127.0.0.1:8787/ws", socket => {
    socket.onMessage(message => {
      const request = JSON.parse(String(message));
      expect(request.provider).toBe("codex");
      expect(request.prompt).toContain(APPROVED_PARAGRAPH);
      expect(request.prompt).not.toContain("오늘 영상을 보면서");
      socket.send(JSON.stringify({type:"done",provider:"codex",sessionId:"visual-fixture",text:`중복을 줄이고, 자료별 역할을 분명히 정리했어요.\n\n\`\`\`markdown\n${APPROVED_REPLACEMENT}\n\`\`\``}));
    });
  });
  await page.goto(`/knowledge?job=${JOB_ID}`);
  await page.getByRole("combobox",{name:"에이전트",exact:true}).selectOption("codex");
  const paragraph = page.getByRole("button",{name:APPROVED_PARAGRAPH,exact:true});
  await paragraph.click();
  await expect(paragraph).toHaveAttribute("aria-pressed","true");
  await page.getByLabel("채팅 메시지").fill("중복을 줄이고, 내가 할 행동이 드러나게 다듬어줘.");
  await page.getByRole("button",{name:"보내기",exact:true}).click();
  await expect(page.getByRole("button",{name:"이 문단 바꾸기",exact:true})).toBeVisible();
  expect(patches).toHaveLength(0);
  await page.screenshot({path:"docs/screenshots/workspace-approved-content.png",animations:"disabled"});
  await page.getByRole("button",{name:"문서 집중",exact:true}).click();
  await expect(page.getByLabel("본문에서 다듬기")).toBeVisible();
  await page.getByRole("button",{name:"작은 영상",exact:true}).click();
  await page.screenshot({path:"docs/screenshots/workspace-write-final.png",animations:"disabled"});
  await page.getByLabel("본문에서 다듬기").getByRole("button",{name:"적용",exact:true}).click();
  await expect(page.getByRole("button",{name:APPROVED_REPLACEMENT,exact:true})).toBeVisible();
  expect(stored).toBe(APPROVED_MARKDOWN.replace(APPROVED_PARAGRAPH,APPROVED_REPLACEMENT));
  await page.getByRole("button",{name:"되돌리기",exact:true}).click();
  await expect(paragraph).toBeVisible();
  expect(stored).toBe(APPROVED_MARKDOWN);

  await page.getByRole("button",{name:"AI와 이어서 작성하기",exact:true}).click();
  await expect(page.getByTestId("studio-agent-panel")).toContainText("중복을 줄이고, 자료별 역할을 분명히 정리했어요.");
  await expect(page.getByTestId("studio-agent-panel")).toContainText(APPROVED_REPLACEMENT);
  await page.getByRole("button",{name:"영상 집중",exact:true}).click();
  await expect(page.getByRole("button",{name:"재생 따라가기",exact:true})).toBeEnabled();
  await page.getByRole("button",{name:"재생 따라가기",exact:true}).click();
  await expect(page.locator('.workspace-evidence li[data-active=true]')).toHaveCount(1);
  await page.screenshot({path:"docs/screenshots/workspace-watch-final.png",animations:"disabled"});
  await page.setViewportSize({width:1200,height:675});
  const noteBox=(await page.getByLabel("시점 메모",{exact:true}).boundingBox())!;
  const questionBox=(await page.locator(".workspace-watch-question").boundingBox())!;
  expect(questionBox.y).toBeGreaterThanOrEqual(noteBox.y+noteBox.height);
  await page.screenshot({path:"docs/screenshots/workspace-watch-short.png",animations:"disabled"});
  await page.setViewportSize({width:1536,height:1024});
  await page.getByRole("button",{name:"현재 시점에 메모",exact:true}).click();
  await page.getByLabel("시점 메모 내용").fill("반복 작업부터 연결해보기");
  await page.getByRole("button",{name:"메모 저장",exact:true}).click();
  await expect.poll(()=>stored).toContain("반복 작업부터 연결해보기");
  expect(stored).toContain("[12:34]");
  await page.getByRole("textbox",{name:"영상 질문",exact:true}).fill("이 내용의 핵심이 뭐야?");
  await page.getByRole("button",{name:"영상 질문 이어가기",exact:true}).click();
  await expect(page.getByLabel("채팅 메시지")).toHaveValue("이 내용의 핵심이 뭐야?");
  expect(errors).toEqual([]);
});


test("작업실 키보드와 한글 입력 및 대비를 확인한다", async ({page}) => {
  const errors: string[]=[];
  page.on("pageerror", error=>errors.push(error.message));
  page.on("console", message=>{if(message.type()==="error") errors.push(message.text());});
  await page.route("http://127.0.0.1:8787/health", route=>route.fulfill({headers:SIDECAR_CORS,json:{ok:true,providers:{claude:true,codex:true,cursor:true}}}));
  let requests=0;
  await page.routeWebSocket("ws://127.0.0.1:8787/ws", socket=>socket.onMessage(()=>{requests++;socket.send(JSON.stringify({type:"done",text:"질문을 확인했어요."}));}));
  await page.goto(`/knowledge?job=${JOB_ID}`);
  await expect(page.getByTestId("studio-agent-status")).toContainText("실행 도구 확인됨");
  const input=page.getByLabel("채팅 메시지");
  await input.fill("생각 정리");
  await input.dispatchEvent("keydown",{key:"Enter",code:"Enter",isComposing:true});
  expect(requests).toBe(0);
  await input.press("Shift+Enter");
  await input.pressSequentially("새 문장");
  await expect(input).toHaveValue(/생각 정리\n/);
  await input.press("Enter");
  await expect.poll(()=>requests).toBe(1);
  await expect(page.getByText("질문을 확인했어요.",{exact:true})).toBeVisible();
  for (const width of [360,432,768,1280,1440]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`docs/screenshots/workspace-responsive-${width}.png`});
  }
  await page.setViewportSize({width:1536,height:1024});
  const paragraph=page.getByRole("button",{name:"원문 사실과 해석을 구분한 검토 요약입니다.",exact:true});
  await paragraph.focus();
  await paragraph.press("Enter");
  await expect(paragraph).toHaveAttribute("aria-pressed","true");
  const values=await paragraph.evaluate(element=>{const style=getComputedStyle(element);const rgb=style.color.match(/[\d.]+/g)!.slice(0,3).map(Number).map(n=>{const v=n/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return {size:style.fontSize,contrast:1.05/(rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722+.05),outline:style.outlineStyle};});
  expect(values.size).toBe("16px");
  expect(values.outline).not.toBe("none");
  expect(values.contrast).toBeGreaterThanOrEqual(4.5);
  expect(errors).toEqual([]);
});

test("처리 전에는 빈 작업실 조작을 노출하지 않는다", async ({page})=>{
  await page.route("**/api/knowledge/jobs/*/studio", route=>route.fulfill({json:{studioAvailable:false,statusLabel:"처리 대기",job:{id:JOB_ID,videoId:"abc_DEF-123",status:"queued",captureReady:false}}}));
  await page.goto(`/knowledge?job=${JOB_ID}`);
  await expect(page.getByRole("navigation",{name:"작업실 보기"})).toBeHidden();
  await expect(page.getByRole("button",{name:"AI와 이어서 작성하기",exact:true})).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole("navigation",{name:"작업실 패널"})).toBeHidden();
});
