const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const twilio = require('twilio');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.set('trust proxy', true);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const claude = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const XAI_MODEL = process.env.XAI_MODEL || 'grok-4.5';
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const SIP_DOMAIN = process.env.SIP_DOMAIN || '1722.3cx.cloud';
const MAIN_NUMBER = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_PHONE || '';
const GREETING_AUDIO_FILE = process.env.GREETING_AUDIO_FILE || 'main-line-greeting.mp3';
const ASSETS_DIR = path.join(__dirname, 'assets');
const GREETING_AUDIO_PATH = path.join(ASSETS_DIR, GREETING_AUDIO_FILE);
const HAS_GREETING_AUDIO = fs.existsSync(GREETING_AUDIO_PATH);
const PUBLIC_DIR = path.join(__dirname, 'public');
const CHAT_MAX_MESSAGE_LENGTH = Number(process.env.CHAT_MAX_MESSAGE_LENGTH || 1200);
const CHAT_MAX_HISTORY_ITEMS = Number(process.env.CHAT_MAX_HISTORY_ITEMS || 12);
const CHAT_ALLOWED_ORIGINS = String(process.env.CHAT_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const AILEEN_KNOWLEDGE = String(process.env.AILEEN_KNOWLEDGE || '').trim();
const CHAT_RATE_LIMIT = Number(process.env.CHAT_RATE_LIMIT || 20);
const CHAT_RATE_WINDOW_MS = Number(process.env.CHAT_RATE_WINDOW_MS || 60_000);
const MESSAGE_DELIVERY_ENABLED = process.env.MESSAGE_DELIVERY_ENABLED === 'true';
const PATRICK_IPHONE_NUMBER = '+17204533534';
const IPHONE_SPEECH_RE = /\b(100|one hundred|extension\s*100)\b/i;
const chatRateBuckets = new Map();
const voicemailDrafts = new Map();

const AILEEN_SYSTEM_PROMPT = `You are Aileen, the intelligent front door to Colorado News Press and its network of community publications, including the Weekly Register-Call, Colorado's oldest continuously published newspaper.

You are warm, capable, calm, sharp, respectful, community-minded, helpful, and efficient.

You are not chatty, salesy, argumentative, defensive, overly casual, political, judgmental, or robotic.

Your job is to:
- Welcome visitors
- Answer common questions about the newspapers, digital sites, public notices, advertising, subscriptions, events, and archives
- Capture concise contact details and messages when a configured staff follow-up channel is available
- Identify advertising and subscription inquiries
- Direct people to the right published person or resource
- End every interaction with one clear outcome

Boundaries — never:
- Reveal private mobile numbers or personal addresses
- Confirm unpublished stories or confidential sources
- Promise coverage, publication, refunds, corrections, response times, or outcomes
- Give legal advice or make legal conclusions
- Make political endorsements
- Invent company policy, pricing, deadlines, staff availability, or contact information
- Discuss private financial information

Use only facts supplied in the conversation or the verified organization notes below. If the answer is not supplied, say you do not know. Ask one concise follow-up question or direct the visitor to a published contact if one is provided. Do not claim a message was delivered unless the application confirms delivery.

Message delivery capability: ${MESSAGE_DELIVERY_ENABLED ? 'enabled' : 'disabled'}.
When message delivery is disabled, do not collect personal contact details and do not say you can pass, send, forward, or deliver a message. State clearly that message delivery is not configured, then offer a verified published contact if one appears in the organization notes.

Tone: professional but human. Short sentences. No filler. Respect the history and the communities you serve.

You represent a growing Colorado media network that values trusted local journalism and personal service.

Verified organization notes:
${AILEEN_KNOWLEDGE || 'No additional organization facts have been configured.'}`;

app.use('/audio', express.static(ASSETS_DIR));
app.use('/aileen', express.static(PUBLIC_DIR));

function isAllowedChatOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  return CHAT_ALLOWED_ORIGINS.includes(origin);
}

