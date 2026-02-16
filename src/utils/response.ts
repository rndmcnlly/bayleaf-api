/**
 * HTTP Response Helpers
 */

/**
 * HTML response helper
 */
export function html(content: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(content, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...headers,
    },
  });
}

/**
 * JSON response helper
 */
export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

/**
 * Redirect response helper
 */
export function redirect(url: string, headers: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      ...headers,
    },
  });
}
