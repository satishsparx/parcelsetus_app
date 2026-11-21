function toWhatsAppNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  const countryCode = String(process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || '91').replace(/\D/g, '');
  const normalized = digits.length === 10 ? `${countryCode}${digits}` : digits;
  if (normalized.length < 8 || normalized.length > 15)
    throw new Error('Recipient phone number is not valid for WhatsApp.');
  return normalized;
}

export class WhatsAppCloudAdapter {
  get isConfigured() {
    return Boolean(
      process.env.WHATSAPP_ACCESS_TOKEN &&
      process.env.WHATSAPP_PHONE_NUMBER_ID &&
      process.env.WHATSAPP_SHIPMENT_BOOKED_TEMPLATE,
    );
  }

  async send({ to, payload }) {
    if (!this.isConfigured) throw new Error('WhatsApp Cloud API is not configured.');

    const version = process.env.WHATSAPP_GRAPH_API_VERSION || 'v27.0';
    const phoneNumber = toWhatsAppNumber(to);
    const templateName = process.env.WHATSAPP_SHIPMENT_BOOKED_TEMPLATE;
    const language = process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en';
    const response = await fetch(
      `https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: phoneNumber,
          type: 'template',
          template: {
            name: templateName,
            language: { code: language },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: payload.recipientName },
                  { type: 'text', text: payload.carrier },
                  { type: 'text', text: payload.trackingNumber },
                  { type: 'text', text: payload.status },
                ],
              },
            ],
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const description = result.error?.error_user_msg || result.error?.message;
      throw new Error(description || `WhatsApp API request failed (${response.status}).`);
    }

    return { messageId: result.messages?.[0]?.id || '' };
  }
}