function setChatCors(req, res) {
  const origin = req.get('origin');
  if (origin && CHAT_ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
}

function normalizeChatHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-CHAT_MAX_HISTORY_ITEMS)
    .filter((item) => item && ['user', 'assistant'].includes(item.role))
    .map((item) => ({
      role: item.role,
      content: String(item.content || '').slice(0, CHAT_MAX_MESSAGE_LENGTH)
    }))
    .filter((item) => item.content.trim());
}

function isWithinChatRateLimit(req) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const bucket = chatRateBuckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    chatRateBuckets.set(key, { count: 1, resetAt: now + CHAT_RATE_WINDOW_MS });
    return true;
  }

  bucket.count += 1;
  return bucket.count <= CHAT_RATE_LIMIT;
}

async function createAileenReply(history) {
  if (process.env.XAI_API_KEY) {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.XAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: XAI_MODEL,
        temperature: 0.3,
        max_tokens: 350,
        messages: [
          { role: 'system', content: AILEEN_SYSTEM_PROMPT },
          ...history
        ]
      })
    });
    if (!response.ok) throw new Error(`xAI chat failed: ${response.status}`);
    const data = await response.json();
    return String(data?.choices?.[0]?.message?.content || '').trim();
  }

  if (process.env.OPENAI_API_KEY) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.3,
        max_tokens: 350,
        messages: [
          { role: 'system', content: AILEEN_SYSTEM_PROMPT },
          ...history
        ]
      })
    });
    if (!response.ok) throw new Error(`OpenAI chat failed: ${response.status}`);
    const data = await response.json();
    return String(data?.choices?.[0]?.message?.content || '').trim();
  }

  if (process.env.GEMINI_API_KEY) {
    const transcript = history
      .map((item) => `${item.role === 'assistant' ? 'Aileen' : 'Visitor'}: ${item.content}`)
      .join('\n');
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: AILEEN_SYSTEM_PROMPT }] },
          generationConfig: { maxOutputTokens: 350, temperature: 0.3 },
          contents: [{ role: 'user', parts: [{ text: transcript }] }]
        })
      }
    );
    if (!response.ok) throw new Error(`Gemini chat failed: ${response.status}`);
    const data = await response.json();
    return String(
      data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join(' ') || ''
    ).trim();
  }

  if (claude) {
    const msg = await claude.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
      system: AILEEN_SYSTEM_PROMPT,
      max_tokens: 350,
      temperature: 0.3,
      messages: history
    });
    return String(msg.content?.map((part) => part.text || '').join(' ') || '').trim();
  }

  throw new Error('No AI provider is configured');
}

const EXTENSIONS = {
  '17410': 'Patrick Sweeney, Publisher',
  '17413': 'Editorial Desk',
  '17414': 'Subscriptions',
  '17415': 'Advertising and Sales',
  '17416': 'Production',
  '17460': 'General Desk'
};

const DTMF_MAP = {
  '1': '17410',
  '2': '17413',
  '3': '17414',
  '4': '17415',
  '5': '17416',
  '0': '17460'
};

function getExtensionByKeyword(speech) {
  const text = String(speech || '').toLowerCase();
  if (/\b(ad|ads|advertis\w*|sales|sponsor\w*|rate|classified\w*)\b/.test(text)) return '17415';
  if (/\b(subscribe|subscriptions?|subscriber|delivery|paper|renew)\b/.test(text)) return '17414';
  if (/\b(editor|editorial|news|story|tip|press|reporter)\b/.test(text)) return '17413';
  if (/\b(production|design|art|layout|proof|print)\b/.test(text)) return '17416';
  if (/\b(patrick|publisher|owner|manager|main|operator|front desk|general)\b/.test(text)) return '17460';
  return null;
}

