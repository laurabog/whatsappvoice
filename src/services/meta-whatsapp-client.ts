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

    const response = await fetch(
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

    const response = await fetch(url, {
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
    const response = await fetch(input.url, {
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
