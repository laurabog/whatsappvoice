export type TranscriptionInput = {
  mediaId: string;
  mimeType: string | null;
  language: 'en';
};

export type TranscriptionResult = {
  text: string;
  provider: 'fake';
  model: string;
  latencyMs: number;
  characterCount: number;
};

export interface Transcriber {
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}

export class FakeTranscriber implements Transcriber {
  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const text = [
      `This is a fake transcript for WhatsApp media ${input.mediaId}.`,
      'The speaker asks you to review the plan and reply when you can.'
    ].join(' ');

    return {
      text,
      provider: 'fake',
      model: 'fake-transcriber-v0',
      latencyMs: 0,
      characterCount: text.length
    };
  }
}