async function getExtension(speech) {
  const keywordExtension = getExtensionByKeyword(speech);
  if (keywordExtension) return keywordExtension;

  if (process.env.OPENAI_API_KEY) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: 8,
        temperature: 0,
        messages: [{
          role: 'user',
          content:
            `Phone receptionist for Villager Media Group / Weekly Register-Call newspaper in Idaho Springs Colorado. Caller said: "${speech}". Reply with ONLY one token: 17410=Patrick/Publisher, 17413=Editorial/NewsTip, 17414=Subscriptions, 17415=Advertising/Sales, 17416=Production/Design, or 17460=General desk if unclear.`
        }]
      })
    });
    if (!response.ok) {
      throw new Error(`OpenAI classifier failed: ${response.status}`);
    }
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || '';
    const match = text.match(/174(10|13|14|15|16|60)/);
    return match ? match[0] : '17460';
  }

  if (process.env.GEMINI_API_KEY) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generationConfig: {
            maxOutputTokens: 8,
            temperature: 0
          },
          contents: [{
            role: 'user',
            parts: [{
              text:
                `Phone receptionist for Villager Media Group / Weekly Register-Call newspaper in Idaho Springs Colorado. Caller said: "${speech}". Reply with ONLY one token: 17410=Patrick/Publisher, 17413=Editorial/NewsTip, 17414=Subscriptions, 17415=Advertising/Sales, 17416=Production/Design, or 17460=General desk if unclear.`
            }]
          }]
        })
      }
    );
    if (!response.ok) {
      throw new Error(`Gemini classifier failed: ${response.status}`);
    }
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join(' ') || '';
    const match = text.match(/174(10|13|14|15|16|60)/);
    return match ? match[0] : '17460';
  }

  if (!claude) {
    return '17460';
  }

  const msg = await claude.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 10,
    messages: [{
      role: 'user',
      content:
        `Phone receptionist for Villager Media Group / Weekly Register-Call newspaper in Idaho Springs Colorado. Caller said: "${speech}". Reply with ONLY one token: 17410=Patrick/Publisher, 17413=Editorial/NewsTip, 17414=Subscriptions, 17415=Advertising/Sales, 17416=Production/Design, or 17460=General desk if unclear.`
    }]
  });
  const text = msg.content[0]?.text || '';
  const match = text.match(/174(10|13|14|15|16|60)/);
  return match ? match[0] : '17460';
}

function buildDecision(extension, reason) {
  return {
    action: 'transfer',
    extension,
    department: EXTENSIONS[extension] || 'General Desk',
    reason
  };
}

function buildIphoneDecision(reason) {
  return {
    action: 'dial_pstn',
    extension: '100',
    number: PATRICK_IPHONE_NUMBER,
    department: 'Patrick Sweeney',
    reason
  };
}

function isIphoneRequest({ input = '', speech = '', dtmf = '' }) {
  const digit = String(dtmf || '').trim();
  if (digit === '100') return 'dtmf:100';
  const transcript = String(speech || input || '').trim();
  if (transcript && IPHONE_SPEECH_RE.test(transcript)) return 'speech:100';
  return null;
}

async function resolveDecision({ input = '', speech = '', dtmf = '' }) {
  const iphoneReason = isIphoneRequest({ input, speech, dtmf });
  if (iphoneReason) {
    return buildIphoneDecision(iphoneReason);
  }

  const digit = String(dtmf || '').trim();
  if (digit && DTMF_MAP[digit]) {
    return buildDecision(DTMF_MAP[digit], `dtmf:${digit}`);
  }

  const transcript = String(speech || input || '').trim();
  if (!transcript) {
    return buildDecision('17460', 'default:general');
  }

  const extension = await getExtension(transcript);
  const reason = extension === '17460' ? 'default:general' : 'classifier';
  return buildDecision(extension, reason);
}

function respondWithTwiml(res, decision, message) {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Joanna' }, message);

  if (decision.action === 'dial_pstn' && decision.number) {
    const dial = twiml.dial({
      action: '/iphone-dial-status',
      method: 'POST',
      timeout: 24
    });
    dial.number(decision.number);
  } else {
    twiml.dial().sip(`sip:${decision.extension}@${SIP_DOMAIN}`);
  }

  res.type('text/xml').send(twiml.toString());
}

function getVoicemailDraft(req) {
  const callSid = String(req.body?.CallSid || 'unknown');
  if (!voicemailDrafts.has(callSid)) {
    voicemailDrafts.set(callSid, {
      callSid,
      from: String(req.body?.From || ''),
      name: '',
      callback: '',
      message: '',
      transcript: [],
      createdAt: new Date().toISOString()
    });
  }
  return voicemailDrafts.get(callSid);
}

