import { QueryClient, type QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });
  await throwIfResNotOk(res);
  return res;
}

/**
 * Turn an error thrown by apiRequest/getQueryFn into a human-readable message.
 * apiRequest throws `Error("<status>: <body>")` where the body is usually our
 * API's JSON `{ error: "..." }`. Mutations were swallowing this and showing a
 * generic "Please try again", which made real failures (validation, auth
 * expiry, server errors) undiagnosable. Use this in mutation onError handlers.
 */
export function describeApiError(e: unknown): string {
  if (!(e instanceof Error)) return "Something went wrong. Please try again.";
  const m = e.message ?? "";
  const match = m.match(/^(\d{3}):\s*([\s\S]*)$/);
  if (match) {
    const [, status, rawBody] = match;
    let detail = rawBody.trim();
    try {
      const parsed = JSON.parse(rawBody);
      if (parsed && typeof parsed.error === "string") detail = parsed.error;
    } catch {
      // body wasn't JSON — keep the raw text
    }
    if (status === "401") return "Your session expired. Please sign in again.";
    if (status === "413") return "That request was too large.";
    return detail || `Request failed (${status}). Please try again.`;
  }
  if (/failed to fetch|networkerror|network request failed/i.test(m)) {
    return "Network error. Check your connection and try again.";
  }
  return m || "Something went wrong. Please try again.";
}

type UnauthorizedBehavior = "returnNull" | "throw";

export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401 }) =>
  async ({ queryKey }) => {
    const url = queryKey.join("/") as string;
    const res = await fetch(url, { credentials: "include" });
    if (on401 === "returnNull" && res.status === 401) return null as never;
    await throwIfResNotOk(res);
    return res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      // 5 min staleTime: cached data is served instantly on navigation/reopen,
      // and a background refetch runs on mount when it's older than this.
      staleTime: 5 * 60 * 1000,
      // 24h gcTime so the cache survives long enough to be persisted to
      // localStorage (see Providers PersistQueryClientProvider). On app reopen
      // the persisted cache hydrates and pages paint instantly from it while
      // revalidating in the background — the fix for the ~5s cold open on
      // mobile where the home screen fans out ~9 API calls (~374KB total).
      gcTime: 24 * 60 * 60 * 1000,
      refetchOnMount: true,
      // refetchOnReconnect off: mobile PWAs fire reconnect on every
      // foreground/network blip, which re-pulled the whole heavy payload set
      // and made tab use feel laggy. Mount-based revalidation is enough.
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      // Single retry, capped delay — prior settings turned a transient failure
      // into a 9s saga (3 attempts × up to 5s backoff) on flaky cellular.
      retry: 1,
      retryDelay: (i) => Math.min(500 * 2 ** i, 2000),
    },
    mutations: { retry: 0 },
  },
});
