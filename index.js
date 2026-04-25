// ============================================================
// FELIX — Sales Agent with Gmail Integration
// SBL IT Platforms Co., Ltd.
// ============================================================
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

const ANTHROPIC_KEY = (process.env.ANTHROPIC_API_KEY || '').replace(/\s+/g, '').trim();
const SLACK_TOKEN = (process.env.SLACK_BOT_TOKEN || '').replace(/\s+/g, '').trim();
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID || '';
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || '';
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN || '';
const GMAIL_FROM = process.env.GMAIL_FROM || 'saybelfinancing@gmail.com';

app.use((req, res, next) => {
  req.rawBody = '';
  req.on('data', chunk => { req.rawBody += chunk.toString(); });
  req.on('end', () => {
    try { req.body = req.rawBody ? JSON.parse(req.rawBody) : {}; }
    catch { req.body = {}; }
    next();
  });
});

// ── Gmail OAuth2 Token ────────────────────────────────────────
async function getGmailAccessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Failed to get Gmail token: ' + JSON.stringify(d));
  return d.access_token;
}

// ── Send Email via Gmail API ──────────────────────────────────
async function sendEmail(to, subject, body) {
  const token = await getGmailAccessToken();
  const emailLines = [
    `From: Felix @ SBL IT Platforms <${GMAIL_FROM}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    body
  ];
  const raw = Buffer.from(emailLines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw })
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Gmail send error: ' + JSON.stringify(d));
  return d;
}

// ── Read Emails via Gmail API ─────────────────────────────────
async function searchEmails(query, maxResults = 5) {
  const token = await getGmailAccessToken();
  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const d = await r.json();
  if (!d.messages) return [];

  // Get details for each message
  const messages = await Promise.all(d.messages.map(async msg => {
    const mr = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const md = await mr.json();
    const headers = md.payload?.headers || [];
    const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
    const from = headers.find(h => h.name === 'From')?.value || '';
    const date = headers.find(h => h.name === 'Date')?.value || '';
    const snippet = md.snippet || '';
    return { id: msg.id, subject, from, date, snippet };
  }));
  return messages;
}

// ── Draft Email via Gmail API ─────────────────────────────────
async function draftEmail(to, subject, body) {
  const token = await getGmailAccessToken();
  const emailLines = [
    `From: Felix @ SBL IT Platforms <${GMAIL_FROM}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    body
  ];
  const raw = Buffer.from(emailLines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message: { raw } })
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Gmail draft error: ' + JSON.stringify(d));
  return d;
}

// ── Felix System Prompt ───────────────────────────────────────
const FELIX_SYSTEM = `You are Felix, the B2B Sales AI Agent for SBL IT Platforms Co., Ltd.
You have access to Gmail (saybelfinancing@gmail.com) to send and read emails.

COMPANY: SBL IT PLATFORMS CO., LTD. | www.sblplat.co.th | www.sblplat.store
TARGETS: Revenue ฿250,000/month | New B2B Clients: 10-20/month

PRODUCTS:
- SBL Water 0.5L Glass: ฿54(500+)/฿58(40-499)/฿60(credit)/฿65(retail)
- SBL Water 0.5L PET: ฿44(500+)/฿48(40-499)/฿50(credit)/฿55(retail)
- FitnesShock Brownies (4 flavors) 50g: ฿75/pc
- SHOCKS! Bars (Pistachio/Peanut) 50g: ฿65/pc
- FitnesShock Dessert Bars 60g: ฿75/pc — 20g protein!
- NEW Glazed Bars 35g: ฿60/pc

GMAIL COMMANDS (use these exact formats to trigger email actions):
When user asks to SEND an email, respond with:
[SEND_EMAIL]
TO: recipient@email.com
SUBJECT: Your subject here
BODY:
Your email body here
[/SEND_EMAIL]

When user asks to DRAFT an email, respond with:
[DRAFT_EMAIL]
TO: recipient@email.com
SUBJECT: Your subject here
BODY:
Your email body here
[/DRAFT_EMAIL]

When user asks to CHECK emails or READ replies, respond with:
[SEARCH_EMAIL]
QUERY: search query here
[/SEARCH_EMAIL]

IMPORTANT: 
- Always confirm before sending — show the email content and ask "Shall I send this?"
- Only use SEND_EMAIL after user confirms
- Use DRAFT_EMAIL when user says "draft" or "prepare"
- Use SEARCH_EMAIL when user asks to check replies or inbox
- Emails sent FROM: saybelfinancing@gmail.com

TASKS: Lead generation, bilingual outreach (English+Thai), proposals, follow-ups, pipeline tracking, closing, sending/reading emails.
FORMAT: Slack markdown *bold*, • bullets, emojis. Concise. Always end with next step.
LANGUAGE: English default, switch to Thai if user writes Thai.`;

const conversations = new Map();
const processed = new Set();
let BOT_ID = null;

