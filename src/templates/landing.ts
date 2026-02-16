/**
 * Landing Page Template
 */

import { baseLayout, recommendedModelHint } from './layout';

export function landingPage(showCampusPass: boolean, recommendedModel: string): string {
  const campusPassSection = showCampusPass ? `
    <div class="card" style="background: #e8f4e8; border-color: #28a745;">
      <h3>Campus Pass Available</h3>
      <p>You're on the UCSC network! You can use the API right now without signing in.</p>
      <p>Just point any OpenAI-compatible client at:</p>
      <pre><code>https://api.bayleaf.chat/v1</code></pre>
      <p>No API key needed, or use <code>campus</code> as your key.</p>
      ${recommendedModelHint(recommendedModel)}
    </div>
  ` : '';

  return baseLayout('Welcome', `
    <div class="card">
      <h2>API Access for UCSC</h2>
      <p>Free LLM inference for UC Santa Cruz students, faculty, and staff.</p>
      <p><a href="/login" class="btn">Sign in with UCSC Google</a></p>
    </div>
    ${campusPassSection}
  `);
}
