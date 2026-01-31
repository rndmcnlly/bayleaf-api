# BayLeaf API

API key provisioning and LLM inference proxy for UC Santa Cruz, part of the [BayLeaf Chat](https://bayleaf.chat/about) platform.

## Features

- **OIDC Authentication**: Sign in with UCSC Google accounts
- **API Key Provisioning**: Automatic OpenRouter key management (one key per user)
- **Inference Proxy**: OpenAI-compatible endpoint with campus-specific system prompt injection
- **Self-Service Dashboard**: Create, view (statistics), and revoke API keys

## Architecture

This is a stateless Cloudflare Worker that:
1. Authenticates users via Google OIDC (restricted to `@ucsc.edu`)
2. Uses the OpenRouter Provisioning API to manage per-user API keys
3. Proxies `/api/v1/*` requests to OpenRouter, injecting a configurable system prompt prefix

No database required - all state is managed via OpenRouter's API (keys are identified by a name template including the user's authenticated email address).

## Deployment

### Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- Google Cloud project with OAuth 2.0 credentials
- OpenRouter account with Provisioning API key

### Setup

1. Clone and install dependencies:
   ```bash
   git clone https://github.com/rndmcnlly/bayleaf-api.git
   cd bayleaf-api
   npm install
   ```

2. Configure secrets:
   ```bash
   wrangler secret put OPENROUTER_PROVISIONING_KEY
   wrangler secret put OIDC_CLIENT_ID
   wrangler secret put OIDC_CLIENT_SECRET
   ```

3. Update `wrangler.jsonc` with your configuration (non-secret values)

4. Deploy:
   ```bash
   npm run deploy
   ```

5. **Important**: After deployment is working, disable observability in `wrangler.jsonc` to avoid data accumulation:
   ```jsonc
   "observability": {
     "enabled": false
   }
   ```

### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create OAuth 2.0 credentials (Web application)
3. Add authorized redirect URI: `https://api.bayleaf.chat/callback`
4. Set the OIDC client ID and secret as Cloudflare secrets

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `SPENDING_LIMIT_DOLLARS` | Daily spending limit per user | `1.0` |
| `SPENDING_LIMIT_RESET` | Limit reset period | `daily` |
| `KEY_NAME_TEMPLATE` | Template for key names (`$email` replaced) | `BayLeaf API for $email` |
| `KEY_EXPIRY_DAYS` | Days until keys expire | `30` |
| `ALLOWED_EMAIL_DOMAIN` | Restrict to this email domain | `ucsc.edu` |
| `SYSTEM_PROMPT_PREFIX` | Prefix injected into all chat requests | `You are an AI assistant...` |

### Secrets

| Secret | Description |
|--------|-------------|
| `OPENROUTER_PROVISIONING_KEY` | OpenRouter provisioning API key |
| `OIDC_CLIENT_ID` | Google OAuth client ID |
| `OIDC_CLIENT_SECRET` | Google OAuth client secret |

## API Endpoints

### User-Facing

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Landing page |
| `/login` | GET | Start OIDC flow |
| `/callback` | GET | OIDC callback |
| `/logout` | GET | Clear session |
| `/dashboard` | GET | Main user interface |
| `/key` | GET | Get current key info (JSON) |
| `/key` | POST | Create new key (returns key in JSON) |
| `/key` | DELETE | Revoke current key |

### Inference Proxy

| Endpoint | Description |
|----------|-------------|
| `/api/v1/chat/completions` | Chat completions (system prompt injected) |
| `/api/v1/completions` | Text completions |
| `/api/v1/models` | List available models |
| `/api/v1/*` | All other OpenRouter endpoints |

## License

MIT License - see [LICENSE](LICENSE)

## Links

- [BayLeaf Chat](https://bayleaf.chat/about)
- [OpenRouter](https://openrouter.ai/)
- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
