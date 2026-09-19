export async function handleApiResponse<T>(response: Response, defaultMessage: string): Promise<T> {
  const payload = await response.json().catch((error) => {
    if (error?.name === 'AbortError') throw error;
    return {};
  });

  if (!response.ok) {
    throw new Error((payload as any)?.error || defaultMessage);
  }

  return payload as T;
}

export async function apiGet<T>(url: string, defaultMessage: string): Promise<T> {
  return requestJson<T>(url, {}, defaultMessage);
}

export async function apiPost<TResponse, TBody = unknown>(url: string, body?: TBody, defaultMessage = 'Request failed'): Promise<TResponse> {
  return requestJson<TResponse>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(typeof body === 'undefined' ? {} : { body: JSON.stringify(body) }),
  }, defaultMessage);
}

export async function requestJson<T>(url: string, init: RequestInit, defaultMessage: string, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return await handleApiResponse<T>(response, defaultMessage);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('Request timed out. Check your connection and try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
