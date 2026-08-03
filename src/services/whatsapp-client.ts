export type SendTextInput = {
  to: string;
  body: string;
  contextMessageId?: string;
};

export type SendTextResult = {
  whatsappMessageId: string;
};

export interface WhatsAppTextSender {
  sendText(input: SendTextInput): Promise<SendTextResult>;
}
