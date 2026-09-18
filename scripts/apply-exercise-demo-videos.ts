/**
 * Populate `exercises.video_id` so the demonstration embed on the exercise
 * detail page finally has something to render.
 *
 * The embed, the `video_id` column and the CSP `frame-src` allowance for
 * youtube-nocookie were all built long ago and **nothing ever wrote the
 * column**: 0 of 154 rows carried a video, so that card has never once
 * appeared. Same class as `/api/workout-templates/routine-usage` and
 * `workout_exercises.is_assisted` - infrastructure complete, writer absent.
 *
 * WHERE THE MAPPING COMES FROM. Jensen at Strength to Overcome
 * (strengthtoovercome.com, Collingwood ON) publishes a curated spreadsheet of
 * 3,242 functional-fitness exercises, each with a hand-picked YouTube
 * demonstration. 2,013 short-demo links were extracted from the .xlsx (a CSV
 * export loses them - the cells are hyperlinked text, so CSV gives the label
 * and not the URL).
 *
 * THE MATCHING WAS DONE BY HAND AND THAT IS NOT OPTIONAL. Automated matching
 * produced confident nonsense on real data: "Barbell Squat" matched "Barbell
 * Overhead Squat" (a different lift), "Cable Fly Low to High" matched the HIGH
 * TO LOW video, "Back Extensions" and "Leg Extensions" both matched "Ring Tuck
 * Back Lever with Alternating Single Leg Extensions", and "Cable External
 * Rotations" matched a HIP external rotation. It also tried to merge three
 * pairs Ivo explicitly ratified as KEEP-SEPARATE (Cable Kickback vs Cable Glute
 * Kickback, Goblet Squat vs Dumbbell Goblet Squat, Split Squats vs Bulgarian).
 * Every pairing below was read and accepted individually; 36 of 154 survived,
 * and `source` records which of Jensen's entries each came from so any one of
 * them can be re-judged later.
 *
 * Nothing is re-hosted. These are video IDs played through YouTube's own
 * embed, which is what YouTube provides embedding for.
 *
 * Idempotent: re-running sets the same values. Run with:
 *   npx tsx --env-file=.env.local scripts/apply-exercise-demo-videos.ts
 *   npx tsx --env-file=.env.local scripts/apply-exercise-demo-videos.ts --dry-run
 */
import postgres from "postgres";

