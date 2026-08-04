import { createReadStream } from 'node:fs';
import OpenAI from 'openai';
import type { AppConfig } from '../config.js';
import { retryOpenAIRequest } from './openai-retry.js';

export type TranscriptionInput = {
  mediaId?: string;
  audioPath?: string;
  mimeType: string | null;
  language: 'en';
};

export type TranscriptionResult = {
  text: string;
  provider: 'fake' | 'openai';
  model: string;
  latencyMs: number;
  characterCount: number;
};

export interface Transcriber {
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}

type OpenAITranscriberConfig = Pick<
  AppConfig,
  'OPENAI_API_KEY' | 'OPENAI_TRANSCRIPTION_MODEL'
>;

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

export class OpenAITranscriber implements Transcriber {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: OpenAITranscriberConfig, client?: OpenAI) {
    if (!client && !config.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required for OpenAI transcription');
    }

    this.client = client ?? new OpenAI({ apiKey: config.OPENAI_API_KEY });
    this.model = config.OPENAI_TRANSCRIPTION_MODEL;
  }

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    if (!input.audioPath) {
      throw new Error('audioPath is required for OpenAI transcription');
    }

    const audioPath = input.audioPath;
    const startedAt = Date.now();
    const response = await retryOpenAIRequest(() =>
      this.client.audio.transcriptions.create({
        file: createReadStream(audioPath),
        model: this.model,
        language: input.language,
        response_format: 'json'
      })
    );
    const text = response.text.trim();

    if (!text) {
      throw new Error('OpenAI transcription returned empty text');
    }

    return {
      text,
      provider: 'openai',
      model: this.model,
      latencyMs: Date.now() - startedAt,
      characterCount: text.length
    };
  }
}
