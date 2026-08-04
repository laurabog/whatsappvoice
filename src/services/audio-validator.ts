import { stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AppConfig } from '../config.js';

const execFileAsync = promisify(execFile);

export type AudioValidationConfig = Pick<AppConfig, 'MAX_AUDIO_BYTES' | 'MAX_AUDIO_DURATION_SECONDS'>;

export type AudioMetadataForValidation = {
  mimeType: string | null;
  fileSizeBytes: number | null;
};

export type AudioFileForValidation = {
  path: string;
  mimeType: string | null;
};

export interface AudioDurationProbe {
  durationSeconds(audioPath: string): Promise<number>;
}

export class FfprobeAudioDurationProbe implements AudioDurationProbe {
  async durationSeconds(audioPath: string): Promise<number> {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      audioPath
    ]);
    const duration = Number(stdout.trim());

    if (!Number.isFinite(duration)) {
      throw new Error('ffprobe returned an invalid audio duration');
    }

    return duration;
  }
}

function normalizedMimeType(mimeType: string | null): string | null {
  return mimeType?.toLowerCase() ?? null;
}

function isAcceptedAudioMimeType(mimeType: string | null): boolean {
  const normalized = normalizedMimeType(mimeType);

  if (!normalized) {
    return true;
  }

  if (normalized.startsWith('audio/ogg')) {
    return true;
  }

  return [
    'audio/aac',
    'audio/mp4',
    'audio/mpeg',
    'audio/amr',
    'audio/webm',
    'audio/wav',
    'audio/x-wav',
    'audio/m4a'
  ].some((accepted) => normalized.startsWith(accepted));
}

export class AudioValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AudioValidationError';
    this.code = code;
  }
}

export function validateAudioMetadata(
  input: AudioMetadataForValidation,
  config: AudioValidationConfig
): void {
  if (input.fileSizeBytes !== null && input.fileSizeBytes > config.MAX_AUDIO_BYTES) {
    throw new AudioValidationError(
      'audio_too_large',
      `Audio file is ${input.fileSizeBytes} bytes, above limit ${config.MAX_AUDIO_BYTES}`
    );
  }

  if (!isAcceptedAudioMimeType(input.mimeType)) {
    throw new AudioValidationError(
      'unsupported_audio_mime_type',
      `Unsupported audio MIME type: ${input.mimeType}`
    );
  }
}

export async function validateAudioFile(
  input: AudioFileForValidation,
  config: AudioValidationConfig,
  durationProbe?: AudioDurationProbe
): Promise<void> {
  const file = await stat(input.path);

  if (file.size <= 0) {
    throw new AudioValidationError('audio_empty', 'Audio file is empty');
  }

  validateAudioMetadata(
    {
      mimeType: input.mimeType,
      fileSizeBytes: file.size
    },
    config
  );

  if (!durationProbe) {
    return;
  }

  const durationSeconds = await durationProbe.durationSeconds(input.path);
  if (durationSeconds > config.MAX_AUDIO_DURATION_SECONDS) {
    throw new AudioValidationError(
      'audio_too_long',
      `Audio duration is ${durationSeconds} seconds, above limit ${config.MAX_AUDIO_DURATION_SECONDS}`
    );
  }
}
