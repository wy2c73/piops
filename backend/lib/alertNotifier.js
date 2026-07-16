// Sends a title+message as a webhook notification. The exact payload shape
// depends on the destination -- Discord and Slack expect specific JSON
// fields, ntfy.sh wants the plain message as the raw POST body with the
// title in a header, and "generic" is a plain JSON object for anything
// else (a custom endpoint, Home Assistant, n8n, etc).

async function sendWebhook(config, { title, message }) {
  if (!config.webhookUrl) throw new Error('No webhook URL configured');

  let body;
  let headers = { 'Content-Type': 'application/json' };

  switch (config.format) {
    case 'discord':
      body = JSON.stringify({ content: `**${title}**\n${message}` });
      break;
    case 'slack':
      body = JSON.stringify({ text: `*${title}*\n${message}` });
      break;
    case 'ntfy':
      body = message;
      headers = { 'Content-Type': 'text/plain; charset=utf-8', Title: title };
      break;
    default:
      body = JSON.stringify({ title, message });
  }

  const res = await fetch(config.webhookUrl, { method: 'POST', headers, body });
  if (!res.ok) {
    throw new Error(`Webhook endpoint responded with HTTP ${res.status}`);
  }
}

module.exports = { sendWebhook };
