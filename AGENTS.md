# BayLeaf API

Cloudflare Worker: OIDC auth (UCSC Google), OpenRouter key provisioning, LLM proxy with system prompt injection, Campus Pass (IP-based auth).

**Architecture**: Multi-file TypeScript under `src/`, stateless (no DB - state via OpenRouter API). Bundled by Wrangler.

## Commands

```bash
npm run dev      # Local dev
npm run deploy   # Deploy
npx tsc --noEmit # Type check
```

## File Structure

```
src/
  index.ts              Entry point: main router (fetch handler + route dispatch)
  types.ts              Env, Session, OpenRouterKey interfaces
  constants.ts          GOOGLE_OIDC, OPENROUTER_API, cookie config
  openrouter.ts         OpenRouter API helpers (findKeyByName, createKey, deleteKey)
  utils/
    ip.ts               IP range parsing, campus pass checks
    session.ts          HMAC session tokens, cookie helpers
    response.ts         html(), json(), redirect() response helpers
  templates/
    layout.ts           Base HTML layout, errorPage, recommendedModelHint
    landing.ts          Landing page template
    dashboard.ts        Dashboard page template (key management UI + client JS)
  routes/
    auth.ts             handleLogin, handleCallback, handleLogout
    dashboard.ts        handleLanding, handleDashboard
    key.ts              handleGetKey, handleCreateKey, handleDeleteKey
    proxy.ts            handleApiProxy, handleCors
```

## Code Style

**Naming**: Interfaces `PascalCase`, functions `camelCase`, handlers `handleX`, top-level constants `SCREAMING_SNAKE`.

**Patterns**:
- No external runtime deps - only Web APIs and CF Workers globals
- Return `null` on failure, don't throw
- Type assertions for JSON: `await response.json() as { data: T[] }`
- `tsconfig.json` has `strict: true`
- Each file exports only what other files need
- Types live in `src/types.ts`; import with `import type` where possible

**Helpers**: `html()`, `json()`, `redirect()` in `src/utils/response.ts`.

## Routes

```
/            Landing    /login      OIDC start    /callback   OIDC callback
/logout      Clear      /dashboard  User UI       /key        GET|POST|DELETE
/v1/*        Proxy
```

## Don'ts

- Don't add runtime dependencies
- Don't use Node.js-specific APIs
- Don't throw - return null/error responses
