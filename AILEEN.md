# Aileen web chat

Aileen runs as a server-side text agent alongside the existing Twilio routing
service. The phone routes are unchanged.

## Required configuration

Configure at least one provider key:

```dotenv
XAI_API_KEY=
# or OPENAI_API_KEY=
# or GEMINI_API_KEY=
# or ANTHROPIC_API_KEY=
```

Configure the sites allowed to embed the widget:

```dotenv
CHAT_ALLOWED_ORIGINS=https://conews.press,https://www.conews.press,https://weeklyregistercall.com,https://www.weeklyregistercall.com
```

Add verified organization facts as plain text. Aileen is instructed not to
invent missing prices, deadlines, policies, contacts, or staff availability.

```dotenv
AILEEN_KNOWLEDGE=Advertising: [verified public contact]. Subscriptions: [verified public contact]. Public notices: [verified public contact and deadline policy].
```

Optional:

```dotenv
XAI_MODEL=grok-4.5
OPENAI_MODEL=gpt-4o-mini
GEMINI_MODEL=gemini-2.5-flash
ANTHROPIC_MODEL=claude-haiku-4-5
CHAT_MAX_MESSAGE_LENGTH=1200
CHAT_MAX_HISTORY_ITEMS=12
CHAT_RATE_LIMIT=20
CHAT_RATE_WINDOW_MS=60000
MESSAGE_DELIVERY_ENABLED=false
```

## Test page

Open `/aileen-demo` on the deployed receptionist service.

## Embed

Place this before the closing `</body>` tag:

```html
<script
  src="https://YOUR-RECEPTIONIST-HOST/aileen/aileen-widget.js"
  data-endpoint="https://YOUR-RECEPTIONIST-HOST/chat"
  data-title="Aileen"
  data-accent="#a88a4a"
></script>
```

The system prompt and provider credentials remain on the server. Do not place
either one in the embed code.
