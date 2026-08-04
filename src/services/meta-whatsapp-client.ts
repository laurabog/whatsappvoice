import { stat, writeFile } from 'node:fs/promises';
import type { AppConfig } from '../config.js';
import type {
  DownloadMediaInput,
  DownloadMediaResult,
  SendTextInput,
  SendTextResult,
  WhatsAppMediaClient,
  WhatsAppMediaUrl,
  WhatsAppTextSender
} from './whatsapp-client.js';

type MetaWhatsAppClientConfig = Pick<
  AppConfig,
  'WHATSAPP_ACCESS_TOKEN' | 'WHATSAPP_GRAPH_API_VERSION' | 'WHATSAPP_PHONE_NUMBER_ID'
>;

type MetaSendMessageResponse = {
  messages?: Array<{
    id?: string;
  }>;
};

type MetaMediaUrlResponse = {
  id?: string;
  url?: string;
  mime_type?: string;
  file_size?: string | number;
  sha256?: string;
};

const META_FETCH_ATTEMPTS = 3;
const META_FETCH_TIMEOUT_MS = 10_000;
const META_FETCH_RETRY_DELAYS_MS = [250, 750];

function parseNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableResponse(response: Response): boolean {
  return response.status === 408 || response.status === 429 || response.status >= 500;
}

function isRetryableFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as { code?: unknown }).code;

  return (
    error.name === 'AbortError' ||
    error.name === 'TimeoutError' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN'
  );
}

async function fetchWithTimeout(input: string | URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, META_FETCH_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: init.signal ?? controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchMeta(input: string | URL, init: RequestInit): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < META_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithTimeout(input, init);

      if (!isRetryableResponse(response) || attempt === META_FETCH_ATTEMPTS - 1) {
        return response;
      }

      await response.arrayBuffer();
    } catch (error) {
      if (!isRetryableFetchError(error) || attempt === META_FETCH_ATTEMPTS - 1) {
        throw error;
      }

      lastError = error;
    }

    await sleep(META_FETCH_RETRY_DELAYS_MS[attempt] ?? 0);
  }

  throw lastError instanceof Error ? lastError : new Error('WhatsApp API request failed');
}

export class MetaWhatsAppClient implements WhatsAppTextSender, WhatsAppMediaClient {
  private readonly accessToken: string;
  private readonly graphApiVersion: string;
  private readonly phoneNumberId: string;

  constructor(config: MetaWhatsAppClientConfig) {
    if (!config.WHATSAPP_ACCESS_TOKEN) {
      throw new Error('WHATSAPP_ACCESS_TOKEN is required for WhatsApp replies');
    }

    if (!config.WHATSAPP_PHONE_NUMBER_ID) {
      throw new Error('WHATSAPP_PHONE_NUMBER_ID is required for WhatsApp replies');
    }

    this.accessToken = config.WHATSAPP_ACCESS_TOKEN;
    this.graphApiVersion = config.WHATSAPP_GRAPH_API_VERSION;
    this.phoneNumberId = config.WHATSAPP_PHONE_NUMBER_ID;
  }

  async sendText(input: SendTextInput): Promise<SendTextResult> {
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.to,
      ...(input.contextMessageId
        ? {
            context: {
              message_id: input.contextMessageId
            }
          }
        : {}),
      type: 'text',
      text: {
        preview_url: false,
        body: input.body
      }
    };

    const response = await fetchMeta(
      `https://graph.facebook.com/${this.graphApiVersion}/${this.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`WhatsApp sendText failed with ${response.status}: ${errorBody}`);
    }

    const payload = (await response.json()) as MetaSendMessageResponse;
    const whatsappMessageId = payload.messages?.[0]?.id;

    if (!whatsappMessageId) {
      throw new Error('WhatsApp sendText response did not include a message id');
    }

    return { whatsappMessageId };
  }

  async getMediaUrl(mediaId: string): Promise<WhatsAppMediaUrl> {
    const url = new URL(
      `https://graph.facebook.com/${this.graphApiVersion}/${encodeURIComponent(mediaId)}`
    );
    url.searchParams.set('phone_number_id', this.phoneNumberId);

    const response = await fetchMeta(url, {
      headers: {
        authorization: `Bearer ${this.accessToken}`
      }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`WhatsApp getMediaUrl failed with ${response.status}: ${errorBody}`);
    }

    const payload = (await response.json()) as MetaMediaUrlResponse;

    if (!payload.url) {
      throw new Error('WhatsApp getMediaUrl response did not include a media URL');
    }

    return {
      mediaId: payload.id ?? mediaId,
      url: payload.url,
      mimeType: payload.mime_type ?? null,
      fileSizeBytes: parseNullableNumber(payload.file_size),
      sha256: payload.sha256 ?? null
    };
  }

  async downloadMediaToFile(input: DownloadMediaInput): Promise<DownloadMediaResult> {
    const response = await fetchMeta(input.url, {
      headers: {
        authorization: `Bearer ${this.accessToken}`
      }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`WhatsApp downloadMedia failed with ${response.status}: ${errorBody}`);
    }

    if (!response.body) {
      throw new Error('WhatsApp downloadMedia response did not include a body');
    }

    await writeFile(input.destinationPath, Buffer.from(await response.arrayBuffer()));
    const downloadedFile = await stat(input.destinationPath);

    return {
      destinationPath: input.destinationPath,
      bytes: downloadedFile.size,
      mimeType: response.headers.get('content-type')
    };
  }
}
