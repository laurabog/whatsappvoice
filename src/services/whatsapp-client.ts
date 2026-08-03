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

export type WhatsAppMediaUrl = {
  mediaId: string;
  url: string;
  mimeType: string | null;
  fileSizeBytes: number | null;
  sha256: string | null;
};

export type DownloadMediaInput = {
  url: string;
  destinationPath: string;
};

export type DownloadMediaResult = {
  destinationPath: string;
  bytes: number;
  mimeType: string | null;
};

export interface WhatsAppMediaClient {
  getMediaUrl(mediaId: string): Promise<WhatsAppMediaUrl>;
  downloadMediaToFile(input: DownloadMediaInput): Promise<DownloadMediaResult>;
}
