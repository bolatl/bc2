import { config } from '../config';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

const pending = new Set<AbortController>();
let generation = 0;
export function cancelPrivateRequests() {
  generation += 1;
  for (const controller of pending) controller.abort();
  pending.clear();
}

export async function api<T>(path: string, body?: unknown, options: { method?: string; signal?: AbortSignal; silentAuth?: boolean } = {}): Promise<T> {
  const controller = new AbortController();
  const startedGeneration = generation;
  pending.add(controller);
  const abort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(abort, 40_000);
  try {
    const response = await fetch(`${config.apiOrigin}/api/v1${path}`, {
      method: options.method ?? (body === undefined ? 'GET' : 'POST'),
      credentials: 'include', cache: 'no-store', signal: controller.signal,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = response.status === 204 ? undefined : await response.json().catch(() => undefined);
    if (startedGeneration !== generation) throw new DOMException('Context changed', 'AbortError');
    if (!response.ok) {
      if (response.status === 401 && !options.silentAuth) window.dispatchEvent(new Event('lovelab:unauthorized'));
      throw new ApiError(response.status, data?.code ?? 'request_failed', data?.message ?? 'The request could not be completed. Please try again.');
    }
    if (response.status !== 204 && data === undefined) throw new ApiError(0, 'invalid_response', 'We could not read the response. Check your connection and try again.');
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (options.signal?.aborted || startedGeneration !== generation) throw new DOMException('Request cancelled', 'AbortError');
    throw new ApiError(0, 'connection_error', 'We could not reach Kintsugi. Check your connection and try again.');
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
    pending.delete(controller);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
