import Anthropic from "@anthropic-ai/sdk";

/**
 * Fill in the parts of a new exercise the user cannot type.
 *
 * `formCues` and `videoId` are omitted from the create schema on purpose - a
 * client-writable field on a SHARED catalog is an availability bug for every
 * user at once - so nothing has ever populated them on a new row. The whole
 * catalog has cues because a script backfilled them; anything added since would
 * have had none, showing an exercise detail page with no "How to do it" and the
 * tracker with no cues under the target line.
 *
 * Both run AFTER the row exists and neither may fail the request. A create that
 * 500s because a model call was slow would be a far worse outcome than an
 * exercise that is briefly missing its cues.
 */

/**
 * A demonstration video, free and instant.
 *
 * The reference vocabulary carries ~1,995 hand-picked YouTube ids, and the Add
 * Exercise autocomplete now suggests those very names - so without this, a user
 * picks "Barbell Pendlay Row" from the suggestions and the row lands with no
 * video while the id sits in the repo unused. Same shape as the embed itself,
 * which existed for months with nothing writing its column.
 *
 * A LOCAL lookup, so it costs nothing and cannot fail: no API call, no key, no
 * latency. The id is matched through the app's own matcher at its own
 * threshold, so a video is attached only when the names genuinely correspond.
 *
 * DYNAMICALLY imported, which matters: the reference data is ~635KB and lives
 * in the same route file that serves the catalog GET on nearly every page load.
 * A static import would put it in that function's bundle and make every cold
 * start pay for it. This way only a create ever loads it.
 */
export async function demoVideoIdFor(name: string): Promise<string | null> {
  try {
    const { canonicalNameFor } = await import("@/lib/exercise-reference");
    return canonicalNameFor(name)?.videoId ?? null;
  } catch {
    return null;
  }
}

/**
 * Deliberately close to `scripts/generate-form-cues.ts`, which produced all 154
 * existing cues with ZERO em dashes in them.
 *
 * The UNDER 12 WORDS limit is the load-bearing part and was learned the hard
 * way: a first draft allowed 120 characters, the model wrote full sentences,
 * and it reached for em dashes in two cues out of three. Em dashes are a hard
 * house rule and this text is rendered in the app, so the length cap is what
 * keeps the voice terse enough that the punctuation never comes up. The strip
 * below is the backstop, because a prompt is a request and not a guarantee.
 */
const CUES_SYSTEM = `You are a strength coach writing the two or three cues you would actually say to somebody mid-set.

RULES.
- Two or three cues. Short imperative phrases, UNDER 12 WORDS each.
- Cue the thing people get WRONG, not the obvious. "Elbows at 45, not flared" beats "lower the bar to your chest".
- Setup, execution, and the common failure, in that order when all three fit.
- No medical claims, no rep counts, no weight advice.
- Plain gym language. No jargon a beginner would have to look up.
- Never use an em dash or an en dash. Use a comma or a full stop.

Reply with ONLY a JSON array of strings. No prose, no code fence.`;

/**
 * Strip dashes the prompt asked the model not to use.
 *
 * Only ever applied to a generated CUE STRING - never to anything parsed, and
 * never as a blanket sweep over source. A dash inside a regex or a parser is
 * INPUT, not prose, and a previous blanket replacement turned a character class
 * into a range and broke exercise naming.
 */
export function withoutDashes(cue: string): string {
  return cue.replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/\s+,/g, ",").trim();
}

/**
 * Coaching cues for one exercise.
 *
 * Deliberately NOT batched, unlike `scripts/generate-form-cues.ts` which sends
 * twenty at a time because the daily quota counts CALLS. This runs on one row
 * that a person just created, so there is nothing to batch with, and the
 * alternative is the exercise waiting for the next manual script run.
 */
export async function generateCuesFor(
  exerciseName: string,
  description?: string | null,
): Promise<string[] | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  try {
    const client = new Anthropic({ apiKey: key });
    const message = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 400,
      system: CUES_SYSTEM,
      messages: [
        {
          role: "user",
          content: `${exerciseName}${description ? `\n${description}` : ""}`,
        },
      ],
    });

    const raw = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    // The model is asked for a bare array but may still wrap it; take the first
    // bracketed span rather than trusting the whole string to be JSON.
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start < 0 || end <= start) return null;

    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed)) return null;

    const cues = parsed
      .filter((c): c is string => typeof c === "string")
      .map((c) => c.trim())
      .map(withoutDashes)
      .filter((c) => c.length >= 3 && c.length <= 120)
      .slice(0, 3);

    return cues.length > 0 ? cues : null;
  } catch {
    return null;
  }
}

/**
 * Enrich a freshly created exercise in the background.
 *
 * Swallows everything. The row already exists and the user already has their
 * exercise; a failure here costs cues, not the creation.
 */
export async function enrichNewExercise(
  id: string,
  name: string,
  description?: string | null,
): Promise<void> {
  try {
    // The database client is imported LAZILY, like the reference data above.
    // `lib/db` throws at module load when DATABASE_URL is absent, which is the
    // unit-test environment - so a static import here would make the pure
    // helpers in this file untestable for the sake of one function that needs
    // them.
    const [{ db }, { exercises }, { eq }] = await Promise.all([
      import("@/lib/db"),
      import("@/lib/db/schema"),
      import("drizzle-orm"),
    ]);

    // Both in ONE update: two writes to the same row for one create is a
    // pointless extra round trip, and the video lookup is instant anyway.
    const [cues, videoId] = await Promise.all([
      generateCuesFor(name, description),
      demoVideoIdFor(name),
    ]);

    const patch: { formCues?: string[]; videoId?: string } = {};
    if (cues) patch.formCues = cues;
    if (videoId) patch.videoId = videoId;
    if (Object.keys(patch).length === 0) return;

    await db.update(exercises).set(patch).where(eq(exercises.id, id));
  } catch (e) {
    console.error("[exercises] could not enrich", name, e);
  }
}
