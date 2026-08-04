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
  receivedAt: Date;
  now?: Date;
  timeZone?: string;
  summary: SummaryOutput;
};

type DateParts = {
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
};

function partsForDate(date: Date, timeZone: string): DateParts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return {
    day: parts.day ?? '',
    month: parts.month ?? '',
    year: parts.year ?? '',
    hour: parts.hour ?? '00',
    minute: parts.minute ?? '00'
  };
}

export function formatReceivedAt(
  receivedAt: Date,
  now = new Date(),
  timeZone = 'Europe/Madrid'
): string {
  const received = partsForDate(receivedAt, timeZone);
  const current = partsForDate(now, timeZone);
  const time = `${received.hour}:${received.minute}`;

  if (
    received.day === current.day &&
    received.month === current.month &&
    received.year === current.year
  ) {
    return `today at ${time}`;
  }

  return `${received.day} ${received.month} ${received.year}, ${time}`;
}

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
      `🎧 Voice note from ${input.fromLabel}`,
      `Received: ${formatReceivedAt(input.receivedAt, input.now, input.timeZone)}`,
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
