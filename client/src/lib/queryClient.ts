import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  
  const contentType = res.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    return await res.json();
  }
  
  const text = await res.text();
  return text || undefined;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

/**
 * EVERY identity change (login, logout, register — any flow, any portal) must go
 * through this: private data (orders, subscriptions, wholesale account) is cached
 * under shared keys, so an account switch that only swaps /api/user can briefly
 * show the previous identity's data until each query happens to refetch.
 */
export function resetCachesForIdentityChange(user: unknown) {
  queryClient.clear();
  queryClient.setQueryData(["/api/user"], user);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      // staleTime: Infinity cached every list forever — the delivery report showed
      // yesterday's schedule, the routes page missed new orders, the wholesale-units
      // dialog read a flavorless copy. Data is now fresh for 30s and re-fetched when
      // the tab regains focus; pages with their own intervals keep them.
      refetchOnWindowFocus: true,
      staleTime: 30_000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
