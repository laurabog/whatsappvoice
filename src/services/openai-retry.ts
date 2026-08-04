const OPENAI_ATTEMPTS = 3;
const OPENAI_RETRY_DELAYS_MS = [250, 750];

export type RetryOpenAIRequestOptions = {
  maxAttempts?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const directCode = (error as { code?: unknown }).code;
  if (typeof directCode === 'string') {
    return directCode;
  }

  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause === 'object' && cause !== null) {
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === 'string') {
      return causeCode;
    }
  }

  return null;
}

function errorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

function isHardOpenAIError(error: unknown): boolean {
  const status = errorStatus(error);
  const code = errorCode(error);

  return (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    code === 'insufficient_quota' ||
    code === 'invalid_api_key'
  );
}

export function isRetryableOpenAIError(error: unknown): boolean {
  if (isHardOpenAIError(error)) {
    return false;
  }

  const status = errorStatus(error);
  if (status !== null) {
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }

  const code = errorCode(error);
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN') {
    return true;
  }

  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

export async function retryOpenAIRequest<T>(
  request: () => Promise<T>,
  options: RetryOpenAIRequestOptions = {}
): Promise<T> {
  let lastError: unknown;
  const maxAttempts = options.maxAttempts ?? OPENAI_ATTEMPTS;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      if (!isRetryableOpenAIError(error) || attempt === OPENAI_ATTEMPTS - 1) {
        throw error;
      }

      lastError = error;
      await sleep(OPENAI_RETRY_DELAYS_MS[attempt] ?? 0);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('OpenAI request failed');
}
