/**
 * The duplicate guard's answer, read out of a thrown `apiRequest` error.
 *
 * `POST /api/exercises` answers 409 + { error: "duplicate", match } when the
 * name confidently matches an existing exercise. Moved out of the Exercises
 * page on 2026-09-30 when the tracker gained its own create flow, so both read
 * the guard the same way. Anything else returns null.
 */
export function duplicateMatchFrom(e: unknown): { id: string; name: string } | null {
  if (!(e instanceof Error)) return null;
  const m = e.message.match(/^409:\s*([\s\S]*)$/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]);
    if (parsed?.error === "duplicate" && parsed.match?.id && parsed.match?.name) {
      return { id: parsed.match.id, name: parsed.match.name };
    }
  } catch {
    // not our payload
  }
  return null;
}
