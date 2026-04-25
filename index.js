const express = require('express');
const nodemailer = require('nodemailer');
const app = express();
const PORT = process.env.PORT || 3000;

const ANTHROPIC_KEY = (process.env.ANTHROPIC_API_KEY || '').replace(/\s+/g, '').trim();
const SLACK_TOKEN = (process.env.SLACK_BOT_TOKEN || '').replace(/\s+/g, '').trim();
const GMAIL_USER = process.env.GMAIL_USER || 'saybelfinancing@gmail.com';
const GMAIL_PASS = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '');

app.use((req, res, next) => {
  req.rawBody = '';
  req.on('data', chunk => { req.rawBody += chunk.toString(); });
  req.on('end', () => {
    try { req.body = req.rawBody ? JSON.parse(req.rawBody) : {}; }
    catch { req.body = {}; }
    next();
  });
});

// ── Gmail transporter ─────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_PASS }
});

async function sendEmail(to, subject, body) {
  await transporter.sendMail({
    from: `Felix @ SBL IT Platforms <${GMAIL_USER}>`,
    to, subject, text: body
  });
}

async function searchEmails(query) {
  // Note: For reading emails we use IMAP - simplified version just sends
  return `Search results for "${query}" — reading emails requires IMAP setup. Felix can send emails now!`;
}

// ── Felix system prompt ───────────────────────────────────────
const FELIX_SYSTEM = `You are Felix, the B2B Sales AI Agent for SBL IT Platforms Co., Ltd.
You have access to Gmail (${GMAIL_USER}) to SEND emails directly.

COMPANY: SBL IT PLATFORMS CO., LTD. | www.sblplat.co.th | www.sblplat.store
TARGETS: Revenue ฿250,000/month | New B2B Clients: 10-20/month

PRODUCTS:
- SBL Water 0.5L Glass: ฿54(500+)/฿58(40-499)/฿60(credit)/฿65(retail)
- SBL Water 0.5L PET: ฿44(500+)/฿48(40-499)/฿50(credit)/฿55(retail)
- FitnesShock Brownies (4 flavors) 50g: ฿75/pc
- SHOCKS! Bars (Pistachio/Peanut) 50g: ฿65/pc
- FitnesShock Dessert Bars 60g: ฿75/pc — 20g protein!
- NEW Glazed Bars 35g: ฿60/pc

EMAIL COMMANDS:
When user asks to SEND an email, respond with this exact format:
[SEND_EMAIL]
TO: recipient@email.com
SUBJECT: Subject here
BODY:
Email body here
[/SEND_EMAIL]

When user asks to DRAFT (prepare but not send), respond with:
[DRAFT_EMAIL]
TO: recipient@email.com
SUBJECT: Subject here
BODY:
Email body here
[/DRAFT_EMAIL]

RULES:
- Always show email content before sending and ask "Shall I send this?"
- Only use [SEND_EMAIL] after user confirms with "yes send it" or "send"
- Use [DRAFT_EMAIL] when user says "draft" or "prepare" or "write"
- Sign emails as: Felix | Sales Agent | SBL IT Platforms Co., Ltd.

TASKS: Lead generation, bilingual outreach (English+Thai), proposals, follow-ups, pipeline, closing, sending emails.
FORMAT: Slack markdown *bold*, bullets, emojis. Always end with next step.
LANGUAGE: English default, Thai if user writes Thai.`;

const conversations = new Map();
const processed = new Set();
let BOT_ID = null;

// ── Parse email commands ──────────────────────────────────────
function parseEmailCommand(text) {
  const sendMatch = text.match(/\[SEND_EMAIL\]([\s\S]*?)\[\/SEND_EMAIL\]/);
  const draftMatch = text.match(/\[DRAFT_EMAIL\]([\s\S]*?)\[\/DRAFT_EMAIL\]/);

  if (sendMatch) {
    const block = sendMatch[1];
    const to = block.match(/TO:\s*(.+)/)?.[1]?.trim();
    const subject = block.match(/SUBJECT:\s*(.+)/)?.[1]?.trim();
    const body = block.match(/BODY:\s*([\s\S]+)/)?.[1]?.trim();
    return { action: 'send', to, subject, body, raw: sendMatch[0] };
  }
  if (draftMatch) {
    const block = draftMatch[1];
    const to = block.match(/TO:\s*(.+)/)?.[1]?.trim();
    const subject = block.match(/SUBJECT:\s*(.+)/)?.[1]?.trim();
    const body = block.match(/BODY:\s*([\s\S]+)/)?.[1]?.trim();
    return { action: 'draft', to, subject, body, raw: draftMatch[0] };
  }
  return null;
}

// ── Health check ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    agent: 'Felix',
    gmail: GMAIL_PASS ? 'configured' : 'missing',
    gmailUser: GMAIL_USER,
    company: 'SBL IT Platforms Co., Ltd.'
  });
});

