import type { KVNamespace } from "@cloudflare/workers-types";

const RETRYABLE = /fetch failed|network connection lost|internal error|internal server error|service unavailable|bad gateway|gateway timeout|too many requests|KV (?:GET|LIST|PUT|DELETE) failed:\s*(?:429|5\d\d)\b|daemonDown|temporar(?:y|ily)|connection (?:closed|reset)|EADDRNOTAVAIL|ECONNREFUSED|ECONNRESET|UND_ERR_(?:CONNECT|SOCKET)/i;
const METHODS = new Set(["get", "getWithMetadata", "put", "delete", "list"]);
const wrapped = new WeakMap<object, Map<number, KVNamespace>>();
const DEFAULT_ATTEMPTS = 3;
const BASE_DELAY_MS = 250;
const MAX_DELAY_MS = 2_000;

export async function retryTransientKvOperation<T>(operation: () => Promise<T>, attempts = DEFAULT_ATTEMPTS): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientKvError(error) || attempt === attempts - 1) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt)),
      );
    }
  }
  throw lastError;
}

export function isTransientKvError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE.test(message);
}

export function withTransientKvRetry(kv: KVNamespace, attempts = DEFAULT_ATTEMPTS): KVNamespace {
  const proxies = wrapped.get(kv as object);
  const existing = proxies?.get(attempts);
  if (existing) return existing;
  const proxy = new Proxy(kv, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof property !== "string" || !METHODS.has(property) || typeof value !== "function") return value;
      return (...args: unknown[]) => retryTransientKvOperation(() => Reflect.apply(value, target, args) as Promise<unknown>, attempts);
    },
  }) as KVNamespace;
  const next = proxies ?? new Map<number, KVNamespace>();
  next.set(attempts, proxy);
  if (!proxies) wrapped.set(kv as object, next);
  return proxy;
}
