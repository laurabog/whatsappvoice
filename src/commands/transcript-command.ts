import { noTranscriptMessage } from './messages.js';

export type TranscriptRecordForReply = {
  text: string;
  fromLabel: string;
};

export function formatTranscriptReply(
  transcript: TranscriptRecordForReply | null,
  maxChunkChars: number
): string[] {
  if (!transcript) {
    return [noTranscriptMessage];
  }

  const maxBodyChars = Math.max(500, maxChunkChars);
  const heading = `Transcript from ${transcript.fromLabel}`;
  const singleMessagePrefix = `${heading}\n\n`;
  if (transcript.text.length + singleMessagePrefix.length <= maxBodyChars) {
    return [`${singleMessagePrefix}${transcript.text}`];
  }

  let chunkSize = maxBodyChars - `${heading} 1/1\n\n`.length;
  let chunks: string[] = [];

  while (true) {
    chunks = [];
    for (let index = 0; index < transcript.text.length; index += chunkSize) {
      chunks.push(transcript.text.slice(index, index + chunkSize));
    }

    const widestPrefix = `${heading} ${chunks.length}/${chunks.length}\n\n`;
    const nextChunkSize = maxBodyChars - widestPrefix.length;
    if (nextChunkSize === chunkSize) {
      break;
    }

    chunkSize = nextChunkSize;
  }

  return chunks.map((chunk, index) => `${heading} ${index + 1}/${chunks.length}\n\n${chunk}`);
}
