/**
 * BayLeaf API Type Definitions
 */

/** Cloudflare Worker bindings (env vars + secrets) */
export interface Bindings {
  // Public configuration
  SPENDING_LIMIT_DOLLARS: string;
  SPENDING_LIMIT_RESET: string;
  KEY_NAME_TEMPLATE: string;
  KEY_EXPIRY_DAYS: string;
  ALLOWED_EMAIL_DOMAIN: string;
  SYSTEM_PROMPT_PREFIX: string;
  RECOMMENDED_MODEL: string;       // Model slug shown in dashboard examples
  
  // Campus Pass configuration
  CAMPUS_IP_RANGES: string;        // Comma-separated CIDR ranges (e.g., "128.114.0.0/16,169.233.0.0/16")
  CAMPUS_SYSTEM_PREFIX: string;    // Additional system prompt prefix for campus mode
  
  // Secrets (set via wrangler secret put)
  OPENROUTER_PROVISIONING_KEY: string;
  OIDC_CLIENT_ID: string;
  OIDC_CLIENT_SECRET: string;
  CAMPUS_POOL_KEY: string;         // Shared OpenRouter key for campus access
}

export interface Session {
  email: string;
  name: string;
  picture?: string;
  exp: number;
}

export interface OpenRouterKey {
  hash: string;
  name: string;
  label: string;
  disabled: boolean;
  limit: number | null;
  limit_remaining: number | null;
  limit_reset: string | null;
  usage: number;
  usage_daily: number;
  usage_weekly: number;
  usage_monthly: number;
  created_at: string;
  updated_at: string | null;
  expires_at: string | null;
}

export interface OpenRouterKeyCreated extends OpenRouterKey {
  key: string; // The actual API key, only available at creation time
}

/** Hono context variables (set by middleware, read by handlers) */
export interface Variables {
  session: Session;
}

/** Hono app environment type */
export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
}
