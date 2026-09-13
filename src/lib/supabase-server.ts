import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { KnowledgeJobStatus } from "@/lib/knowledge-capture";

// 우리가 사용할 DB 타입(테이블들)을 최소한으로 정의해 두면 좋습니다.
export type Database = {
  public: {
    Tables: {
      summaries: {
        Row: {
          id: number;
          video_id: string;
          summary: string;
          source: string | null;
          created_at: string;
        };
        Insert: {
          video_id: string;
          summary: string;
          source?: string | null;
          created_at?: string;
          id?: number;
        };
        Update: Partial<Database["public"]["Tables"]["summaries"]["Row"]>;
        Relationships: [];
      };
      playlists: {
        Row: {
          id: string;
          user_id: string | null;
          title: string | null;
          items: unknown;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          title?: string | null;
          items: unknown;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["playlists"]["Row"]>;
        Relationships: [];
      };
      user_plan: {
        Row: {
          user_id: string;
          plan: string;
          expires_at: string | null;
          stripe_subscription_id: string | null;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          plan?: string;
          expires_at?: string | null;
          stripe_subscription_id?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["user_plan"]["Row"]>;
        Relationships: [];
      };
      usage_daily: {
        Row: {
          user_id: string;
          date: string;
          summary_count: number;
          insight_count: number;
          briefing_count: number;
          feed_qa_count: number;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          date: string;
          summary_count?: number;
          insight_count?: number;
          briefing_count?: number;
          feed_qa_count?: number;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["usage_daily"]["Row"]>;
        Relationships: [];
      };
      bookmarks: {
        Row: {
          id: string;
          user_id: string;
          team_id: string | null;
          video_id: string;
          video_title: string;
          highlight: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          team_id?: string | null;
          video_id: string;
          video_title: string;
          highlight: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["bookmarks"]["Row"]>;
        Relationships: [];
      };
      teams: {
        Row: {
          id: string;
          name: string;
          plan: string;
          goal_text: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          plan?: string;
          goal_text?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["teams"]["Row"]>;
        Relationships: [];
      };
      team_members: {
        Row: {
          id: string;
          team_id: string;
          user_id: string;
          role: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          user_id: string;
          role?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["team_members"]["Row"]>;
        Relationships: [];
      };
      team_invites: {
        Row: {
          id: string;
          team_id: string;
          email: string;
          token: string;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          email: string;
          token: string;
          expires_at: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["team_invites"]["Row"]>;
        Relationships: [];
      };
      trend_cache: {
        Row: {
          id: string;
          bucket: string;
          trends: unknown;
          generated_at: string;
        };
        Insert: {
          id?: string;
          bucket: string;
          trends: unknown;
          generated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["trend_cache"]["Row"]>;
        Relationships: [];
      };
      custom_sources: {
        Row: {
          id: string;
          user_id: string;
          source_id: string;
          name: string;
          category: string;
          avatar_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          source_id: string;
          name: string;
          category?: string;
          avatar_url?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["custom_sources"]["Row"]>;
        Relationships: [];
      };
      hidden_default_sources: {
        Row: {
          user_id: string;
          source_id: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          source_id: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["hidden_default_sources"]["Row"]>;
        Relationships: [];
      };
      content_states: {
        Row: {
          user_id: string;
          content_id: string;
          source_id: string | null;
          source_type: string | null;
          state: string;
          play_position_seconds: number;
          completed: boolean;
          notion_page_id: string | null;
          last_synced_at: string | null;
          state_changed_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          content_id: string;
          source_id?: string | null;
          source_type?: string | null;
          state?: string;
          play_position_seconds?: number;
          completed?: boolean;
          notion_page_id?: string | null;
          last_synced_at?: string | null;
          state_changed_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["content_states"]["Row"]>;
        Relationships: [];
      };
      knowledge_amendments: {
        Row: { id: string; user_id: string; job_id: string; amendment_revision: number; base_revision: number; base_intent_hash: string; markdown: string; created_at: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      knowledge_jobs: {
        Row: {
          id: string;
          user_id: string;
          source_type: string;
          source_key: string;
          source_url: string;
          video_id: string;
          title: string;
          channel_name: string | null;
          source_guide: string;
          metadata: unknown;
          capture_ready: boolean;
          tier: string;
          status: KnowledgeJobStatus;
          source_hash: string | null;
          transcript_hash: string | null;
          notebook_id: string | null;
          notebook_name: string | null;
          notebook_source_id: string | null;
          notebook_source_added_at: string | null;
          quality_score: number | null;
          quality_report: unknown;
          result: unknown;
          failure_code: string | null;
          failure_message: string | null;
          approval_token: string | null;
          approval_started_at: string | null;
          approval_intent_hash: string | null;
          lease_token: string | null;
          lease_owner: string | null;
          lease_expires_at: string | null;
          attempt_count: number;
          last_processed_at: string | null;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          source_type?: string;
          source_key: string;
          source_url: string;
          video_id: string;
          title: string;
          channel_name?: string | null;
          source_guide?: string;
          metadata?: unknown;
          capture_ready?: boolean;
          tier?: string;
          status?: KnowledgeJobStatus;
          source_hash?: string | null;
          transcript_hash?: string | null;
          notebook_id?: string | null;
          notebook_name?: string | null;
          notebook_source_id?: string | null;
          notebook_source_added_at?: string | null;
          quality_score?: number | null;
          quality_report?: unknown;
          result?: unknown;
          failure_code?: string | null;
          failure_message?: string | null;
          approval_token?: string | null;
          approval_started_at?: string | null;
          approval_intent_hash?: string | null;
          lease_token?: string | null;
          lease_owner?: string | null;
          lease_expires_at?: string | null;
          attempt_count?: number;
          last_processed_at?: string | null;
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["knowledge_jobs"]["Row"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      save_knowledge_amendment: {
        Args: { p_user_id: string; p_job_id: string; p_expected_revision: number; p_base_revision: number; p_base_intent_hash: string; p_markdown: string };
        Returns: { id: string; user_id: string; job_id: string; amendment_revision: number; base_revision: number; base_intent_hash: string; markdown: string; created_at: string };
      };
      enqueue_knowledge_job: {
        Args: {
          p_source_type: string;
          p_source_key: string;
          p_source_url: string;
          p_video_id: string;
          p_title: string;
          p_channel_name?: string | null;
          p_source_guide?: string;
          p_metadata?: unknown;
        };
        Returns: Array<{
          id: string;
          video_id: string;
          status: KnowledgeJobStatus;
          created_at: string;
          updated_at: string;
          capture_ready: boolean;
          created: boolean;
        }>;
      };
      enqueue_knowledge_canary_job: {
        Args: {
          p_user_id: string;
          p_run_id: string;
          p_source_type: string;
          p_source_key: string;
          p_source_url: string;
          p_video_id: string;
          p_title: string;
          p_channel_name?: string | null;
          p_source_guide?: string;
        };
        Returns: Array<{
          id: string;
          video_id: string;
          status: KnowledgeJobStatus;
          created_at: string;
          updated_at: string;
          capture_ready: boolean;
          created: boolean;
        }>;
      };
      enrich_knowledge_job: {
        Args: {
          p_job_id: string;
          p_title: string;
          p_channel_name: string | null;
          p_source_guide: string;
        };
        Returns: Array<{
          id: string;
          video_id: string;
          status: KnowledgeJobStatus;
          created_at: string;
          updated_at: string;
          capture_ready: boolean;
        }>;
      };
      begin_knowledge_approval: {
        Args: {
          p_user_id: string;
          p_job_id: string;
          p_intent_hash: string;
        };
        Returns: Database["public"]["Tables"]["knowledge_jobs"]["Row"];
      };
      patch_knowledge_studio_draft: {
        Args: {
          p_user_id: string;
          p_job_id: string;
          p_expected_result: unknown;
          p_result: unknown;
        };
        Returns: Database["public"]["Tables"]["knowledge_jobs"]["Row"] | null;
      };
      begin_knowledge_studio_approval: {
        Args: {
          p_user_id: string;
          p_job_id: string;
          p_revision: number;
          p_markdown: string;
          p_intent_hash: string;
        };
        Returns: Database["public"]["Tables"]["knowledge_jobs"]["Row"];
      };
    };
  };
};

/** Supabase URL/Key가 실제로 유효한지 검사하는 헬퍼 */
function isValidSupabaseEnv(url: string | undefined, key: string | undefined): boolean {
  if (!url || !key) return false;

  // placeholder 값이면 무시
  if (url === "your_supabase_project_url") return false;
  if (key === "your_supabase_service_role_key") return false;

  // URL 형식 검증 (http/https 필수)
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
  } catch {
    return false;
  }

  return true;
}

/**
 * 서버 전용 Supabase 클라이언트.
 * - env가 없거나 placeholder면 null 반환해서 기능을 끌 수 있게 함.
 * - Service Role 키 사용 → 반드시 서버에서만 호출.
 */
export function getServerSupabaseClient():
  | SupabaseClient<Database>
  | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!isValidSupabaseEnv(url, serviceKey)) {
    // 설정 안 돼 있거나 placeholder면 안전하게 비활성화
    return null;
  }

  try {
    const client = createClient<Database>(url!, serviceKey!, {
      auth: {
        persistSession: false,
      },
    });
    return client;
  } catch (error) {
    console.error("Failed to create Supabase client. Disabling Supabase features.", error);
    return null;
  }
}

/**
 * 특정 테이블에 대한 타입을 강제하는 헬퍼 함수.
 * Supabase 클라이언트의 제네릭 추론 한계를 보완합니다.
 */
export function getTypedTable<T extends keyof Database["public"]["Tables"]>(
  tableName: T
) {
  const supabase = getServerSupabaseClient();
  if (!supabase) return null;
  return supabase.from(tableName);
}

/**
 * 요약(summaries) 기능 전용 Supabase 클라이언트 헬퍼.
 */
export function getSupabaseForSummaries() {
  return getTypedTable("summaries");
}

/**
 * Supabase PostgREST의 제네릭 추론이 insert/update/delete에서
 * `never`로 귀결되는 문제를 우회하는 헬퍼.
 * 타입 안전성보다 런타임 동작이 우선인 mutation 작업에 사용합니다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getMutationTable(tableName: string): any | null {
  const supabase = getServerSupabaseClient();
  if (!supabase) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase as any).from(tableName);
}
