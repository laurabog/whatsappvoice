# WhatsApp Meta Setup

This app needs a WhatsApp Business Platform setup in Meta, three Meta-side values from that setup, and one webhook verify token that you choose.

## From Scratch Flow

1. Create or open a Meta business portfolio in Meta Business Suite.
2. Create a Meta developer app at https://developers.facebook.com/apps.
3. Add the WhatsApp product to the app.
4. Use WhatsApp > API setup to create or select a WhatsApp Business Account and sender phone number.
5. Copy the Phone Number ID for that sender number.
6. Generate an access token for local smoke tests.
7. For production, create a Meta system user, assign access to the app and WhatsApp Business Account, and generate a system-user token with WhatsApp messaging permissions.
8. Copy the App Secret from App settings > Basic.
9. Configure the WhatsApp webhook callback after the API is deployed to a public HTTPS URL.

Meta's Cloud API documentation notes that the API requires a Meta business portfolio, a WhatsApp Business Account, and a business phone number. The WhatsApp developer hub also calls out test numbers, webhooks, and sandbox support for getting started.

## What We Need From Meta

Collect these values and paste them into `.env` locally or into deployment secrets:

| App env var | Where to get it |
| --- | --- |
| `WHATSAPP_APP_SECRET` | Meta developer app > App settings > Basic |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp > API setup for temporary testing, or Business Settings > System Users for production |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp > API setup, next to the sender number |

Do not use the WhatsApp Business Account ID as `WHATSAPP_PHONE_NUMBER_ID`; they are different Meta IDs.

## Environment Variables

```text
WHATSAPP_VERIFY_TOKEN=choose-a-random-shared-secret
WHATSAPP_APP_SECRET=your-meta-app-secret
WHATSAPP_ACCESS_TOKEN=your-meta-access-token
WHATSAPP_PHONE_NUMBER_ID=your-whatsapp-phone-number-id
WHATSAPP_GRAPH_API_VERSION=v23.0
```

`WHATSAPP_VERIFY_TOKEN` is not copied from Meta. Choose a long random value, put it in `.env` or deployment secrets, and enter the same value when configuring the webhook callback in Meta.

`WHATSAPP_APP_SECRET` comes from the Meta app dashboard under App settings > Basic. The API uses it to verify the `x-hub-signature-256` header on incoming webhook requests.

`WHATSAPP_ACCESS_TOKEN` comes from the WhatsApp API setup flow or from a Meta system user. Temporary dashboard tokens are useful for smoke tests, but production should use a token generated for a system user with WhatsApp messaging access.

`WHATSAPP_PHONE_NUMBER_ID` comes from WhatsApp > API setup in the Meta app dashboard. Use the Phone Number ID for the sending number, not the WhatsApp Business Account ID.

## Meta Webhook Setup

Configure the WhatsApp webhook in Meta with:

```text
Callback URL: https://<your-api-host>/webhooks/whatsapp
Verify Token: the exact WHATSAPP_VERIFY_TOKEN value
Webhook fields: messages
```

The callback URL must be public HTTPS. For local-only testing, use a tunnel such as ngrok and point Meta at the tunnel URL plus `/webhooks/whatsapp`.

After setting the environment values, run:

```sh
npm run config:check
```

The command only reports which required names are missing. It does not print secret values.

The API can still run health checks and answer the webhook verification challenge
with only `WHATSAPP_VERIFY_TOKEN` configured. Real signed webhook POST handling,
WhatsApp replies, and WhatsApp media download need the Meta-side values above.

## Local Checklist

1. Copy `.env.example` to `.env`.
2. Fill in `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, and `WHATSAPP_PHONE_NUMBER_ID`.
3. Run `npm run config:check`.
4. Start the API with `npm run dev:api`.
5. Run `npm run db:migrate` with `DATABASE_URL` set.
6. Use your public HTTPS deployment URL as the Meta webhook callback URL.
7. Send a WhatsApp message to the configured number and confirm the API receives a signed webhook.

## References

- Meta WhatsApp Cloud API Postman documentation: https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api
- WhatsApp Cloud API Node.js SDK quickstart: https://whatsapp.github.io/WhatsApp-Nodejs-SDK/
