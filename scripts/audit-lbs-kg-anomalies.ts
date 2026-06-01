/**
 * Audit Supabase completed_workouts for sets whose `weight` value was
 * probably saved as a raw kg number instead of being converted to lbs.
 *
 * Heuristic per (user, exerciseId):
 *   - Compute the median lbs across all completed, non-zero sets.
 *   - For each set whose weight is suspiciously low (< 60% of median),
 *     test if multiplying by 2.20462 lands within ±25% of the median.
 *     If yes → strong candidate for a kg-as-lbs misrecord.
 *
 * Outputs candidates grouped by user with proposed corrections. Does NOT
 * write — that's a second pass once you've eyeballed the list.
 *
 * Run: npx tsx scripts/_audit-lbs-kg.ts
 *   --user=<email>    only audit this user (default: every user with weightUnit='kg')
 *   --min-sets=N      minimum sets per (user,exercise) before flagging (default: 5)
 *   --json            machine-readable output
 */
import postgres from "postgres";
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local") });

const args = process.argv.slice(2);
const userArg = args.find((a) => a.startsWith("--user="))?.split("=")[1];
const minSets = Number(args.find((a) => a.startsWith("--min-sets="))?.split("=")[1] ?? 5);
const asJson = args.includes("--json");

const LBS_PER_KG = 2.20462;

type SetData = {
  setNumber?: number;
  weight?: number | null;
  reps?: number | null;
  completed?: boolean;
};
type ExJson = { id: string; name?: string; setsData?: SetData[] };