/** Our exercise name -> the YouTube id, and the entry it was matched against. */
const DEMOS: { name: string; videoId: string; source: string }[] = [
  { name: "Ab Wheel Rollouts", videoId: "QB2Gj1QGfjQ", source: "Ab Wheel Kneeling Rollout" },
  { name: "Band Pull Apart", videoId: "Z9Bryd2XtwY", source: "Resistance Band Pull Apart" },
  { name: "Bar Pushdowns", videoId: "LXkCrxn3caQ", source: "Cable Straight Bar Tricep Pushdown" },
  { name: "Barbell Bent Over Row", videoId: "9Gf-Ourup_k", source: "Barbell Bent Over Row" },
  { name: "Bench Press", videoId: "SCVCLChPQFY", source: "Barbell Bench Press" },
  { name: "Bird Dog", videoId: "tU-WZsouVjo", source: "Bodyweight Bird Dog" },
  { name: "Bodyweight Squats", videoId: "C_VtOYc6j5c", source: "Bodyweight Squat" },
  { name: "Bulgarian Split Squats", videoId: "kBQ1krvKFBU", source: "Bodyweight Bulgarian Split Squat" },
  { name: "Cable Crunch", videoId: "gQT76pz_X9Y", source: "Cable Seated Crunch" },
  { name: "Cable Fly", videoId: "rmwijjkuXug", source: "Double Cable Chest Fly" },
  { name: "Cable Fly High to Low", videoId: "ixn_1zDpCPc", source: "Double Cable High to Low Chest Fly" },
  { name: "Cable Glute Kickback", videoId: "qJxwJ1e1HxI", source: "Cable Glute Kickback" },
  { name: "Cable Half Kneeling Pallof Press", videoId: "7JBR6JGE1hY", source: "Cable Half Kneeling Pallof Press" },
  { name: "Cable Lat Pulldown", videoId: "UWhyxvCCzhw", source: "Cable Wide Grip Lat Pulldown" },
  { name: "Cable Pull Through", videoId: "NEDrQPoITMc", source: "Cable Pull Through" },
  { name: "Cable Rope Pushdowns", videoId: "e5aj8hhCPkA", source: "Cable Rope Tricep Pushdown" },
  { name: "Cable Single Arm Kneeling Row", videoId: "redrpTwkplw", source: "Single Arm Cable Half Kneeling Low Row" },
  { name: "Dead Bug", videoId: "jbWmbhElf3Q", source: "Bodyweight Dead Bug" },
  { name: "Deadlift", videoId: "op9kVnSso6Q", source: "Barbell Conventional Deadlift" },
  { name: "Dumbbell Arnold Press", videoId: "sbGP9VjnjEg", source: "Double Dumbbell Arnold Press" },
  { name: "Dumbbell Bent Over Row", videoId: "6gvmcqr226U", source: "Double Dumbbell Bent Over Row" },
  { name: "Dumbbell Decline Bench Press", videoId: "2B6WxyLaIrE", source: "Double Dumbbell Decline Bench Press" },
  { name: "Dumbbell Fly", videoId: "Nhvz9EzdJ4U", source: "Double Dumbbell Chest Fly" },
  { name: "Dumbbell Goblet Squat", videoId: "a-dqF4NL2K4", source: "Dumbbell Goblet Squat" },
  { name: "Dumbbell Half Kneeling Single Arm Press", videoId: "4DUIY95jX6Y", source: "Single Arm Dumbbell Half Kneeling Contralateral Overhead Press" },
  { name: "Dumbbell Incline Bench Press", videoId: "7QUcsq019Qs", source: "Double Dumbbell Incline Bench Press" },
  { name: "Dumbbell Romanian Deadlift", videoId: "Cf3CaHui43A", source: "Double Dumbbell Romanian Deadlift" },
  { name: "Dumbbell Skull Crushers", videoId: "jO2Jl9eZpXk", source: "Double Dumbbell Skull Crusher" },
  { name: "EZ Bar Lying Extension", videoId: "fUW3C1lVWkk", source: "EZ Bar Lying Tricep Extension" },
  { name: "Hammer Curls", videoId: "fM0TQLoesLs", source: "Double Dumbbell Hammer Curl" },
  { name: "Kettlebell Goblet Squat", videoId: "f-Vf2yRRqOg", source: "Kettlebell Goblet Squat" },
  { name: "Lat Pulldown", videoId: "UWhyxvCCzhw", source: "Cable Wide Grip Lat Pulldown" },
  { name: "Nordic Hamstring Curls", videoId: "kjv4WQXWl_A", source: "Bodyweight Nordic Hamstring Curl" },
  { name: "Shoulder External Rotation", videoId: "4cpQr1VbcEU", source: "Miniband Standing Shoulder External Rotation" },
  { name: "Side Lying Clamshells", videoId: "vSpyJR3dA7s", source: "Miniband Side Lying Clamshell" },
  { name: "Tricep Kickbacks", videoId: "m_UlDFNX4mk", source: "Double Dumbbell Tricep Kickback" },
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 5 });

  try {
    let matched = 0;
    const absent: string[] = [];

    for (const demo of DEMOS) {
      // Matched on the exact stored name. The catalog is canonicalised on every
      // write, so a name here that finds nothing means the row was renamed -
      // which should be reported rather than silently skipped.
      const rows = await sql`select id from exercises where name = ${demo.name}`;
      if (rows.length === 0) {
        absent.push(demo.name);
        continue;
      }
      matched += rows.length;
      if (!dryRun) {
        await sql`update exercises set video_id = ${demo.videoId} where name = ${demo.name}`;
      }
    }

    console.log(`${dryRun ? "DRY-RUN" : "APPLIED"}: ${matched} row(s) from ${DEMOS.length} mappings`);
    if (absent.length) {
      console.log(`\nNOT FOUND in the catalog (renamed or removed):`);
      absent.forEach((a) => console.log(`  - ${a}`));
    }

    const [after] = await sql`select count(video_id)::int as n from exercises`;
    console.log(`exercises with a demonstration video: ${after.n}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
