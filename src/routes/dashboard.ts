/**
 * Dashboard Route Handler
 */

import type { Env } from '../types';
import { getSession } from '../utils/session';
import { html, redirect } from '../utils/response';
import { isCampusPassEligible } from '../utils/ip';
import { getKeyName, findKeyByName } from '../openrouter';
import { landingPage } from '../templates/landing';
import { dashboardPage } from '../templates/dashboard';

/**
 * GET / - Landing page
 */
export async function handleLanding(request: Request, env: Env): Promise<Response> {
  const session = await getSession(request, env);
  if (session) {
    return redirect('/dashboard');
  }
  
  return html(landingPage(isCampusPassEligible(request, env), env.RECOMMENDED_MODEL));
}

/**
 * GET /dashboard - Main user interface
 */
export async function handleDashboard(request: Request, env: Env): Promise<Response> {
  const session = await getSession(request, env);
  if (!session) {
    return redirect('/login');
  }
  
  const keyName = getKeyName(session.email, env.KEY_NAME_TEMPLATE);
  const key = await findKeyByName(keyName, env);
  
  return html(dashboardPage(session, key, env.RECOMMENDED_MODEL));
}
