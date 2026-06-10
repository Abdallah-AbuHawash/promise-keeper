import { z } from 'zod';

/** Priority enum, tolerant of unexpected values from the model. */
const PrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']).catch('normal');

/**
 * A single promise extracted from Slack. `messageTs` is populated by the sweep
 * lane (Claude reads it from the Slack MCP results) so we can attribute and
 * dedup; the pin lane already knows the ts and overrides it.
 */
export const ExtractedCommitmentSchema = z.object({
  deliverable: z.string().min(1),
  customer: z.string().nullable().catch(null),
  dueDate: z.string().nullable().catch(null),
  priority: PrioritySchema,
  confidence: z.number().catch(0.5),
  quote: z.string().catch(''),
  reasoning: z.string().catch(''),
  messageTs: z.string().nullable().optional(),
  /** Slack user id of the engineer who made the promise (sweep lane). */
  authorUserId: z.string().nullable().optional(),
});

export type ExtractedCommitmentParsed = z.infer<typeof ExtractedCommitmentSchema>;

/** Result envelope from an extraction call. */
export const ExtractionResultSchema = z.object({
  commitments: z.array(ExtractedCommitmentSchema).catch([]),
  /** Newest Slack message ts the sweep examined, used to advance the cursor. */
  latestTs: z.string().nullable().optional(),
});

export type ExtractionResultParsed = z.infer<typeof ExtractionResultSchema>;

/** Result of asking the agent to create a ClickUp task via the ClickUp MCP. */
export const ClickUpResultSchema = z.object({
  taskId: z.string().min(1),
  url: z.string().nullable().catch(null),
  status: z.string().catch('open'),
});

export type ClickUpResultParsed = z.infer<typeof ClickUpResultSchema>;
