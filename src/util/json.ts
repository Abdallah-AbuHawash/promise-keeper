/**
 * Best-effort extraction of a single JSON object from model output that may be
 * wrapped in a ```json code fence or surrounded by prose.
 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();

  // 1. Fenced block ```json ... ``` or ``` ... ```
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* fall through */
    }
  }

  // 2. Whole string is JSON.
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }

  // 3. First balanced-looking {...} span.
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      /* fall through */
    }
  }

  throw new Error('No parseable JSON object found in model output');
}
