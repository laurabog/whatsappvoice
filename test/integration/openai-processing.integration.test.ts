import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { OpenAISummarizer } from '../../src/services/summarizer.js';
import { OpenAITranscriber } from '../../src/services/transcriber.js';

const shouldRun = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_TEST_AUDIO_PATH);
const describeWithOpenAI = shouldRun ? describe : describe.skip;

describeWithOpenAI('OpenAI processing integration', () => {
  it('transcribes a local audio file and produces a structured summary', async () => {
    const config = loadConfig(process.env);
    const transcriber = new OpenAITranscriber(config);
    const summarizer = new OpenAISummarizer(config);

    const transcription = await transcriber.transcribe({
      audioPath: process.env.OPENAI_TEST_AUDIO_PATH,
      mimeType: null,
      language: 'en'
    });
    const summary = await summarizer.summarize({
      transcript: transcription.text
    });

    expect(transcription.text.length).toBeGreaterThan(0);
    expect(summary.shortSummary.length).toBeGreaterThan(0);
    expect(['summary_enough', 'listen_when_you_can', 'listen_soon']).toContain(
      summary.listeningRecommendation
    );
  });
});
