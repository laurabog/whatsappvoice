# OpenAI Processing

Ticket 7 adds real OpenAI service implementations behind the existing fake worker interfaces.

## Environment

```text
OPENAI_API_KEY=your-openai-api-key
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
OPENAI_SUMMARY_MODEL=gpt-4o-mini
```

The production worker still uses fake processing until real Meta media download and cleanup are wired. This keeps costs off by default while the WhatsApp Business setup is pending.

## Local Integration Test

Use a small English audio file you are allowed to process:

```sh
OPENAI_API_KEY=... OPENAI_TEST_AUDIO_PATH=/absolute/path/to/audio.ogg npm run test:openai
```

The normal `npm test` suite mocks OpenAI and does not make network calls.

## Implementation Notes

- Transcription uses the OpenAI audio transcription API with `response_format=json` and `language=en`.
- Summarization uses the Responses API with a strict Zod-backed structured output schema.
- Transcript text is treated as untrusted content in the summarizer prompt.
- The model may report explicit speaker self-identification, but the app decides final sender attribution.
