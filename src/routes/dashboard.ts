/**
 * Dashboard Route Handlers
 */

import { Hono } from 'hono';
import type { AppEnv, UserKeyRow, OpenRouterKey } from '../types';
import { getSession } from '../utils/session';
import { isCampusPassEligible } from '../utils/ip';
import { getKeyName, findKeyByHash, createKey } from '../openrouter';
import { landingPage } from '../templates/landing';
import { dashboardPage } from '../templates/dashboard';

export const dashboardRoutes = new Hono<AppEnv>();

/** GET / - Landing page (redirects to dashboard if logged in) */
dashboardRoutes.get('/', async (c) => {
  const session = await getSession(c);
  if (session) return c.redirect('/dashboard');
  return c.html(landingPage(isCampusPassEligible(c.req.raw, c.env), c.env.RECOMMENDED_MODEL));
});

/** GET /dashboard - Main user interface */
dashboardRoutes.get('/dashboard', async (c) => {
  const session = await getSession(c);
  if (!session) return c.redirect('/login');

  // Look up the user's proxy key mapping in D1
  const row = await c.env.DB.prepare(
    'SELECT * FROM user_keys WHERE email = ? AND revoked = 0',
  ).bind(session.email).first<UserKeyRow>();

  let orKey: OpenRouterKey | null = null;

  if (row) {
    // Validate the OR key is still alive
    orKey = await findKeyByHash(row.or_key_hash, c.env);

    if (!orKey || orKey.disabled) {
      // Self-heal: provision a new OR key, keep the same bayleaf token
      const keyName = getKeyName(session.email, c.env.KEY_NAME_TEMPLATE);
      const newOrKey = await createKey(keyName, c.env);
      if (newOrKey?.key) {
        await c.env.DB.prepare(
          'UPDATE user_keys SET or_key_hash = ?, or_key_secret = ? WHERE email = ?',
        ).bind(newOrKey.hash, newOrKey.key, session.email).run();
        orKey = newOrKey;
      }
    }
  }

  return c.html(dashboardPage(session, row, orKey, c.env.RECOMMENDED_MODEL));
});
