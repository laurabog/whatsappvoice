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
  mediaId: string;
  mimeType: string | null;
};

export interface AudioSource {
  prepareAudio(input: AudioSourceInput): Promise<PreparedAudio>;
}

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
}): AudioSource {
  return {
    async prepareAudio(source): Promise<PreparedAudio> {
      const media = await input.mediaClient.getMediaUrl(source.mediaId);
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
        const download = await input.mediaClient.downloadMediaToFile({
          url: media.url,
          destinationPath: audioPath
        });

        await validateAudioFile(
          {
            path: audioPath,
            mimeType: download.mimeType ?? mimeType
          },
          input.config,
          input.durationProbe
        );

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
