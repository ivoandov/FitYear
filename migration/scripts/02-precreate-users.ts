/**
 * Phase 2 step 3: Pre-create the 5 known users in Supabase Auth via admin API.
 *
 * Each existing email gets an auth.users row with a fresh Supabase UUID.
 * We capture { email, oldUserId, newUuid, firstName, lastName, profileImageUrl }
 * for every user and write the map to migration/snapshots/<date>/_user_map.json.
 *
 * When users later sign in via Google OAuth, Supabase matches by email and
 * links the OAuth provider to the existing pre-created auth row. They get
 * back into their account with all data intact.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY missing");
}

const admin = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface OldUser {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  profile_image_url: string | null;
  created_at: string;
}

interface MapEntry {
  email: string;
  oldUserId: string;
  newUuid: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  preExisted: boolean;
}

async function main() {
  // Find latest snapshot
  const snapshotsRoot = join(process.cwd(), "migration", "snapshots");
  const dates = readdirSync(snapshotsRoot).sort().reverse();
  if (dates.length === 0) throw new Error("No snapshots found");
  const latest = join(snapshotsRoot, dates[0]);
  console.log(`Using snapshot: ${latest}`);

  const oldUsers: OldUser[] = JSON.parse(
    readFileSync(join(latest, "users.json"), "utf8"),
  );

  console.log(`\nPre-creating ${oldUsers.length} users in Supabase Auth...\n`);

  const map: MapEntry[] = [];

  for (const u of oldUsers) {
    if (!u.email) {
      console.log(`  ⚠ skipping user ${u.id} — no email`);
      continue;
    }

    // Check if a user with this email already exists in Supabase
    const { data: existing } = await admin.auth.admin.listUsers();
    const found = existing?.users.find(
      (x) => x.email?.toLowerCase() === u.email!.toLowerCase(),
    );

    let newUuid: string;
    let preExisted = false;

    if (found) {
      newUuid = found.id;
      preExisted = true;
      console.log(`  ↻ ${u.email.padEnd(36)} already exists → ${newUuid}`);
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email: u.email,
        email_confirm: true,
        user_metadata: {
          first_name: u.first_name,
          last_name: u.last_name,
          profile_image_url: u.profile_image_url,
        },
      });
      if (error) {
        console.error(`  ✗ ${u.email.padEnd(36)} ERROR: ${error.message}`);
        continue;
      }
      newUuid = data.user.id;
      console.log(`  ✓ ${u.email.padEnd(36)} created → ${newUuid}`);
    }

    map.push({
      email: u.email,
      oldUserId: u.id,
      newUuid,
      firstName: u.first_name,
      lastName: u.last_name,
      profileImageUrl: u.profile_image_url,
      preExisted,
    });
  }

  // Save the map
  const mapPath = join(latest, "_user_map.json");
  writeFileSync(mapPath, JSON.stringify(map, null, 2), "utf8");

  console.log(`\n✓ Map saved to ${mapPath}`);
  console.log(`\nMap summary:`);
  console.log(`  ${map.length} users mapped`);
  console.log(`  ${map.filter((m) => m.preExisted).length} pre-existed`);
  console.log(`  ${map.filter((m) => !m.preExisted).length} newly created`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
