/**
 * Documents somebody gives their coach: stored whole, listed without their
 * text, readable one at a time, and deletable.
 *
 * The rows here can hold medical records, so the ownership check is asserted
 * rather than assumed: an id arriving from a browser is not proof that it is
 * yours. `coach_documents` has a real foreign key to auth.users, but the
 * userId scoping in the helper is what stops one person reading another's.
 */
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { sql } from "./helpers";

const REPORT = `MRI LUMBAR SPINE WITHOUT CONTRAST
CLINICAL: Low back pain radiating to the left posterior thigh.
FINDINGS: L5-S1 moderate left paracentral disc extrusion measuring 8 mm with
mass effect on the traversing left S1 nerve root.
IMPRESSION: L5-S1 left paracentral disc extrusion with S1 impingement.`;

test("a document is stored whole, listed as a preview, and deletable", async ({
  page,
  account,
}) => {
  // Through `main`: a server-rendered page briefly holds a second copy of its
  // tree in a hidden container while React streams it, and getByTestId matches
  // hidden elements.
  const card = page.locator("main").getByTestId("card-coach-documents");
  await page.goto("/settings");
  await expect(card).toBeVisible({ timeout: 20000 });
  await expect(page.locator("main").getByTestId("text-documents-empty")).toBeVisible();

  const created = await page.evaluate(async (content) => {
    const res = await fetch("/api/coach-documents", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Lumbar MRI, September 2026", content }),
    });
    return { status: res.status, body: await res.json() };
  }, REPORT);
  expect(created.status).toBe(201);

  // The listing carries a PREVIEW, never the text: a library of reports would
  // be a large payload on a settings screen that mostly wants titles.
  const listed = await page.evaluate(async () => {
    const res = await fetch("/api/coach-documents", { credentials: "include" });
    return (await res.json()) as Array<Record<string, unknown>>;
  });
  expect(listed).toHaveLength(1);
  expect(listed[0].content).toBeUndefined();
  expect(String(listed[0].preview)).toContain("MRI LUMBAR SPINE");
  expect(listed[0].characters).toBe(REPORT.length);

  // Stored verbatim, line breaks and all.
  const [stored] = await sql`select content from coach_documents where user_id = ${account.id}::uuid`;
  expect(stored.content).toBe(REPORT);

  const id = String(created.body.id);
  const full = await page.evaluate(async (docId) => {
    const res = await fetch(`/api/coach-documents/${docId}`, { credentials: "include" });
    return (await res.json()) as { content: string };
  }, id);
  expect(full.content).toBe(REPORT);

  // Now the CARD, driven the way a person drives it. Deliberately not "create
  // by fetch, then reload": the list is cached for five minutes, so a reload
  // legitimately shows the copy it already had, while the form's own save
  // refreshes it. That difference failed this spec in a full run and passed it
  // alone, which is the signature of a test racing a cache rather than a bug.
  await page.locator("main").getByTestId("button-add-document").click();
  await page.locator("main").getByTestId("input-document-title").fill("Physio summary, Sept 2026");
  await page
    .locator("main")
    .getByTestId("input-document-content")
    .fill("Cleared to lift. Avoid loaded lumbar flexion until symptoms settle.");
  await page.locator("main").getByTestId("button-save-document").click();

  const typed = page.locator("main").locator('[data-testid^="document-"]').filter({
    hasText: "Physio summary",
  });
  await expect(typed).toHaveCount(1, { timeout: 20000 });
  const typedId = String(await typed.getAttribute("data-testid")).replace("document-", "");
  await page.locator("main").getByTestId(`button-open-document-${typedId}`).click();
  await expect(page.locator("main").getByTestId(`document-body-${typedId}`)).toContainText(
    "loaded lumbar flexion",
  );
  await page.locator("main").getByTestId(`button-delete-document-${typedId}`).click();
  await expect(typed).toHaveCount(0);

  // The API-created one is still there, and is removed the same way.
  await page.locator("main").getByTestId(`button-delete-document-${id}`).click();
  await expect(page.locator("main").getByTestId(`document-${id}`)).toHaveCount(0);

  const left = await sql`select count(*)::int as n from coach_documents where user_id = ${account.id}::uuid`;
  expect(left[0].n).toBe(0);
});

test("a document belongs to one account and is invisible to another", async ({
  page,
  account,
}) => {
  // Seeded against a DIFFERENT user id. Reading it by id must 404 rather than
  // return somebody else's medical history.
  const [stranger] = await sql`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated',
            'authenticated', ${`e2e-doc-stranger-${Date.now()}@fityear.test`}, '',
            now(), now(), now())
    returning id`;
  const [doc] = await sql`
    insert into coach_documents (user_id, title, content)
    values (${stranger.id}, 'Someone else MRI', ${REPORT})
    returning id`;

  await page.goto("/settings");
  const status = await page.evaluate(async (docId) => {
    const res = await fetch(`/api/coach-documents/${docId}`, { credentials: "include" });
    return res.status;
  }, String(doc.id));
  expect(status).toBe(404);

  // And deleting it is refused rather than silently working.
  const deleteStatus = await page.evaluate(async (docId) => {
    const res = await fetch(`/api/coach-documents/${docId}`, {
      method: "DELETE",
      credentials: "include",
    });
    return res.status;
  }, String(doc.id));
  expect(deleteStatus).toBe(404);

  const [still] = await sql`select count(*)::int as n from coach_documents where id = ${doc.id}`;
  expect(still.n).toBe(1);

  // The account fixture only cascades its own user, so this one is cleaned here.
  await sql`delete from auth.users where id = ${stranger.id}`;
  expect(account.id).toBeTruthy();
});