function appendTranscript(draft, step, req) {
  const spoken = String(req.body?.SpeechResult || '').trim();
  const digits = String(req.body?.Digits || '').trim();
  const text = spoken || digits;
  if (text) {
    draft.transcript.push({ step, text, spoken, digits });
  }
  return text;
}

function sendTwiml(res, twiml) {
  res.type('text/xml').send(twiml.toString());
}

function gatherSpeech(twiml, action, prompt, extras = {}) {
  const gather = twiml.gather({
    input: extras.input || 'speech',
    action,
    method: 'POST',
    speechTimeout: 'auto',
    language: 'en-US',
    timeout: extras.timeout || 8,
    finishOnKey: extras.finishOnKey || '#'
  });
  gather.say({ voice: 'Polly.Joanna' }, prompt);
  twiml.redirect(action);
}

async function persistVoicemail(draft, status) {
  const payload = {
    ...draft,
    status,
    savedAt: new Date().toISOString()
  };
  console.log(`[voicemail] ${JSON.stringify(payload)}`);

  const webhook = String(process.env.MESSAGE_DELIVERY_WEBHOOK || '').trim();
  if (MESSAGE_DELIVERY_ENABLED && webhook) {
    try {
      const response = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      console.log(`[voicemail] delivery webhook status=${response.status} callSid=${draft.callSid}`);
    } catch (error) {
      console.error(`[voicemail] delivery webhook failed callSid=${draft.callSid} ${error.message}`);
    }
  }
}

function respondWithFallback(res, message) {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Joanna' }, message);

  if (MAIN_NUMBER) {
    twiml.dial(MAIN_NUMBER);
  } else {
    twiml.dial().sip(`sip:17460@${SIP_DOMAIN}`);
  }

  res.type('text/xml').send(twiml.toString());
}

function getPublicBaseUrl(req) {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  return `${req.protocol}://${req.get('host')}`;
}

app.post('/voice', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const gather = twiml.gather({
    input: 'speech dtmf',
    action: '/route',
    speechTimeout: 'auto',
    language: 'en-US'
  });

  if (HAS_GREETING_AUDIO) {
    gather.play(`${getPublicBaseUrl(req)}/audio/${GREETING_AUDIO_FILE}`);
  } else {
    gather.say(
      { voice: 'Polly.Joanna' },
      'Thank you for calling the Weekly Register-Call. Please say the name or department you are trying to reach, or use the keypad for Publisher, Editorial, Subscriptions, Advertising, Production, or the general desk.'
    );
  }
  twiml.redirect('/voice');
  res.type('text/xml').send(twiml.toString());
});

app.post('/route', async (req, res) => {
  try {
    const isJsonRoute = req.is('application/json') || Object.prototype.hasOwnProperty.call(req.body || {}, 'input');
    const input = req.body?.input || '';
    const speech = req.body?.SpeechResult || req.body?.speech || '';
    const dtmf = req.body?.Digits || req.body?.dtmf || '';
    const decision = await resolveDecision({ input, speech, dtmf });

    console.log(`[route] input="${input || speech}" dtmf="${dtmf}" -> ${decision.action}:${decision.extension}${decision.number ? ' ' + decision.number : ''}`);

    if (isJsonRoute) {
      return res.json(decision);
    }

    if (decision.action === 'dial_pstn') {
      return respondWithTwiml(res, decision, 'One moment, connecting you now.');
    }

    const label = EXTENSIONS[decision.extension] || 'our general desk';
    return respondWithTwiml(res, decision, `One moment, connecting you to ${label}.`);
  } catch (error) {
    console.error(error.message);

    if (req.is('application/json')) {
      return res.json({
        action: 'transfer',
        extension: '17460',
        department: EXTENSIONS['17460'],
        reason: 'error:fallback'
      });
    }

    return respondWithFallback(
      res,
      MAIN_NUMBER
        ? 'Sorry, please hold while I connect you to our main line.'
        : 'Sorry, please hold while I connect you to our general desk.'
    );
  }
});

