/**
 * Write short coaching cues onto every catalog exercise.
 *
 * Ivo picked this over licensing a video library (2026-09-09, verbatim: "fuck
 * musclewiki"). The reasoning is recorded in product/FEATURE_GAP_ANALYSIS.md:
 * MuscleWiki's free tier is Playground-only and carries no commercial rights,
 * its terms forbid storing or re-hosting any media, and it requires their
 * branding to stay inside the videos. Cues cost nothing, belong to us, work
 * offline and are the more useful thing mid-set.
 *
 * Batched: one model call per chunk of exercises rather than one per exercise,
 * because the quota counts CALLS. Idempotent by default - only exercises with
 * no cues are sent - so a re-run after adding ten exercises costs one call.
 *
 *   npx tsx --env-file=.env.local scripts/generate-form-cues.ts            # dry run
 *   npx tsx --env-file=.env.local scripts/generate-form-cues.ts --apply
 *   npx tsx --env-file=.env.local scripts/generate-form-cues.ts --apply --all
 */
import Anthropic from "@anthropic-ai/sdk";
import postgres from "postgres";
import { z } from "zod";

const BATCH = 20;

const CueSchema = z.object({
  cues: z.array(
    z.object({
      name: z.string(),
      cues: z.array(z.string().min(3).max(120)).min(1).max(3),
    }),
  ),
});

function extractJson(raw: string): unknown {
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("no JSON in model output");
  return JSON.parse(raw.slice(first, last + 1));
}

async function main() {
  const apply = process.argv.includes("--apply");
  const all = process.argv.includes("--all");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const sql = postgres(url, { prepare: false, max: 2 });
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const rows = all
      ? await sql`select id, name, muscle_groups, exercise_type from exercises order by name`
      : await sql`select id, name, muscle_groups, exercise_type from exercises where form_cues is null order by name`;
    console.log(`${rows.length} exercises need cues${all ? " (--all: regenerating every one)" : ""}`);
    if (!rows.length) return;
    if (!apply) {
      console.log(`DRY RUN. ${Math.ceil(rows.length / BATCH)} model calls would run. Re-run with --apply.`);
      console.log(rows.slice(0, 10).map((r) => `  ${r.name}`).join("\n"));
      return;
    }

    let written = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const list = chunk
        .map((r) => `- ${r.name} (${(Array.isArray(r.muscle_groups) ? r.muscle_groups : []).join(", ") || "unspecified"}, ${r.exercise_type})`)
        .join("\n");

      const prompt = `You are a strength coach writing the two or three cues you would actually say to somebody mid-set.

EXERCISES:
${list}

RULES.
- Two or three cues each. Short imperative phrases, under 12 words.
- Cue the thing people get WRONG, not the obvious. "Elbows at 45, not flared" beats "lower the bar to your chest".
- Setup, execution, and the common failure - in that order when all three fit.
- No medical claims, no rep counts, no weight advice.
- Plain gym language. No jargon a beginner would have to look up.
- Match the exercise you were given. Do not rename it.

Return ONLY valid JSON, no preamble and no markdown fences:
{"cues":[{"name":"<exact name as given>","cues":["...","..."]}]}`;

      const message = await client.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });
      let raw = "";
      for (const block of message.content) if (block.type === "text") raw += block.text;

      const parsed = CueSchema.safeParse(extractJson(raw));
      if (!parsed.success) {
        console.error(`  batch ${i / BATCH + 1}: schema rejected`, parsed.error.issues.slice(0, 3));
        continue;
      }
      const byName = new Map(parsed.data.cues.map((c) => [c.name.trim().toLowerCase(), c.cues]));
      for (const row of chunk) {
        const cues = byName.get(String(row.name).trim().toLowerCase());
        if (!cues?.length) {
          console.error(`  no cues returned for "${row.name}"`);
          continue;
        }
        // sql.json, NOT JSON.stringify: postgres.js stores a stringified array
        // as a jsonb STRING, which every array reader then silently skips.
        await sql`update exercises set form_cues = ${sql.json(cues)} where id = ${row.id}`;
        written++;
      }
      console.log(`  batch ${i / BATCH + 1}/${Math.ceil(rows.length / BATCH)} done (${written} written)`);
    }

    const [check] = await sql`
      select
        count(*) filter (where form_cues is not null)::int as with_cues,
        count(*) filter (where jsonb_typeof(form_cues) = 'array')::int as real_arrays,
        count(*)::int as total
      from exercises`;
    console.log(`VERIFY: ${check.with_cues}/${check.total} have cues, ${check.real_arrays} are real jsonb arrays`);
    if (check.with_cues !== check.real_arrays) {
      throw new Error("some cues stored as jsonb STRINGS - the sql.json trap");
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
