import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
async function main() {
  const rows = await sql`
    select user_id, count(*) as total,
           count(routine_instance_id) as linked, count(routine_day_index) as day_idx
    from completed_workouts group by user_id order by total desc limit 3`;
  for (const r of rows) console.log(`${String(r.user_id).slice(0,8)}… total=${r.total} linkedToProgram=${r.linked} hasDayIndex=${r.day_idx}`);
  const [ex] = await sql`select count(*) as n, count(image_url) as with_image from exercises`;
  console.log("catalog:", ex.n, "exercises,", ex.with_image, "with an image");
}
main().catch((e) => { console.error(e); process.exit(1); });
