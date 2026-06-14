const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const twilio = require('twilio');
const fs = require('fs');
const path = require('path');

const app = express();
app.set('trust proxy', true);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const claude = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const SIP_DOMAIN = process.env.SIP_DOMAIN || '1722.3cx.cloud';
const MAIN_NUMBER = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_PHONE || '';
const GREETING_AUDIO_FILE = process.env.GREETING_AUDIO_FILE || 'main-line-greeting.mp3';
const ASSETS_DIR = path.join(__dirname, 'assets');
const GREETING_AUDIO_PATH = path.join(ASSETS_DIR, GREETING_AUDIO_FILE);
const HAS_GREETING_AUDIO = fs.existsSync(GREETING_AUDIO_PATH);

app.use('/audio', express.static(ASSETS_DIR));

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

async function resolveDecision({ input = '', speech = '', dtmf = '' }) {
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

  twiml.dial().sip(`sip:${decision.extension}@${SIP_DOMAIN}`);

  res.type('text/xml').send(twiml.toString());
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

    console.log(`[route] input="${input || speech}" dtmf="${dtmf}" -> ${decision.extension}`);

    if (isJsonRoute) {
      return res.json(decision);
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

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ai-receptionist',
    host: HOST,
    port: PORT,
    greetingAudioLoaded: HAS_GREETING_AUDIO,
    greetingAudioFile: GREETING_AUDIO_FILE,
    time: new Date().toISOString()
  });
});

app.listen(PORT, HOST, () => {
  console.log(`[AI Receptionist] listening on ${HOST}:${PORT}`);
});
