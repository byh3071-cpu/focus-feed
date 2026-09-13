export class KnowledgeLoginRequiredError extends Error {
  constructor() { super("로그인을 다시 확인해야 해요. 새 탭에서 로그인한 뒤 이 화면에서 다시 시도해 주세요."); }
}

export function approvedKnowledgeRequestError(status: number, message?: string): Error {
  if (status === 401) return new KnowledgeLoginRequiredError();
  return new Error(message || "자료를 확인할 수 없어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.");
}

export function knowledgeLoginUrl(jobId: string): string {
  return `/login?next=${encodeURIComponent(`/knowledge?job=${encodeURIComponent(jobId)}`)}`;
}
