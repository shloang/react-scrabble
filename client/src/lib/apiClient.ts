export async function handleApiResponse<T>(response: Response, defaultMessage: string): Promise<T> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error((payload as any)?.error || defaultMessage);
  }

  return payload as T;
}

export async function apiGet<T>(url: string, defaultMessage: string): Promise<T> {
  const response = await fetch(url);
  return handleApiResponse<T>(response, defaultMessage);
}

export async function apiPost<TResponse, TBody = unknown>(url: string, body?: TBody, defaultMessage = 'Request failed'): Promise<TResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(typeof body === 'undefined' ? {} : { body: JSON.stringify(body) }),
  });

  return handleApiResponse<TResponse>(response, defaultMessage);
}
