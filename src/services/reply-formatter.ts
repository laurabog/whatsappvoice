export type ListeningRecommendation =
  | 'summary_enough'
  | 'listen_when_you_can'
  | 'listen_soon';

export type SummaryPoint = {
  label: string;
  evidence: string;
  confidence: 'low' | 'medium' | 'high';
};

export type SummaryOutput = {
  oneSentenceSummary: string;
  shortSummary: string;
  importantPoints: SummaryPoint[];
  questionsOrRequests: string[];
  datesOrCommitments: string[];
  replyNeeded: boolean;
  listeningRecommendation: ListeningRecommendation;
  explicitSpeakerSelfIdentification?: {
    name: string;
    evidence: string;
    confidence: 'low' | 'medium' | 'high';
  };
  uncertainties: string[];
};

export type FormatSummaryReplyInput = {
  fromLabel: string;
  summary: SummaryOutput;
};

function recommendationText(recommendation: ListeningRecommendation): string {
  if (recommendation === 'listen_soon') {
    return 'Worth listening soon.';
  }

  if (recommendation === 'listen_when_you_can') {
    return 'Worth listening when you have time.';
  }

  return 'Summary is probably enough.';
}

function bulletLines(values: string[], fallback: string): string {
  if (values.length === 0) {
    return fallback;
  }

  return values.map((value) => `- ${value}`).join('\n');
}

export function formatSummaryReply(input: FormatSummaryReplyInput): string[] {
  const importantLines = bulletLines(
    input.summary.importantPoints.map((point) => point.label),
    'Nothing major stood out.'
  );
  const replyLines = bulletLines(
    input.summary.questionsOrRequests,
    input.summary.replyNeeded ? 'Reply needed, but no exact ask was extracted.' : 'Probably not.'
  );

  return [
    [
      'Voice note summary',
      `From: ${input.fromLabel}`,
      '',
      input.summary.shortSummary,
      '',
      'Important',
      importantLines,
      '',
      'You may want to reply',
      replyLines,
      '',
      'Listen?',
      recommendationText(input.summary.listeningRecommendation),
      '',
      'Reply TRANSCRIPT within 30 days if you want the full transcript.'
    ].join('\n')
  ];
}
