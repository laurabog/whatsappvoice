import { readFile, rm, stat, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createWhatsAppMediaAudioSource } from '../../src/services/media-downloader.js';
import type { WhatsAppMediaClient } from '../../src/services/whatsapp-client.js';

const config = {
  MAX_AUDIO_BYTES: 10,
  MAX_AUDIO_DURATION_SECONDS: 60
};

async function withTempDir(test: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'media-downloader-'));

  try {
    await test(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('createWhatsAppMediaAudioSource', () => {
  it('downloads WhatsApp media into a prepared temp file and cleans it up', async () => {
    await withTempDir(async (dir) => {
      const mediaClient: WhatsAppMediaClient = {
        getMediaUrl: vi.fn(async () => ({
          mediaId: 'media-1',
          url: 'https://lookaside.whatsapp.example/media',
          mimeType: 'audio/ogg; codecs=opus',
          fileSizeBytes: 5,
          sha256: 'sha'
        })),
        downloadMediaToFile: vi.fn(async ({ destinationPath }) => {
          await writeFile(destinationPath, 'audio');
          return {
            destinationPath,
            bytes: 5,
            mimeType: 'audio/ogg; codecs=opus'
          };
        })
      };
      const source = createWhatsAppMediaAudioSource({
        config: {
          ...config,
          TEMP_AUDIO_DIR: dir
        },
        mediaClient
      });

      const prepared = await source.prepareAudio({
        mediaId: 'media-1',
        mimeType: null
      });

      expect(mediaClient.getMediaUrl).toHaveBeenCalledWith('media-1');
      expect(mediaClient.downloadMediaToFile).toHaveBeenCalledWith({
        url: 'https://lookaside.whatsapp.example/media',
        destinationPath: prepared.audioPath
      });
      expect(prepared.audioPath).toMatch(/\.ogg$/);
      expect(prepared.bytes).toBe(5);
      await expect(readFile(prepared.audioPath, 'utf8')).resolves.toBe('audio');

      await prepared.cleanup();

      await expect(stat(prepared.audioPath)).rejects.toThrow();
    });
  });

  it('rejects oversized media metadata before downloading', async () => {
    await withTempDir(async (dir) => {
      const mediaClient: WhatsAppMediaClient = {
        getMediaUrl: vi.fn(async () => ({
          mediaId: 'media-1',
          url: 'https://lookaside.whatsapp.example/media',
          mimeType: 'audio/mpeg',
          fileSizeBytes: 11,
          sha256: null
        })),
        downloadMediaToFile: vi.fn()
      };
      const source = createWhatsAppMediaAudioSource({
        config: {
          ...config,
          TEMP_AUDIO_DIR: dir
        },
        mediaClient
      });

      await expect(
        source.prepareAudio({
          mediaId: 'media-1',
          mimeType: null
        })
      ).rejects.toMatchObject({ code: 'audio_too_large' });
      expect(mediaClient.downloadMediaToFile).not.toHaveBeenCalled();
    });
  });

  it('removes a downloaded file when post-download validation fails', async () => {
    await withTempDir(async (dir) => {
      let downloadedPath: string | null = null;
      const mediaClient: WhatsAppMediaClient = {
        getMediaUrl: vi.fn(async () => ({
          mediaId: 'media-1',
          url: 'https://lookaside.whatsapp.example/media',
          mimeType: null,
          fileSizeBytes: null,
          sha256: null
        })),
        downloadMediaToFile: vi.fn(async ({ destinationPath }) => {
          downloadedPath = destinationPath;
          await writeFile(destinationPath, 'audio');
          return {
            destinationPath,
            bytes: 5,
            mimeType: 'audio/ogg'
          };
        })
      };
      const source = createWhatsAppMediaAudioSource({
        config: {
          ...config,
          TEMP_AUDIO_DIR: dir
        },
        mediaClient
      });

      await expect(
        source.prepareAudio({
          mediaId: 'media-1',
          mimeType: 'audio/ogg; codecs=opus'
        })
      ).rejects.toMatchObject({ code: 'unsupported_audio_mime_type' });
      if (!downloadedPath) {
        throw new Error('Expected media download test to capture destination path');
      }

      await expect(stat(downloadedPath)).rejects.toThrow();
    });
  });
});