async function main() {
  const SUPA = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 1 });

  // Pull users + current weightUnit + email
  const users = (await SUPA`
    SELECT au.id::text AS id, au.email, us.weight_unit
    FROM auth.users au
    LEFT JOIN public.user_settings us ON us.user_id = au.id
  `) as { id: string; email: string; weight_unit: string | null }[];

  // Audit ALL users by default — historical kg-mode rows can exist even on a
  // user whose current setting is lbs. Pass --user=<email> to narrow.
  const targets = userArg
    ? users.filter((u) => u.email.toLowerCase() === userArg.toLowerCase())
    : users;

  if (targets.length === 0) {
    console.log(
      userArg
        ? `No user matched email=${userArg}`
        : `No users with weight_unit='kg'`,
    );
    console.log(
      "All users:",
      users.map((u) => `${u.email}:${u.weight_unit ?? "(no setting)"}`).join(" "),
    );
    await SUPA.end();
    return;
  }

  if (!asJson) {
    console.log(`Auditing ${targets.length} user(s):`);
    for (const u of targets) console.log(`  ${u.email}  (weight_unit=${u.weight_unit ?? "?"})`);
    console.log();
  }

  const allFindings: Array<{
    email: string;
    workoutId: string;
    completedAt: string;
    workoutName: string;
    exerciseId: string;
    exerciseName: string;
    setIdx: number;
    currentLbs: number;
    proposedLbs: number;
    reps: number;
    medianLbs: number;
    confidence: "high" | "medium" | "low";
  }> = [];

  for (const user of targets) {
    // Pull this user's completed workouts (with timestamps for sorting)
    const workouts = (await SUPA`
      SELECT id, name, completed_at::text AS completed_at, exercises
      FROM completed_workouts
      WHERE user_id = ${SUPA.unsafe(`'${user.id}'::uuid`)}
      ORDER BY completed_at
    `) as { id: string; name: string; completed_at: string; exercises: unknown }[];

    // Bucket all (user × exerciseId) lbs weights so we can compute a median.
    const weightsByEx = new Map<string, number[]>();
    const nameByEx = new Map<string, string>();
    for (const w of workouts) {
      for (const ex of (w.exercises as ExJson[]) ?? []) {
        if (!ex?.id || !ex.setsData) continue;
        if (ex.name) nameByEx.set(ex.id, ex.name);
        for (const s of ex.setsData) {
          if (!s.completed || s.weight == null || s.weight <= 0) continue;
          let arr = weightsByEx.get(ex.id);
          if (!arr) {
            arr = [];
            weightsByEx.set(ex.id, arr);
          }
          arr.push(s.weight);
        }
      }
    }

    // Compute medians; skip (ex) with too few data points
    const medianByEx = new Map<string, number>();
    for (const [exId, arr] of weightsByEx) {
      if (arr.length < minSets) continue;
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = sorted.length >>> 1;
      const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      medianByEx.set(exId, median);
    }

    // Now sweep for suspicious sets
    for (const w of workouts) {
      for (const ex of (w.exercises as ExJson[]) ?? []) {
        if (!ex?.id || !ex.setsData) continue;
        const median = medianByEx.get(ex.id);
        if (!median) continue;
        for (let i = 0; i < ex.setsData.length; i++) {
          const s = ex.setsData[i];
          if (!s.completed || s.weight == null || s.weight <= 0) continue;
          const w_lbs = s.weight;
          // anomaly: actual weight is < 60% of median and (weight * 2.2) lands within ±25% of median
          const ratioRaw = w_lbs / median;
          const convCandidate = w_lbs * LBS_PER_KG;
          const ratioConv = convCandidate / median;
          if (ratioRaw < 0.6 && ratioConv >= 0.75 && ratioConv <= 1.25) {
            // False-positive check: if the current value, treated as lbs, would
            // map back to a CLEAN kg integer or half-integer, it's probably
            // already been converted from kg (a real lighter set), not a raw
            // kg-as-lbs misrecord. Examples: 44.1 → 20.00 kg, 13.2 → 5.99 kg.
            const kgIfAlreadyConverted = w_lbs / LBS_PER_KG;
            const nearestHalfKg = Math.round(kgIfAlreadyConverted * 2) / 2;
            const halfKgDelta = Math.abs(kgIfAlreadyConverted - nearestHalfKg);
            const looksAlreadyConverted = halfKgDelta < 0.06; // tolerance

            // Mirror check: does the current value look like a clean kg input
            // (raw integer or half-integer)? That's the canonical "saved as kg"
            // pattern (e.g. user typed 15, stored 15 instead of 33).
            const nearestHalfRaw = Math.round(w_lbs * 2) / 2;
            const halfRawDelta = Math.abs(w_lbs - nearestHalfRaw);
            const looksRawKg = halfRawDelta < 0.06;

            let confidence: "high" | "medium" | "low";
            if (looksAlreadyConverted && !looksRawKg) {
              confidence = "low"; // probably a real lighter day, not corruption
            } else if (looksRawKg && !looksAlreadyConverted) {
              confidence = ratioConv >= 0.85 && ratioConv <= 1.15 ? "high" : "medium";
            } else {
              // Ambiguous — both patterns fit (e.g. 22 lbs could be 10 kg
              // already-converted, or 22 kg raw → 48 lbs). Flag as medium.
              confidence = "medium";
            }

            allFindings.push({
              email: user.email,
              workoutId: w.id,
              completedAt: w.completed_at,
              workoutName: w.name,
              exerciseId: ex.id,
              exerciseName: ex.name ?? nameByEx.get(ex.id) ?? ex.id,
              setIdx: i,
              currentLbs: w_lbs,
              proposedLbs: Math.round(convCandidate * 10) / 10,
              reps: s.reps ?? 0,
              medianLbs: Math.round(median * 10) / 10,
              confidence,
            });
          }
        }
      }
    }
  }

  await SUPA.end();

  if (asJson) {
    console.log(JSON.stringify(allFindings, null, 2));
    return;
  }

  if (allFindings.length === 0) {
    console.log("No suspicious rows found.");
    return;
  }

  // Group by user → workout
  const byUser = new Map<string, typeof allFindings>();
  for (const f of allFindings) {
    let arr = byUser.get(f.email);
    if (!arr) {
      arr = [];
      byUser.set(f.email, arr);
    }
    arr.push(f);
  }

  for (const [email, findings] of byUser) {
    console.log(`\n=== ${email} (${findings.length} suspicious sets) ===`);
    // Group by workout
    const byWorkout = new Map<string, typeof findings>();
    for (const f of findings) {
      let arr = byWorkout.get(f.workoutId);
      if (!arr) {
        arr = [];
        byWorkout.set(f.workoutId, arr);
      }
      arr.push(f);
    }
    for (const [wid, fs] of byWorkout) {
      const w = fs[0];
      console.log(
        `\n  ${w.completedAt.slice(0, 16)}  "${w.workoutName}"  (${wid.slice(0, 8)})`,
      );
      for (const f of fs) {
        console.log(
          `    [${f.confidence}] ${f.exerciseName} set ${f.setIdx + 1}: ` +
            `${f.currentLbs} → ${f.proposedLbs} lbs ` +
            `(reps=${f.reps}, your median for this exercise: ${f.medianLbs} lbs)`,
        );
      }
    }
  }

  console.log(`\nTotal: ${allFindings.length} suspicious sets across ${byUser.size} user(s).`);
  console.log("\nNothing written. To apply, re-run scripts/_fix-lbs-kg.ts --apply once you've reviewed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
