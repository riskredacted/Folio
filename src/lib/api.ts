/**
 * Safe API request helper to prevent "Unexpected token '<', '<!doctype '... is not valid JSON"
 * errors caused by HTML 404/500 fallbacks or server restarts.
 */
export async function safeFetchJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit,
  retries = 1
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(input, {
        ...init,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(init?.headers || {}),
        },
      });

      const contentType = response.headers.get('content-type') || '';

      if (!contentType.includes('application/json')) {
        // If server returned HTML (e.g. during server startup or reload)
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, 800));
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
          await new Promise((resolve) => setTimeout(resolve, 600));
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
        await new Promise((resolve) => setTimeout(resolve, 600));
        continue;
      }
      break;
    }
  }

  throw lastError || new Error('Failed to connect to the story engine. Please check your connection and try again.');
}

