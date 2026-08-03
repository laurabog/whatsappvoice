import type { SummaryOutput } from './reply-formatter.js';

export type SummarizerInput = {
  transcript: string;
};

export interface Summarizer {
  summarize(input: SummarizerInput): Promise<SummaryOutput>;
}

export class FakeSummarizer implements Summarizer {
  async summarize(input: SummarizerInput): Promise<SummaryOutput> {
    return {
      oneSentenceSummary:
        'The speaker asks you to review the plan and reply when you can.',
      shortSummary:
        'The speaker wants you to look over the plan and send a response when convenient.',
      importantPoints: [
        {
          label: 'Review the plan',
          evidence: input.transcript,
          confidence: 'high'
        }
      ],
      questionsOrRequests: ['Reply when you can.'],
      datesOrCommitments: [],
      replyNeeded: true,
      listeningRecommendation: 'summary_enough',
      uncertainties: []
    };
  }
}
