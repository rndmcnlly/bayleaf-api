# BayLeaf API

Cloudflare Worker built with **Hono**: OIDC auth (UCSC Google), OpenRouter key provisioning, LLM proxy with system prompt injection, Campus Pass (IP-based auth).

**Architecture**: Multi-file TypeScript under `src/`, stateless (no DB - state via OpenRouter API). Hono handles routing, CORS, and response helpers. Bundled by Wrangler.

## Commands

```bash
npm run dev      # Local dev
npm run deploy   # Deploy
npx tsc --noEmit # Type check
```

## File Structure

```
src/
  index.ts              Entry point: Hono app, cors middleware, route mounting, error handler
  types.ts              Bindings, Session, OpenRouterKey, AppEnv (Hono generics)
  constants.ts          GOOGLE_OIDC, OPENROUTER_API, cookie config
  openrouter.ts         OpenRouter API helpers (findKeyByName, createKey, deleteKey)
  utils/
    ip.ts               IP range parsing, campus pass checks
    session.ts          HMAC session tokens, cookie helpers
  templates/
    layout.ts           Base HTML layout, errorPage, recommendedModelHint
    landing.ts          Landing page template
    dashboard.ts        Dashboard page template (key management UI + client JS)
  routes/
    auth.ts             authRoutes: /login, /callback, /logout
    dashboard.ts        dashboardRoutes: /, /dashboard
    key.ts              keyRoutes: GET|POST|DELETE /key
    proxy.ts            proxyRoutes: /v1/* (mounted as sub-app)
```

## Code Style

**Naming**: Interfaces `PascalCase`, functions `camelCase`, top-level constants `SCREAMING_SNAKE`.

**Patterns**:
- Hono is the only runtime dependency; otherwise only Web APIs and CF Workers globals
- Route files export `Hono<AppEnv>` sub-apps, mounted via `app.route()` in index.ts
- Access bindings via `c.env`, use `c.html()`, `c.json()`, `c.redirect()` for responses
- Return `null` on failure, don't throw
- Type assertions for JSON: `await response.json() as { data: T[] }`
- `tsconfig.json` has `strict: true`
- Each file exports only what other files need
- Types live in `src/types.ts`; import with `import type` where possible

## Routes

```
/            Landing    /login      OIDC start    /callback   OIDC callback
/logout      Clear      /dashboard  User UI       /key        GET|POST|DELETE
/v1/*        Proxy
```

## Don'ts

- Don't add runtime dependencies (beyond hono)
- Don't use Node.js-specific APIs
- Don't throw - return null/error responses
