import { google, type calendar_v3 } from "googleapis";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { googleCalendarTokens } from "@/lib/db/schema";
import { encryptToken, decryptToken, isEncrypted } from "@/lib/token-crypto";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

function getRedirectUri(): string {
  if (process.env.GOOGLE_OAUTH_REDIRECT_URI) {
    return process.env.GOOGLE_OAUTH_REDIRECT_URI;
  }
  // Fallback for Vercel
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}/api/calendar/callback`;
  }
  return "http://localhost:3000/api/calendar/callback";
}

function createOAuth2Client() {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    getRedirectUri(),
  );
}

export function getCalendarAuthUrl(userId: string): string {
  return createOAuth2Client().generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/calendar"],
    prompt: "consent",
    state: userId,
  });
}

export async function handleCalendarCallback(
  code: string,
  userId: string,
): Promise<void> {
  const oauth2 = createOAuth2Client();
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("No refresh token received. Please try connecting again.");
  }
  // Encrypt tokens before persisting. Schema columns are unchanged (text);
  // we store an `enc:v1:...` envelope instead of raw plaintext.
  const encryptedRefresh = encryptToken(tokens.refresh_token);
  const encryptedAccess = tokens.access_token ? encryptToken(tokens.access_token) : null;
  await db
    .insert(googleCalendarTokens)
    .values({
      userId,
      refreshToken: encryptedRefresh,
      accessToken: encryptedAccess,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    })
    .onConflictDoUpdate({
      target: googleCalendarTokens.userId,
      set: {
        refreshToken: encryptedRefresh,
        accessToken: encryptedAccess,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      },
    });
}

async function getClientForUser(userId: string): Promise<calendar_v3.Calendar> {
  const [row] = await db
    .select()
    .from(googleCalendarTokens)
    .where(eq(googleCalendarTokens.userId, userId))
    .limit(1);
  if (!row) throw new Error("Calendar not connected");

  // Decrypt tokens for use. Legacy plaintext rows (pre-encryption deploy) pass
  // through unchanged; lazy migration below re-encrypts them on next refresh.
  const refreshToken = decryptToken(row.refreshToken);
  const accessToken = decryptToken(row.accessToken);
  if (!refreshToken) throw new Error("Calendar token corrupted");

  const oauth2 = createOAuth2Client();
  oauth2.setCredentials({
    refresh_token: refreshToken,
    access_token: accessToken ?? undefined,
    expiry_date: row.expiresAt?.getTime(),
  });

  // Lazy at-rest encryption migration: if the row was stored as plaintext
  // before this layer landed, re-encrypt now so future reads are protected.
  // Fire-and-forget; if the write loses a race or fails, the next read retries.
  if (!isEncrypted(row.refreshToken)) {
    Promise.resolve(
      db
        .update(googleCalendarTokens)
        .set({
          refreshToken: encryptToken(refreshToken),
          accessToken: accessToken ? encryptToken(accessToken) : row.accessToken,
        })
        .where(eq(googleCalendarTokens.userId, userId)),
    ).catch(() => {});
  }

  oauth2.on("tokens", async (newTokens) => {
    if (newTokens.access_token) {
      await db
        .update(googleCalendarTokens)
        .set({
          accessToken: encryptToken(newTokens.access_token),
          expiresAt: newTokens.expiry_date
            ? new Date(newTokens.expiry_date)
            : new Date(Date.now() + 3600 * 1000),
        })
        .where(eq(googleCalendarTokens.userId, userId));
    }
  });

  return google.calendar({ version: "v3", auth: oauth2 });
}

export async function isCalendarConnected(userId: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(googleCalendarTokens)
    .where(eq(googleCalendarTokens.userId, userId))
    .limit(1);
  return !!row;
}

export async function disconnectCalendar(userId: string): Promise<void> {
  await db
    .delete(googleCalendarTokens)
    .where(eq(googleCalendarTokens.userId, userId));
}

export interface CalendarInfo {
  id: string;
  summary: string;
  primary?: boolean;
  backgroundColor?: string;
}

export async function listUserCalendars(
  userId: string,
): Promise<CalendarInfo[]> {
  const cal = await getClientForUser(userId);
  const res = await cal.calendarList.list();
  const items = res.data.items || [];
  return items
    .filter((c) => c.accessRole === "owner" || c.accessRole === "writer")
    .map((c) => ({
      id: c.id!,
      summary: c.summary || c.id!,
      primary: c.primary || false,
      backgroundColor: c.backgroundColor ?? undefined,
    }));
}

function dateRange(d: Date | string, localDateStr?: string) {
  let startDateStr: string;
  let endDateStr: string;
  if (localDateStr) {
    startDateStr = localDateStr;
    const [y, m, dd] = localDateStr.split("-").map(Number);
    const end = new Date(y, m - 1, dd + 1);
    endDateStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  } else {
    const date = typeof d === "string" ? new Date(d) : d;
    startDateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const end = new Date(date);
    end.setDate(end.getDate() + 1);
    endDateStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  }
  return { startDateStr, endDateStr };
}

export async function createCalendarEvent(
  userId: string,
  workoutName: string,
  date: Date,
  calendarId?: string,
  localDateStr?: string,
): Promise<string | null> {
  try {
    const cal = await getClientForUser(userId);
    const { startDateStr, endDateStr } = dateRange(date, localDateStr);
    const res = await cal.events.insert({
      calendarId: calendarId || "primary",
      requestBody: {
        summary: workoutName,
        description: `Completed workout: ${workoutName}`,
        start: { date: startDateStr },
        end: { date: endDateStr },
      },
    });
    return res.data.id ?? null;
  } catch (e) {
    console.error("[calendar] create event failed:", (e as Error).message);
    return null;
  }
}

export async function updateCalendarEvent(
  userId: string,
  eventId: string,
  date: Date,
  calendarId?: string,
  localDateStr?: string,
): Promise<boolean> {
  try {
    const cal = await getClientForUser(userId);
    const { startDateStr, endDateStr } = dateRange(date, localDateStr);
    await cal.events.patch({
      calendarId: calendarId || "primary",
      eventId,
      requestBody: {
        start: { date: startDateStr },
        end: { date: endDateStr },
      },
    });
    return true;
  } catch (e) {
    console.error("[calendar] update event failed:", (e as Error).message);
    return false;
  }
}

export async function checkCalendarEventExists(
  userId: string,
  eventId: string,
  calendarId?: string,
): Promise<boolean> {
  try {
    const cal = await getClientForUser(userId);
    await cal.events.get({
      calendarId: calendarId || "primary",
      eventId,
    });
    return true;
  } catch (e) {
    const code = (e as { code?: number; status?: number }).code ?? (e as { status?: number }).status;
    if (code === 404 || code === 410) return false;
    console.error("[calendar] check event failed:", (e as Error).message);
    return false;
  }
}

export async function deleteCalendarEvent(
  userId: string,
  eventId: string,
  calendarId?: string,
): Promise<boolean> {
  try {
    const cal = await getClientForUser(userId);
    await cal.events.delete({
      calendarId: calendarId || "primary",
      eventId,
    });
    return true;
  } catch (e) {
    console.error("[calendar] delete event failed:", (e as Error).message);
    return false;
  }
}
