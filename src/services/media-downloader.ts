import { mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AppConfig } from '../config.js';
import {
  validateAudioFile,
  validateAudioMetadata,
  type AudioDurationProbe
} from './audio-validator.js';
import type { WhatsAppMediaClient } from './whatsapp-client.js';

export type PreparedAudio = {
  audioPath: string;
  mimeType: string | null;
  bytes: number;
  cleanup(): Promise<void>;
};

export type AudioSourceInput = {
  jobId?: string;
  mediaId: string;
  mimeType: string | null;
};

export interface AudioSource {
  prepareAudio(input: AudioSourceInput): Promise<PreparedAudio>;
}

export type WhatsAppMediaAudioSourceProgress = {
  jobId?: string;
  step: 'media_url' | 'media_download' | 'media_validate';
  status: 'started' | 'completed';
  durationMs?: number | null;
  mimeType?: string | null;
  bytes?: number | null;
};

type WhatsAppMediaAudioSourceConfig = Pick<
  AppConfig,
  'MAX_AUDIO_BYTES' | 'MAX_AUDIO_DURATION_SECONDS' | 'TEMP_AUDIO_DIR'
>;

function extensionForMimeType(mimeType: string | null): string {
  const normalized = mimeType?.toLowerCase() ?? '';

  if (normalized.startsWith('audio/ogg')) {
    return 'ogg';
  }

  if (normalized.startsWith('audio/mpeg')) {
    return 'mp3';
  }

  if (normalized.startsWith('audio/mp4') || normalized.startsWith('audio/m4a')) {
    return 'm4a';
  }

  if (normalized.startsWith('audio/amr')) {
    return 'amr';
  }

  if (normalized.startsWith('audio/webm')) {
    return 'webm';
  }

  if (normalized.startsWith('audio/wav') || normalized.startsWith('audio/x-wav')) {
    return 'wav';
  }

  return 'audio';
}

export function createWhatsAppMediaAudioSource(input: {
  config: WhatsAppMediaAudioSourceConfig;
  mediaClient: WhatsAppMediaClient;
  durationProbe?: AudioDurationProbe;
  onProgress?: (event: WhatsAppMediaAudioSourceProgress) => void;
}): AudioSource {
  return {
    async prepareAudio(source): Promise<PreparedAudio> {
      const mediaUrlStartedAtMs = Date.now();
      input.onProgress?.({
        jobId: source.jobId,
        step: 'media_url',
        status: 'started',
        mimeType: source.mimeType
      });
      const media = await input.mediaClient.getMediaUrl(source.mediaId);
      input.onProgress?.({
        jobId: source.jobId,
        step: 'media_url',
        status: 'completed',
        durationMs: Date.now() - mediaUrlStartedAtMs,
        mimeType: media.mimeType ?? source.mimeType,
        bytes: media.fileSizeBytes
      });
      const mimeType = media.mimeType ?? source.mimeType;

      validateAudioMetadata(
        {
          mimeType,
          fileSizeBytes: media.fileSizeBytes
        },
        input.config
      );

      await mkdir(input.config.TEMP_AUDIO_DIR, { recursive: true });
      const audioPath = join(
        input.config.TEMP_AUDIO_DIR,
        `${randomUUID()}.${extensionForMimeType(mimeType)}`
      );

      try {
        const downloadStartedAtMs = Date.now();
        input.onProgress?.({
          jobId: source.jobId,
          step: 'media_download',
          status: 'started',
          mimeType
        });
        const download = await input.mediaClient.downloadMediaToFile({
          url: media.url,
          destinationPath: audioPath
        });
        input.onProgress?.({
          jobId: source.jobId,
          step: 'media_download',
          status: 'completed',
          durationMs: Date.now() - downloadStartedAtMs,
          mimeType: download.mimeType ?? mimeType,
          bytes: download.bytes
        });

        const validateStartedAtMs = Date.now();
        input.onProgress?.({
          jobId: source.jobId,
          step: 'media_validate',
          status: 'started',
          mimeType: download.mimeType ?? mimeType,
          bytes: download.bytes
        });
        await validateAudioFile(
          {
            path: audioPath,
            mimeType: download.mimeType ?? mimeType
          },
          input.config,
          input.durationProbe
        );
        input.onProgress?.({
          jobId: source.jobId,
          step: 'media_validate',
          status: 'completed',
          durationMs: Date.now() - validateStartedAtMs,
          mimeType: download.mimeType ?? mimeType,
          bytes: download.bytes
        });

        return {
          audioPath,
          mimeType: download.mimeType ?? mimeType,
          bytes: download.bytes,
          async cleanup() {
            await rm(audioPath, { force: true });
          }
        };
      } catch (error) {
        await rm(audioPath, { force: true });
        throw error;
      }
    }
  };
}
