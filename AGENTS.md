# AGENTS.md - BayLeaf API

Guidelines for AI coding agents working in this repository.

## Project Overview

BayLeaf API is a Cloudflare Worker providing:
- OIDC authentication with UCSC Google accounts
- OpenRouter API key provisioning
- LLM inference proxy with system prompt injection
- Campus Pass (IP-based auth for on-campus users)

**Architecture**: Stateless single-file design (~1200 lines). No database - state managed via OpenRouter's API.

## Build & Development Commands

```bash
npm install            # Install dependencies
npm run dev            # Local development (Wrangler dev server)
npm run deploy         # Deploy to Cloudflare Workers
npm run tail           # View live logs from deployed worker
npx tsc --noEmit       # Type check (Wrangler handles transpilation)

# Set secrets
wrangler secret put OPENROUTER_PROVISIONING_KEY
wrangler secret put OIDC_CLIENT_ID
wrangler secret put OIDC_CLIENT_SECRET
wrangler secret put CAMPUS_POOL_KEY
```

## Testing

No test framework configured. Use manual testing via `npm run dev` and TypeScript strict mode (`npx tsc --noEmit`).

## Version Control

This repo uses **jj (Jujutsu)** with Git as the backend. The developer is learning jj and prefers using it over raw git commands.

Key jj concepts:
- **Working copy is a commit** - Changes are automatically tracked; no staging area
- **Bookmarks** - jj's equivalent of git branches (e.g., `main` bookmark tracks `main@origin`)
- **Revisions** - `@` is working copy, `@-` is parent, `main` is a bookmark

Common commands:
```bash
jj status             # Show working copy changes
jj log                # View commit graph
jj diff               # Show uncommitted changes
jj commit -m "msg"    # Commit and start new empty change
jj describe -m "msg"  # Edit current commit's message
jj squash             # Fold working copy into parent
jj new                # Start new change on top of current
jj bookmark list      # Show bookmarks and their positions
jj git push           # Push to GitHub
```

When committing, prefer jj commands. Explain jj concepts when relevant to help the developer learn.

## Code Style Guidelines

### File Organization

The entire application lives in `src/index.ts`, organized into clearly-marked sections:

```typescript
// =============================================================================
// Section Name
// =============================================================================
```

Sections (in order): Type Definitions, Constants, IP Range Utilities, Utility Functions, OpenRouter API Helpers, HTML Templates, Route Handlers, Main Router

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Interfaces | PascalCase | `Session`, `OpenRouterKey`, `Env` |
| Functions | camelCase | `getKeyName`, `createSessionToken` |
| Route handlers | `handle` prefix | `handleLogin`, `handleDashboard` |
| Top-level constants | SCREAMING_SNAKE_CASE | `GOOGLE_OIDC`, `SESSION_COOKIE` |
| Local constants | camelCase | `expiryDays`, `keyName` |

### TypeScript Patterns

```typescript
// Interfaces at top of file
interface Session {
  email: string;
  name: string;
  picture?: string;  // Optional with ?
  exp: number;
}

// Type assertions for JSON parsing
const result = await response.json() as { data: OpenRouterKey[] };

// Function parameters typed, return types often implicit
async function findKeyByName(name: string, env: Env): Promise<OpenRouterKey | null>
```

**Config**: `tsconfig.json` has `strict: true`. Honor all strict checks.

### Imports

No external runtime dependencies - only built-in Web APIs and Cloudflare Workers globals.

### Response Helpers

```typescript
function html(content: string, status = 200, headers: Record<string, string> = {}): Response
function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response
function redirect(url: string, headers: Record<string, string> = {}): Response
```

### Error Handling

```typescript
// Return null for failures, don't throw
if (!response.ok) {
  console.error('Failed to list keys:', await response.text());
  return null;
}

// Top-level try/catch in main router
try {
  // route handling
} catch (e) {
  console.error('Unhandled error:', e);
  return html(errorPage('Server Error', 'An unexpected error occurred.'), 500);
}

// Catch without binding when error details not needed
} catch {
  return null;
}
```

### JSDoc Comments

Use `/**` style for public/major functions. Keep brief:

```typescript
/** Check if an IP address is within a CIDR range. Supports IPv4 and IPv6. */
function isIPInCIDR(ip: string, cidr: string): boolean
```

### HTML Templates

Inline HTML via template literals. CSS and JS embedded in templates.

## Configuration Files

| File | Purpose |
|------|---------|
| `wrangler.jsonc` | Cloudflare Workers config (JSONC with comments) |
| `tsconfig.json` | TypeScript config (strict, ES2022, bundler resolution) |
| `package.json` | npm manifest (ES modules) |
| `.dev.vars` | Local secrets (gitignored) |

## Environment Variables

Set in `wrangler.jsonc` under `vars`:
- `SPENDING_LIMIT_DOLLARS`, `SPENDING_LIMIT_RESET`, `KEY_NAME_TEMPLATE`, `KEY_EXPIRY_DAYS`
- `ALLOWED_EMAIL_DOMAIN`, `SYSTEM_PROMPT_PREFIX`, `CAMPUS_IP_RANGES`, `CAMPUS_SYSTEM_PREFIX`

Secrets (via `wrangler secret put`):
- `OPENROUTER_PROVISIONING_KEY`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `CAMPUS_POOL_KEY`

## Key Patterns to Follow

1. **Single-file architecture** - Keep all code in `src/index.ts` for pedagogical clarity
2. **Stateless design** - No database; use external APIs for state
3. **Web standard APIs** - Use `fetch`, `crypto.subtle`, `Request`, `Response`
4. **Cookie-based sessions** - HMAC-signed tokens, no server-side storage
5. **Graceful degradation** - Return null/error responses rather than throwing

## Common Pitfalls

- **Don't add runtime dependencies** - Use only built-in APIs
- **Don't split into multiple files** - Single-file design is intentional
- **Don't use Node.js-specific APIs** - Must work in Cloudflare Workers runtime
- **Always handle null returns** - API helpers return null on failure
- **Preserve section comments** - Keep the `// ====` section markers

## API Route Structure

```
/                    GET    Landing page
/login               GET    Start OIDC flow
/callback            GET    OIDC callback
/logout              GET    Clear session
/dashboard           GET    User dashboard
/key                 GET    Get key info (JSON)
/key                 POST   Create new key (JSON)
/key                 DELETE Revoke key (JSON)
/v1/*                *      OpenRouter proxy
```
