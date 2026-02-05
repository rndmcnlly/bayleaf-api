# BayLeaf API

Cloudflare Worker: OIDC auth (UCSC Google), OpenRouter key provisioning, LLM proxy with system prompt injection, Campus Pass (IP-based auth).

**Architecture**: Single-file (`src/index.ts`, ~1200 lines), stateless (no DB - state via OpenRouter API).

## Commands

```bash
npm run dev      # Local dev
npm run deploy   # Deploy
npx tsc --noEmit # Type check
```

## Code Style

All code in `src/index.ts` with `// ====` section markers. Sections: Type Definitions, Constants, IP Range Utilities, Utility Functions, OpenRouter API Helpers, HTML Templates, Route Handlers, Main Router.

**Naming**: Interfaces `PascalCase`, functions `camelCase`, handlers `handleX`, top-level constants `SCREAMING_SNAKE`.

**Patterns**:
- No external runtime deps - only Web APIs and CF Workers globals
- Return `null` on failure, don't throw
- Type assertions for JSON: `await response.json() as { data: T[] }`
- `tsconfig.json` has `strict: true`

**Helpers**: `html()`, `json()`, `redirect()` for responses.

## Routes

```
/            Landing    /login      OIDC start    /callback   OIDC callback
/logout      Clear      /dashboard  User UI       /key        GET|POST|DELETE
/v1/*        Proxy
```

## Don'ts

- Don't add runtime dependencies
- Don't split into multiple files
- Don't use Node.js-specific APIs
- Don't throw - return null/error responses
- Don't remove `// ====` section markers