// ── Slack Events ──────────────────────────────────────────────
app.post('/slack/events', async (req, res) => {
  const body = req.body;
  if (body && body.type === 'url_verification') {
    return res.status(200).json({ challenge: body.challenge });
  }
  res.status(200).end('OK');

  const event = body && body.event;
  if (!event || event.type !== 'message' || event.subtype || event.bot_id) return;

  const key = event.client_msg_id || event.ts;
  if (processed.has(key)) return;
  processed.add(key);
  setTimeout(() => processed.delete(key), 60000);

  if (!BOT_ID) {
    try {
      const r = await fetch('https://slack.com/api/auth.test', {
        headers: { Authorization: `Bearer ${SLACK_TOKEN}` }
      });
      const d = await r.json();
      BOT_ID = d.user_id;
    } catch (e) { return; }
  }

  const isMentioned = event.text && event.text.includes(`<@${BOT_ID}>`);
  const isDM = event.channel_type === 'im';
  if (!isMentioned && !isDM) return;

  const channel = event.channel;
  const threadTs = event.thread_ts || event.ts;
  const userText = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();

  if (!userText) {
    await post(channel, `*สวัสดีครับ!* 👋 I'm *Felix*, Sales Agent for SBL IT Platforms!\n\nI can now *send emails* from ${GMAIL_USER} 📧\n\n• \`@Felix send outreach email to gym@example.com\`\n• \`@Felix draft follow-up to Villa Market\`\n• \`@Felix generate leads\`\n• \`@Felix create sales proposal\``, threadTs);
    return;
  }

  const convKey = isDM ? event.user : `${channel}:${threadTs}`;
  if (!conversations.has(convKey)) conversations.set(convKey, []);
  const hist = conversations.get(convKey);
  hist.push({ role: 'user', content: userText });
  if (hist.length > 20) hist.splice(0, hist.length - 20);

  const typing = await post(channel, '_Felix is thinking... 🤔_', threadTs);

  try {
    const reply = await claude(hist);
    hist.push({ role: 'assistant', content: reply });
    if (typing && typing.ts) await del(channel, typing.ts);

    const emailCmd = parseEmailCommand(reply);
    if (emailCmd) {
      const displayText = reply.replace(emailCmd.raw, '').trim();
      if (displayText) await post(channel, displayText, threadTs);

      if (emailCmd.action === 'send') {
        try {
          await sendEmail(emailCmd.to, emailCmd.subject, emailCmd.body);
          await post(channel, `✅ *Email sent!*\n• *To:* ${emailCmd.to}\n• *Subject:* ${emailCmd.subject}\n\nDelivered from ${GMAIL_USER} 📧`, threadTs);
        } catch (e) {
          await post(channel, `⚠️ Failed to send email: ${e.message}`, threadTs);
        }
      } else if (emailCmd.action === 'draft') {
        await post(channel, `📝 *Email draft ready:*\n• *To:* ${emailCmd.to}\n• *Subject:* ${emailCmd.subject}\n\n*Body:*\n${emailCmd.body}\n\n_Reply "send it" to send, or "edit" to modify._`, threadTs);
        // Store draft for confirmation
        hist.push({ role: 'assistant', content: `PENDING_DRAFT:${JSON.stringify(emailCmd)}` });
      }
    } else {
      // Check if user is confirming a pending draft
      const lastMsg = hist[hist.length - 2]?.content || '';
      if (lastMsg.startsWith('PENDING_DRAFT:') && 
          (userText.toLowerCase().includes('send') || userText.toLowerCase() === 'yes')) {
        try {
          const draft = JSON.parse(lastMsg.replace('PENDING_DRAFT:', ''));
          await sendEmail(draft.to, draft.subject, draft.body);
          await post(channel, `✅ *Email sent!*\n• *To:* ${draft.to}\n• *Subject:* ${draft.subject}\n\nDelivered from ${GMAIL_USER} 📧`, threadTs);
        } catch (e) {
          await post(channel, `⚠️ Failed to send: ${e.message}`, threadTs);
        }
      } else {
        await post(channel, reply, threadTs);
      }
    }
  } catch (e) {
    console.error('Error:', e.message);
    if (typing && typing.ts) await del(channel, typing.ts);
    await post(channel, `⚠️ Error: ${e.message}. Please try again.`, threadTs);
  }
});

// ── Slash command ─────────────────────────────────────────────
app.post('/slack/commands', async (req, res) => {
  const p = new URLSearchParams(req.rawBody);
  const text = p.get('text') || 'Hello';
  const channel_id = p.get('channel_id') || '';
  const user_id = p.get('user_id') || '';
  res.status(200).json({ response_type: 'in_channel', text: `_Felix is on it..._` });
  const convKey = `cmd:${user_id}`;
  if (!conversations.has(convKey)) conversations.set(convKey, []);
  const hist = conversations.get(convKey);
  hist.push({ role: 'user', content: text });
  try {
    const reply = await claude(hist);
    hist.push({ role: 'assistant', content: reply });
    const emailCmd = parseEmailCommand(reply);
    if (emailCmd && emailCmd.action === 'send') {
      await sendEmail(emailCmd.to, emailCmd.subject, emailCmd.body);
      await post(channel_id, `*Felix:* ✅ Email sent to ${emailCmd.to}`);
    } else {
      await post(channel_id, `*Felix:* ${reply}`);
    }
  } catch (e) { await post(channel_id, `⚠️ Error: ${e.message}`); }
});

async function post(channel, text, thread_ts) {
  const body = { channel, text };
  if (thread_ts) body.thread_ts = thread_ts;
  try {
    const r = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SLACK_TOKEN}` },
      body: JSON.stringify(body)
    });
    return r.json();
  } catch (e) { return null; }
}

async function del(channel, ts) {
  try {
    await fetch('https://slack.com/api/chat.delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SLACK_TOKEN}` },
      body: JSON.stringify({ channel, ts })
    });
  } catch (e) {}
}

async function claude(messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 1024, system: FELIX_SYSTEM, messages })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Claude API ${r.status}: ${d.error?.message || JSON.stringify(d)}`);
  return d.content?.map(b => b.text || '').join('') || 'No response.';
}

app.listen(PORT, () => console.log(`🤖 Felix + Gmail running on port ${PORT}`));
