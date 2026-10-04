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

## Remote on/off toggle

Aileen chat can be turned on or off at any time without redeploying, using a
protected admin endpoint. Set an admin token:

```dotenv
ADMIN_TOKEN=some-long-random-secret
```

Optional starting state. Chat is enabled unless this is `false`, `0`, `off` or
`no` (any capitalization):

```dotenv
AILEEN_CHAT_ENABLED=true
```

`AILEEN_CHAT_ENABLED` only applies until the first toggle call. After that,
the saved state in `data/aileen-state.json` always wins, including across
redeploys, so changing the env var alone will not change it. Use the admin
endpoint, or delete `data/aileen-state.json` on the server to fall back to the
env var.

Admin requests are limited to 10 per minute per IP (`ADMIN_RATE_LIMIT`,
`ADMIN_RATE_WINDOW_MS`).

Check current status:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://YOUR-RECEPTIONIST-HOST/admin/aileen
```

Turn off / on:

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"enabled": false}' https://YOUR-RECEPTIONIST-HOST/admin/aileen

curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"enabled": true}' https://YOUR-RECEPTIONIST-HOST/admin/aileen
```

While disabled, the widget hides its "Ask Aileen" button (it checks the
public `GET /chat/status` on page load), and `/chat` returns HTTP 503 without
calling any AI provider. The toggle state is written to
`data/aileen-state.json` (mounted as a volume in `docker-compose.yml`) so it
survives container restarts and redeploys. If the state can't be saved, the
toggle still takes effect immediately but the endpoint returns HTTP 500 with
`"persisted": false`, meaning it will be lost on the next restart; check that
`data/` on the host is writable. Without `ADMIN_TOKEN` configured, the admin
endpoint is disabled (HTTP 501). `/health` also reports the current state as
`aileenChatEnabled`.

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
