const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const twilio = require('twilio');

const app = express();
app.use(express.urlencoded({ extended: false }));

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const EXTENSIONS = {
  '17410': 'Patrick Sweeney, Publisher',
  '17413': 'Editorial Desk',
  '17414': 'Subscriptions',
  '17415': 'Advertising and Sales',
  '17416': 'Production'
};

async function getExtension(speech) {
  const msg = await claude.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 10,
    messages: [{ role: 'user', content:
      `Phone receptionist for Villager Media Group / Weekly Register-Call newspaper in Idaho Springs Colorado. Caller said: "${speech}". Reply with ONLY one 5-digit extension: 17410=Patrick/Publisher, 17413=Editorial/NewsTip, 17414=Subscriptions, 17415=Advertising/Sales, 17416=Production/Design. Default 17410.`
    }]
  });
  const m = msg.content[0].text.match(/1741[0-6]/);
  return m ? m[0] : '17410';
}

app.post('/voice', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const gather = twiml.gather({ input: 'speech', action: '/route', speechTimeout: 'auto', language: 'en-US' });
  gather.say({ voice: 'Polly.Joanna' }, 'Thank you for calling the Weekly Register-Call. Please say the name or department you are trying to reach — Patrick, Editorial, Subscribe, Advertise, or Production.');
  twiml.redirect('/voice');
  res.type('text/xml').send(twiml.toString());
});

app.post('/route', async (req, res) => {
  const speech = req.body.SpeechResult || '';
  const twiml = new twilio.twiml.VoiceResponse();
  console.log(`[route] "${speech}"`);
  try {
    const ext = await getExtension(speech);
    const name = EXTENSIONS[ext] || 'the publisher';
    console.log(`[route] -> ${ext}`);
    twiml.say({ voice: 'Polly.Joanna' }, `One moment, connecting you to ${name}.`);
    twiml.dial().sip(`sip:${ext}@1722.3cx.cloud`);
  } catch(e) {
    console.error(e.message);
    twiml.say({ voice: 'Polly.Joanna' }, 'Sorry, please hold while I connect you to our main line.');
    twiml.dial(process.env.TWILIO_PHONE_NUMBER);
  }
  res.type('text/xml').send(twiml.toString());
});

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.listen(process.env.PORT || 8787, '127.0.0.1', () => {
  console.log(`[AI Receptionist] listening on 127.0.0.1:${process.env.PORT || 8787}`);
});
