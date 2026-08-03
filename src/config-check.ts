import {
  getWhatsAppMetaConfigStatus,
  getWhatsAppWebhookConfigStatus,
  loadConfig
} from './config.js';

const config = loadConfig();
const metaStatus = getWhatsAppMetaConfigStatus(config);
const webhookStatus = getWhatsAppWebhookConfigStatus(config);

if (webhookStatus.configured) {
  console.log('WhatsApp configuration is present.');
  process.exit(0);
}

if (!metaStatus.configured) {
  console.error(`Missing Meta-side WhatsApp values: ${metaStatus.missing.join(', ')}`);
}

const missingMetaKeys = new Set<string>(metaStatus.missing);
const missingNonMetaKeys = webhookStatus.missing.filter(
  (key) => !missingMetaKeys.has(key)
);

if (missingNonMetaKeys.length > 0) {
  console.error(`Missing WhatsApp webhook values: ${missingNonMetaKeys.join(', ')}`);
}

console.error('Set these in .env or your deployment secrets. See docs/whatsapp-meta-setup.md.');
process.exit(1);