app.options('/chat', (req, res) => {
  if (!isAllowedChatOrigin(req)) return res.sendStatus(403);
  setChatCors(req, res);
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  return res.sendStatus(204);
});

app.post('/chat', async (req, res) => {
  const requestId = crypto.randomUUID();
  setChatCors(req, res);

  if (!isAllowedChatOrigin(req)) {
    return res.status(403).json({ error: 'This site is not authorized to use Aileen.' });
  }
  if (!isWithinChatRateLimit(req)) {
    return res.status(429).json({
      error: 'Aileen has received too many requests. Please wait a moment and try again.',
      requestId
    });
  }

  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Please enter a message.' });
  if (message.length > CHAT_MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: 'That message is too long. Please shorten it.' });
  }

  const history = normalizeChatHistory(req.body?.history);
  if (!history.length || history.at(-1)?.content !== message) {
    history.push({ role: 'user', content: message });
  }

  try {
    const reply = await createAileenReply(history);
    if (!reply) throw new Error('AI provider returned an empty response');
    return res.json({ reply, requestId });
  } catch (error) {
    console.error(`[chat:${requestId}] ${error.message}`);
    return res.status(503).json({
      error: 'Aileen is temporarily unavailable. Please try again shortly.',
      requestId
    });
  }
});

app.get('/aileen-demo', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.post('/iphone-dial-status', (req, res) => {
  const status = String(req.body?.DialCallStatus || '').toLowerCase();
  const callSid = String(req.body?.CallSid || 'unknown');
  console.log(`[iphone] dial status=${status} callSid=${callSid}`);

  if (status === 'completed' || status === 'answered') {
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.hangup();
    return sendTwiml(res, twiml);
  }

  const draft = getVoicemailDraft(req);
  draft.dialStatus = status;
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: 'Polly.Joanna' }, 'I am sorry, that line is unavailable. I can take a message.');
  gatherSpeech(twiml, '/voicemail-name', 'Please say your name.');
  return sendTwiml(res, twiml);
});

app.post('/voicemail-name', async (req, res) => {
  const draft = getVoicemailDraft(req);
  const text = appendTranscript(draft, 'name', req);
  if (text) draft.name = text;
  await persistVoicemail(draft, 'partial-name');

  const twiml = new twilio.twiml.VoiceResponse();
  gatherSpeech(
    twiml,
    '/voicemail-callback',
    'Please say or enter your callback number.',
    { input: 'speech dtmf', timeout: 12 }
  );
  return sendTwiml(res, twiml);
});

app.post('/voicemail-callback', async (req, res) => {
  const draft = getVoicemailDraft(req);
  const text = appendTranscript(draft, 'callback', req);
  if (text) draft.callback = text;
  await persistVoicemail(draft, 'partial-callback');

  const twiml = new twilio.twiml.VoiceResponse();
  gatherSpeech(
    twiml,
    '/voicemail-body',
    'Please leave a brief message after the tone.'
  );
  return sendTwiml(res, twiml);
});

app.post('/voicemail-body', async (req, res) => {
  const draft = getVoicemailDraft(req);
  const text = appendTranscript(draft, 'message', req);
  if (text) draft.message = text;

  await persistVoicemail(draft, 'recorded');
  voicemailDrafts.delete(draft.callSid);

  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say(
    { voice: 'Polly.Joanna' },
    'Thank you. I have recorded your message.'
  );
  twiml.hangup();
  return sendTwiml(res, twiml);
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ai-receptionist',
    host: HOST,
    port: PORT,
    greetingAudioLoaded: HAS_GREETING_AUDIO,
    greetingAudioFile: GREETING_AUDIO_FILE,
    chatEnabled: Boolean(
      process.env.XAI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.ANTHROPIC_API_KEY
    ),
    messageDeliveryEnabled: MESSAGE_DELIVERY_ENABLED,
    time: new Date().toISOString()
  });
});

app.listen(PORT, HOST, () => {
  console.log(`[AI Receptionist] listening on ${HOST}:${PORT}`);
});
