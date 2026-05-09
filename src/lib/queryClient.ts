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
      // 5 min staleTime: tabs that sat through a deploy refetch on next mount
      // instead of holding pre-deploy cache forever (was Infinity). Refetch on
      // mount + reconnect picks up server-side fixes within minutes without
      // the thrash of refetchOnWindowFocus.
      staleTime: 5 * 60 * 1000,
      refetchOnMount: true,
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
      // Single retry, capped delay — prior settings turned a transient failure
      // into a 9s saga (3 attempts × up to 5s backoff) on flaky cellular.
      retry: 1,
      retryDelay: (i) => Math.min(500 * 2 ** i, 2000),
    },
    mutations: { retry: 0 },
  },
});