// ── Parse email commands from Claude response ─────────────────
function parseEmailCommand(text) {
  const sendMatch = text.match(/\[SEND_EMAIL\]([\s\S]*?)\[\/SEND_EMAIL\]/);
  const draftMatch = text.match(/\[DRAFT_EMAIL\]([\s\S]*?)\[\/DRAFT_EMAIL\]/);
  const searchMatch = text.match(/\[SEARCH_EMAIL\]([\s\S]*?)\[\/SEARCH_EMAIL\]/);

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
  if (searchMatch) {
    const query = searchMatch[1].match(/QUERY:\s*(.+)/)?.[1]?.trim();
    return { action: 'search', query, raw: searchMatch[0] };
  }
  return null;
}

// ── Execute email command ─────────────────────────────────────
async function executeEmailCommand(cmd) {
  if (cmd.action === 'send') {
    await sendEmail(cmd.to, cmd.subject, cmd.body);
    return `✅ *Email sent!*\n• *To:* ${cmd.to}\n• *Subject:* ${cmd.subject}\n\nEmail delivered from saybelfinancing@gmail.com 📧`;
  }
  if (cmd.action === 'draft') {
    await draftEmail(cmd.to, cmd.subject, cmd.body);
    return `📝 *Email saved to Drafts!*\n• *To:* ${cmd.to}\n• *Subject:* ${cmd.subject}\n\nCheck your Gmail drafts to review and send manually.`;
  }
  if (cmd.action === 'search') {
    const emails = await searchEmails(cmd.query);
    if (!emails.length) return `📭 No emails found for: "${cmd.query}"`;
    const list = emails.map(e =>
      `• *${e.subject}*\n  From: ${e.from}\n  ${e.snippet}`
    ).join('\n\n');
    return `📬 *Found ${emails.length} email(s):*\n\n${list}`;
  }
}

// ── Health check ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    agent: 'Felix',
    gmail: GMAIL_CLIENT_ID ? 'configured' : 'not configured',
    company: 'SBL IT Platforms Co., Ltd.'
  });
});

// ── Gmail OAuth callback (for initial setup) ──────────────────
app.get('/oauth/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send('No code provided');
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GMAIL_CLIENT_ID,
        client_secret: GMAIL_CLIENT_SECRET,
        redirect_uri: `${process.env.APP_URL}/oauth/callback`,
        grant_type: 'authorization_code'
      })
    });
    const d = await r.json();
    res.send(`
      <h2>✅ Gmail Connected!</h2>
      <p>Copy this refresh token to your Railway variables as <strong>GMAIL_REFRESH_TOKEN</strong>:</p>
      <textarea style="width:100%;height:100px">${d.refresh_token}</textarea>
      <p>Then restart your Railway deployment.</p>
    `);
  } catch (e) {
    res.send('Error: ' + e.message);
  }
});

// ── Gmail Auth URL (for initial setup) ───────────────────────
app.get('/oauth/start', (req, res) => {
  const url = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${GMAIL_CLIENT_ID}&` +
    `redirect_uri=${process.env.APP_URL}/oauth/callback&` +
    `response_type=code&` +
    `scope=https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose&` +
    `access_type=offline&prompt=consent`;
  res.redirect(url);
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
    await post(channel, `*สวัสดีครับ!* 👋 I'm *Felix*, Sales Agent for SBL IT Platforms!\n\nI now have Gmail access to *send and read emails* from saybelfinancing@gmail.com 📧\n\n• \`@Felix send outreach email to gym@example.com\`\n• \`@Felix check replies from leads this week\`\n• \`@Felix draft follow-up to Villa Market\`\n• \`@Felix generate leads\``, threadTs);
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

    // Check for email commands
    const emailCmd = parseEmailCommand(reply);
    if (emailCmd) {
      // Remove the command block from displayed text
      const displayText = reply.replace(emailCmd.raw, '').trim();
      if (displayText) await post(channel, displayText, threadTs);

      try {
        const result = await executeEmailCommand(emailCmd);
        await post(channel, result, threadTs);
      } catch (e) {
        await post(channel, `⚠️ Gmail error: ${e.message}`, threadTs);
      }
    } else {
      await post(channel, reply, threadTs);
    }
  } catch (e) {
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
  if (hist.length > 20) hist.splice(0, hist.length - 20);

  try {
    const reply = await claude(hist);
    hist.push({ role: 'assistant', content: reply });
    const emailCmd = parseEmailCommand(reply);
    if (emailCmd) {
      const displayText = reply.replace(emailCmd.raw, '').trim();
      if (displayText) await post(channel_id, `*Felix:* ${displayText}`);
      const result = await executeEmailCommand(emailCmd);
      await post(channel_id, result);
    } else {
      await post(channel_id, `*Felix:* ${reply}`);
    }
  } catch (e) {
    await post(channel_id, `⚠️ Error: ${e.message}`);
  }
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
