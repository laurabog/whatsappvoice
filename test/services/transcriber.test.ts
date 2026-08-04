import OpenAI from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { OpenAITranscriber } from '../../src/services/transcriber.js';

function makeClient(text: string): OpenAI {
  return {
    audio: {
      transcriptions: {
        create: vi.fn(async () => ({
          text
        }))
      }
    }
  } as unknown as OpenAI;
}

describe('OpenAITranscriber', () => {
  it('transcribes a local audio path through the OpenAI audio API', async () => {
    const client = makeClient('  Please review the plan.  ');
    const transcriber = new OpenAITranscriber(
      {
        OPENAI_API_KEY: undefined,
        OPENAI_TRANSCRIPTION_MODEL: 'gpt-4o-mini-transcribe',
        OPENAI_REQUEST_TIMEOUT_MS: 60_000
      },
      client
    );

    await expect(
      transcriber.transcribe({
        audioPath: 'test/fixtures/whatsapp-audio-webhook.json',
        mimeType: 'audio/ogg',
        language: 'en'
      })
    ).resolves.toMatchObject({
      text: 'Please review the plan.',
      provider: 'openai',
      model: 'gpt-4o-mini-transcribe',
      characterCount: 23
    });

    expect(client.audio.transcriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.any(Object),
        model: 'gpt-4o-mini-transcribe',
        language: 'en',
        response_format: 'json'
      })
    );
  });

  it('retries transient OpenAI network errors when transcribing', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('socket reset'), {
        cause: {
          code: 'ECONNRESET'
        }
      }))
      .mockResolvedValueOnce({
        text: '  Retry worked.  '
      });
    const client = {
      audio: {
        transcriptions: {
          create
        }
      }
    } as unknown as OpenAI;
    const transcriber = new OpenAITranscriber(
      {
        OPENAI_API_KEY: undefined,
        OPENAI_TRANSCRIPTION_MODEL: 'gpt-4o-mini-transcribe',
        OPENAI_REQUEST_TIMEOUT_MS: 60_000
      },
      client
    );

    await expect(
      transcriber.transcribe({
        audioPath: 'test/fixtures/whatsapp-audio-webhook.json',
        mimeType: 'audio/ogg',
        language: 'en'
      })
    ).resolves.toMatchObject({
      text: 'Retry worked.',
      provider: 'openai'
    });

    expect(create).toHaveBeenCalledTimes(2);
  });

  it('requires a local audio path', async () => {
    const transcriber = new OpenAITranscriber(
      {
        OPENAI_API_KEY: undefined,
        OPENAI_TRANSCRIPTION_MODEL: 'gpt-4o-mini-transcribe',
        OPENAI_REQUEST_TIMEOUT_MS: 60_000
      },
      makeClient('Text')
    );

    await expect(
      transcriber.transcribe({
        mediaId: 'media-id',
        mimeType: 'audio/ogg',
        language: 'en'
      })
    ).rejects.toThrow('audioPath is required for OpenAI transcription');
  });

  it('requires an API key when no client is injected', () => {
    expect(
      () =>
        new OpenAITranscriber({
          OPENAI_API_KEY: undefined,
          OPENAI_TRANSCRIPTION_MODEL: 'gpt-4o-mini-transcribe',
          OPENAI_REQUEST_TIMEOUT_MS: 60_000
        })
    ).toThrow('OPENAI_API_KEY is required for OpenAI transcription');
  });
});
