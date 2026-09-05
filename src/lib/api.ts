/**
 * Safe API request helper to prevent "Unexpected token '<', '<!doctype '... is not valid JSON"
 * errors caused by HTML 404/500 fallbacks or server restarts.
 */
export async function safeFetchJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit,
  retries = 3
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const storedApiKey =
        typeof window !== 'undefined'
          ? localStorage.getItem('folio_gemini_api_key')
          : null;
      const extraHeaders: Record<string, string> = {};
      if (storedApiKey && storedApiKey.trim()) {
        extraHeaders['x-gemini-api-key'] = storedApiKey.trim();
      }

      const response = await fetch(input, {
        ...init,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...extraHeaders,
          ...(init?.headers || {}),
        },
      });

      // If server returned 502/503/504 Bad Gateway / Service Unavailable (common during Render auto-deploy or cold start)
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        if (attempt < retries) {
          const delay = (attempt + 1) * 1500;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw new Error(
          `The story server is finishing a deployment or waking up (${response.status}). Please try again in 10-15 seconds.`
        );
      }

      const contentType = response.headers.get('content-type') || '';

      if (!contentType.includes('application/json')) {
        // If server returned HTML (e.g. during server startup or reload)
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        if (!response.ok) {
          throw new Error(
            `The story server is currently starting or busy (${response.status}). Please try again in a few seconds.`
          );
        }

        throw new Error(
          'The story engine is momentarily reconnecting. Please send your idea again in a moment.'
        );
      }

      let data: any;
      try {
        data = await response.json();
      } catch (err: any) {
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          continue;
        }
        throw new Error(`The story engine returned an unexpected format. Please try again.`);
      }

      if (!response.ok) {
        throw new Error(data?.error || `Story engine error (${response.status})`);
      }

      return data as T;
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries && !err?.message?.includes('Story engine error')) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      break;
    }
  }

  throw lastError || new Error('Failed to connect to the story engine. Please check your connection and try again.');
}

