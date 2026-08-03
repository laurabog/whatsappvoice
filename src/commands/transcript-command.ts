import { noTranscriptMessage } from './messages.js';

export type TranscriptRecordForReply = {
  text: string;
};

export function formatTranscriptReply(
  transcript: TranscriptRecordForReply | null,
  maxChunkChars: number
): string[] {
  if (!transcript) {
    return [noTranscriptMessage];
  }

  const maxBodyChars = Math.max(500, maxChunkChars);
  const singleMessagePrefix = 'Transcript\n\n';
  if (transcript.text.length + singleMessagePrefix.length <= maxBodyChars) {
    return [`${singleMessagePrefix}${transcript.text}`];
  }

  let chunkSize = maxBodyChars - 'Transcript 1/1\n\n'.length;
  let chunks: string[] = [];

  while (true) {
    chunks = [];
    for (let index = 0; index < transcript.text.length; index += chunkSize) {
      chunks.push(transcript.text.slice(index, index + chunkSize));
    }

    const widestPrefix = `Transcript ${chunks.length}/${chunks.length}\n\n`;
    const nextChunkSize = maxBodyChars - widestPrefix.length;
    if (nextChunkSize === chunkSize) {
      break;
    }

    chunkSize = nextChunkSize;
  }

  return chunks.map((chunk, index) => `Transcript ${index + 1}/${chunks.length}\n\n${chunk}`);
}
