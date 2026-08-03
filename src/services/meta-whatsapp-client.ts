import type { AppConfig } from '../config.js';
import type { SendTextInput, SendTextResult, WhatsAppTextSender } from './whatsapp-client.js';

type MetaWhatsAppClientConfig = Pick<
  AppConfig,
  'WHATSAPP_ACCESS_TOKEN' | 'WHATSAPP_GRAPH_API_VERSION' | 'WHATSAPP_PHONE_NUMBER_ID'
>;

type MetaSendMessageResponse = {
  messages?: Array<{
    id?: string;
  }>;
};

export class MetaWhatsAppClient implements WhatsAppTextSender {
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
}
