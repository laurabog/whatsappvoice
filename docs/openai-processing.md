# OpenAI And Media Processing

Ticket 7 adds real OpenAI service implementations behind the existing fake worker
interfaces. The media-download layer is also ready for WhatsApp media URLs once the
Meta account credentials are available.

## Environment

```text
WHATSAPP_ACCESS_TOKEN=your-meta-access-token
WHATSAPP_PHONE_NUMBER_ID=your-whatsapp-phone-number-id
OPENAI_API_KEY=your-openai-api-key
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
OPENAI_SUMMARY_MODEL=gpt-4o-mini
MAX_AUDIO_BYTES=16777216
MAX_AUDIO_DURATION_SECONDS=600
TEMP_AUDIO_DIR=/tmp/whatsapp-summary-audio
```

The worker uses fake processing by default. When `OPENAI_API_KEY` is configured, it
switches to the real path:

```text
WhatsApp media ID -> Meta media URL -> temp audio file -> OpenAI transcription -> OpenAI summary -> WhatsApp reply
```

The current Prisma Compute deployment runs the API entrypoint. That is enough for
health checks and webhook verification, but queued audio jobs need a worker process
before production messages can be fully processed.

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
- WhatsApp media is downloaded to `TEMP_AUDIO_DIR`, validated, and deleted after
  processing succeeds or fails.
- The app accepts WhatsApp-supported audio MIME types and requires `audio/ogg` to
  include the Opus codec marker.
