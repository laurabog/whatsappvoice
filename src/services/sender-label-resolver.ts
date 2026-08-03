import type { PendingSenderLabelRecord } from '../db/repositories/pending-sender-labels.js';
import type { SummaryOutput } from './reply-formatter.js';

export type SenderLabelConfidence =
  | 'user_provided'
  | 'transcript_self_identification'
  | 'unknown';

export type ResolvedSenderLabel = {
  label: string;
  confidence: SenderLabelConfidence;
};

export function resolveSenderLabel(input: {
  pendingLabel: PendingSenderLabelRecord | null;
  summary: Pick<SummaryOutput, 'explicitSpeakerSelfIdentification'>;
}): ResolvedSenderLabel {
  if (input.pendingLabel) {
    return {
      label: input.pendingLabel.label,
      confidence: 'user_provided'
    };
  }

  const selfIdentification = input.summary.explicitSpeakerSelfIdentification;
  if (selfIdentification && selfIdentification.confidence !== 'low') {
    return {
      label: `probably ${selfIdentification.name}`,
      confidence: 'transcript_self_identification'
    };
  }

  return {
    label: 'unknown sender',
    confidence: 'unknown'
  };
}
