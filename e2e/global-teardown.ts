import { closeDb } from "./helpers";

// Close the shared postgres pool so the Playwright process exits cleanly.
export default async function globalTeardown() {
  await closeDb();
}
