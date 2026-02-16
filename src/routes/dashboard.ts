/**
 * Dashboard Route Handlers
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getSession } from '../utils/session';
import { isCampusPassEligible } from '../utils/ip';
import { getKeyName, findKeyByName } from '../openrouter';
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
  
  const keyName = getKeyName(session.email, c.env.KEY_NAME_TEMPLATE);
  const key = await findKeyByName(keyName, c.env);
  return c.html(dashboardPage(session, key, c.env.RECOMMENDED_MODEL));
});
