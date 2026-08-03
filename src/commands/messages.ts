export const helpMessage = `Forward me an English WhatsApp voice note and I will summarize it.

Tip: send "From Alex" before the note if you want me to label who it came from.

I temporarily process audio with AI transcription and summarization. Audio is deleted after processing. Summaries and transcripts are kept for 30 days, then deleted. Send TRANSCRIPT for the latest transcript, or DELETE to remove saved summaries, transcripts, and labels.`;

export const unsupportedMessage =
  'I can summarize voice notes only. Forward me an English WhatsApp audio message.';

export const deleteConfirmationMessage =
  'Done - I deleted your saved summaries, transcripts, and sender labels.';

export const noTranscriptMessage =
  'I do not have a transcript available for that voice note anymore.';
