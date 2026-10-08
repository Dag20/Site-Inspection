import { bodyParameters, type TemplateName, type TemplateParams } from './templates';

export interface OutboundMessage {
  to: string;
  template: TemplateName;
  locale: string;
  params: TemplateParams;
  /** Appended to the template's button URL. Opens the record without a login. */
  linkToken: string;
}

export interface Channel {
  readonly name: 'whatsapp' | 'email';
  send(message: OutboundMessage): Promise<{ providerMessageId?: string }>;
}

/** Used when WhatsApp is not configured: development, tests and CI. */
export class ConsoleChannel implements Channel {
  readonly name = 'whatsapp' as const;
  sent: OutboundMessage[] = [];
  async send(message: OutboundMessage) {
    this.sent.push(message);
    if (process.env.NODE_ENV !== 'test') console.log(`[whatsapp:console] ${message.template} -> ${message.to}`, message.params);
    return {};
  }
}

export interface WhatsAppConfig {
  apiVersion: string;
  phoneNumberId: string;
  accessToken: string;
}

/** Sends an approved template through the WhatsApp Cloud API. */
export class WhatsAppCloudChannel implements Channel {
  readonly name = 'whatsapp' as const;
  constructor(private config: WhatsAppConfig, private fetchImpl: typeof fetch = fetch) {}

  buildPayload(message: OutboundMessage) {
    return {
      messaging_product: 'whatsapp',
      to: message.to.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: message.template,
        language: { code: message.locale },
        components: [
          { type: 'body', parameters: bodyParameters(message.template, message.params).map((text) => ({ type: 'text', text })) },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: message.linkToken }] },
        ],
      },
    };
  }

  async send(message: OutboundMessage) {
    const { apiVersion, phoneNumberId, accessToken } = this.config;
    const res = await this.fetchImpl(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(this.buildPayload(message)),
    });
    const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!res.ok) throw new Error(body.error?.message ?? `WhatsApp API returned ${res.status}`);
    return { providerMessageId: body.messages?.[0]?.id };
  }
}

export function channelFromEnv(env: NodeJS.ProcessEnv = process.env): Channel {
  const { WHATSAPP_API_VERSION, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN } = env;
  if (WHATSAPP_API_VERSION && WHATSAPP_PHONE_NUMBER_ID && WHATSAPP_ACCESS_TOKEN) {
    return new WhatsAppCloudChannel({ apiVersion: WHATSAPP_API_VERSION, phoneNumberId: WHATSAPP_PHONE_NUMBER_ID, accessToken: WHATSAPP_ACCESS_TOKEN });
  }
  return new ConsoleChannel();
}
