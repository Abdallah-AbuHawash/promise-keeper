/**
 * Domain types shared across the app.
 */

/** Priority levels we map onto ClickUp's priority field. */
export type Priority = 'low' | 'normal' | 'high' | 'urgent';

/** Which lane surfaced a commitment. */
export type Source = 'pin' | 'sweep';

/** Lifecycle of a commitment. */
export type CommitmentStatus =
  | 'pending_approval' // extracted, waiting for the engineer to confirm on Telegram
  | 'created' // a ClickUp task exists and is open
  | 'done' // marked complete; ClickUp task closed
  | 'dismissed' // the engineer rejected it (false positive or not worth tracking)
  | 'snoozed'; // hidden until snoozed_until passes

/**
 * The structured output Claude produces for a single promise found in a Slack
 * message/thread. This is the contract enforced by the JSON schema in
 * src/anthropic/schema.ts.
 */
export interface ExtractedCommitment {
  /** Short imperative summary of what was promised. Becomes the ClickUp task title. */
  deliverable: string;
  /** Who the promise was made to (customer/company/person), or null if unclear. */
  customer: string | null;
  /** Due date as ISO-8601 (YYYY-MM-DD), resolved from phrases like "by Friday". Null if none. */
  dueDate: string | null;
  /** Priority inferred from tone/urgency. */
  priority: Priority;
  /** 0-1 confidence that this is a genuine, trackable commitment. */
  confidence: number;
  /** The exact sentence/quote that contains the promise. */
  quote: string;
  /** One-line justification — shown in the Telegram card so the engineer can sanity-check. */
  reasoning: string;
}

/** Wrapper returned by the extractor (a message may contain zero or more promises). */
export interface ExtractionResult {
  commitments: ExtractedCommitment[];
}

/** A row in the `commitments` table. */
export interface CommitmentRow {
  id: number;
  source: Source;
  status: CommitmentStatus;

  // Slack provenance
  slack_channel_id: string;
  slack_message_ts: string;
  slack_thread_ts: string | null;
  slack_user_id: string;
  slack_permalink: string | null;

  // Extracted fields
  deliverable: string;
  customer: string | null;
  due_at: number | null; // epoch ms
  priority: Priority;
  confidence: number;
  quote: string;
  reasoning: string;

  // Telegram approval card
  telegram_chat_id: number | null;
  telegram_message_id: number | null;

  // ClickUp linkage
  clickup_task_id: string | null;
  clickup_task_url: string | null;

  // Reminders
  snoozed_until: number | null; // epoch ms
  reminder_sent_at: number | null; // epoch ms

  created_at: number; // epoch ms
  updated_at: number; // epoch ms
}

/** Maps a Slack user to the Telegram chat where their cards/reminders are delivered. */
export interface UserLinkRow {
  slack_user_id: string;
  telegram_chat_id: number;
  display_name: string | null;
  created_at: number;
}
