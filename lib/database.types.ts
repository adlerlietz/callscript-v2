export type CallStatus =
  | "pending"
  | "downloaded"
  | "processing"
  | "transcribed"
  | "flagged"
  | "safe"
  | "failed";

export type FlagSeverity = "critical" | "high" | "medium";

// QA flags from the Judge lane - object structure (not array)
export interface QaFlags {
  score?: number;
  summary?: string;
  compliance_issues?: string[];
  customer_sentiment?: string;
  professionalism_score?: number;
  did_greet?: boolean;
  did_ask_for_sale?: boolean;
  analyzed_at?: string;
  // Error case (skipped calls)
  error?: string;
  skipped?: boolean;
  reason?: string;
  skipped_at?: string;
}

export interface TranscriptSegment {
  speaker: string;
  start: number;
  end: number;
  text: string;
}

export interface Call {
  id: string;
  ringba_call_id: string;
  campaign_id: string | null;
  start_time_utc: string;
  updated_at: string;
  caller_number: string | null;
  duration_seconds: number | null;
  revenue: number | null;
  audio_url: string | null;
  storage_path: string | null;
  status: CallStatus;
  retry_count: number;
  processing_error: string | null;
  transcript_text: string | null;
  transcript_segments: TranscriptSegment[] | null;
  qa_flags: QaFlags | null;
  qa_version: string | null;
  judge_model: string | null;
  // Analytics columns (Phase 1)
  publisher_id: string | null;
  publisher_sub_id: string | null;
  publisher_name: string | null;
  buyer_name: string | null;
  target_id: string | null;
  target_name: string | null;
  payout: number | null;
  caller_state: string | null;
  caller_city: string | null;
  profit: number | null;
}

export interface Campaign {
  id: string;
  ringba_campaign_id: string;
  name: string;
  vertical: string;
  inference_source: string | null;
  is_verified: boolean;
}

export interface Database {
  core: {
    Tables: {
      calls: {
        Row: Call;
        Insert: Omit<Call, "id" | "updated_at">;
        Update: Partial<Call>;
      };
      campaigns: {
        Row: Campaign;
        Insert: Omit<Campaign, "id">;
        Update: Partial<Campaign>;
      };
    };
  };
}
