import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AudioValidationError,
  validateAudioFile,
  validateAudioMetadata
} from '../../src/services/audio-validator.js';

const config = {
  MAX_AUDIO_BYTES: 10,
  MAX_AUDIO_DURATION_SECONDS: 60
};

function expectAudioValidationCode(action: () => void, code: string) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(AudioValidationError);
    expect(error).toMatchObject({ code });
    return;
  }

  throw new Error(`Expected AudioValidationError with code ${code}`);
}

async function withTempAudio(
  contents: string | Buffer,
  test: (path: string) => Promise<void>
) {
  const dir = await mkdtemp(join(tmpdir(), 'audio-validator-'));
  const audioPath = join(dir, 'audio.ogg');

  try {
    await writeFile(audioPath, contents);
    await test(audioPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('audio validation', () => {
  it('accepts WhatsApp voice note opus metadata', () => {
    expect(() =>
      validateAudioMetadata(
        {
          mimeType: 'audio/ogg; codecs=opus',
          fileSizeBytes: 9
        },
        config
      )
    ).not.toThrow();
  });

  it('rejects unsupported ogg audio without opus codec metadata', () => {
    expectAudioValidationCode(
      () =>
        validateAudioMetadata(
          {
            mimeType: 'audio/ogg',
            fileSizeBytes: 9
          },
          config
        ),
      'unsupported_audio_mime_type'
    );
  });

  it('rejects audio that is larger than the configured byte limit', () => {
    expectAudioValidationCode(
      () =>
        validateAudioMetadata(
          {
            mimeType: 'audio/mpeg',
            fileSizeBytes: 11
          },
          config
        ),
      'audio_too_large'
    );
  });

  it('rejects empty downloaded audio files', async () => {
    await withTempAudio('', async (audioPath) => {
      await expect(
        validateAudioFile(
          {
            path: audioPath,
            mimeType: 'audio/ogg; codecs=opus'
          },
          config
        )
      ).rejects.toMatchObject({ code: 'audio_empty' });
    });
  });

  it('rejects audio files over the configured duration limit when a probe is supplied', async () => {
    await withTempAudio('audio', async (audioPath) => {
      await expect(
        validateAudioFile(
          {
            path: audioPath,
            mimeType: 'audio/ogg; codecs=opus'
          },
          config,
          {
            durationSeconds: async () => 61
          }
        )
      ).rejects.toMatchObject({ code: 'audio_too_long' });
    });
  });
});
