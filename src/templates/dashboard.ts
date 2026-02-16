/**
 * Dashboard Page Template
 */

import type { Session, UserKeyRow, OpenRouterKey } from '../types';
import { baseLayout, recommendedModelHint } from './layout';

export function dashboardPage(
  session: Session,
  row: UserKeyRow | null,
  orKey: OpenRouterKey | null,
  recommendedModel: string,
): string {
  const greeting = `Welcome, ${session.name || session.email}`;
  
  let keySection: string;
  
  if (row && orKey) {
    // Has active proxy key with a valid OR key behind it
    const remaining = orKey.limit_remaining?.toFixed(4) ?? 'N/A';
    
    keySection = `
      <div class="card" id="keyCard">
        <h3>Your API Key</h3>
        <div id="keyDisplaySlot"></div>
        <div class="stats">
          <div class="stat">
            <div class="stat-value">$${orKey.usage_daily.toFixed(4)}</div>
            <div class="stat-label">Today's Usage</div>
          </div>
          <div class="stat">
            <div class="stat-value">$${remaining}</div>
            <div class="stat-label">Remaining Today</div>
          </div>
          <div class="stat">
            <div class="stat-value">$${orKey.usage_monthly.toFixed(4)}</div>
            <div class="stat-label">This Month</div>
          </div>
        </div>
        <button class="btn btn-danger" style="margin-top: 1rem;" onclick="revokeKey()">Revoke Key</button>
      </div>
    `;
  } else {
    // No key yet
    keySection = `
      <div class="card" id="keySection">
        <h3>Get Your API Key</h3>
        <p>You don't have an API key yet. Create one to start using the BayLeaf API.</p>
        <button class="btn" onclick="createKey()">Create API Key</button>
      </div>
    `;
  }

  const usageGuide = (row && orKey) ? `
    <div class="card">
      <h3>Quick Start</h3>
      <p><strong>Endpoint URL:</strong></p>
      <div class="copy-box" onclick="copyToClipboard(this)">
        <code>https://api.bayleaf.chat/v1</code>
        <span class="copy-hint">Click to copy</span>
      </div>
      <p style="margin-top: 1rem;"><strong>Example request:</strong></p>
      <pre><code>curl https://api.bayleaf.chat/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${recommendedModel}",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'</code></pre>
      ${recommendedModelHint(recommendedModel)}
    </div>
  ` : '';

  const bayleafToken = row?.bayleaf_token || '';
  const scripts = `
    <script>
      const BAYLEAF_TOKEN = '${bayleafToken}';

      // Copy text to clipboard
      function copyToClipboard(el) {
        const code = el.querySelector('code');
        if (!code) return;
        const text = code.textContent;
        if (!navigator.clipboard) {
          const range = document.createRange();
          range.selectNodeContents(code);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          document.execCommand('copy');
          sel.removeAllRanges();
        } else {
          navigator.clipboard.writeText(text);
        }
        el.querySelector('.copy-hint').textContent = 'Copied!';
        setTimeout(() => {
          el.querySelector('.copy-hint').textContent = 'Click to copy';
        }, 1200);
      }

      function copyToken() {
        const input = document.getElementById('apiKey');
        navigator.clipboard.writeText(input.value);
        const btn = document.getElementById('copyBtn');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
      }
      
      function toggleKeyVisibility() {
        const input = document.getElementById('apiKey');
        const btn = document.getElementById('toggleBtn');
        if (input.type === 'password') {
          input.type = 'text';
          btn.textContent = 'Hide';
        } else {
          input.type = 'password';
          btn.textContent = 'Show';
        }
      }
      
      async function createKey() {
        const res = await fetch('/key', { method: 'POST' });
        const data = await res.json();
        if (res.ok && data.key) {
          sessionStorage.setItem('newKey', data.key);
          location.reload();
        } else {
          alert(data.error || 'Failed to create key');
        }
      }

      async function revokeKey() {
        if (!confirm('Revoke your API key? You can create a new one afterward.')) return;
        const res = await fetch('/key', { method: 'DELETE' });
        if (res.ok) {
          location.reload();
        } else {
          alert('Failed to revoke key');
        }
      }

      // On page load: show key display
      (function() {
        const newKey = sessionStorage.getItem('newKey');
        const displaySlot = document.getElementById('keyDisplaySlot');
        if (!displaySlot) return;

        if (newKey) {
          sessionStorage.removeItem('newKey');
          displaySlot.innerHTML = \`
            <div class="success" style="margin-bottom: 1rem;">
              <strong>Your new API key is ready.</strong>
              <p style="font-size: 0.9em; color: #155724; margin: 0.25rem 0 0 0;">Use the Copy button — the key is hidden to keep it safe during screen sharing.</p>
            </div>
            <div class="key-display" style="margin-bottom: 1rem;">
              <input type="password" value="\${newKey}" id="apiKey" readonly>
              <button class="btn copy-btn" id="copyBtn" onclick="copyToken()">Copy</button>
            </div>
          \`;
        } else if (BAYLEAF_TOKEN) {
          // Show masked token with reveal option
          displaySlot.innerHTML = \`
            <div class="key-display" style="margin-bottom: 1rem;">
              <input type="password" value="\${BAYLEAF_TOKEN}" id="apiKey" readonly>
              <button class="btn copy-btn" id="copyBtn" onclick="copyToken()">Copy</button>
              <button class="btn copy-btn" id="toggleBtn" onclick="toggleKeyVisibility()" style="right: 4rem;">Show</button>
            </div>
          \`;
        }
      })();
    </script>
  `;

  return baseLayout('Dashboard', `
    <p>${greeting} | <a href="/logout">Sign out</a></p>
    ${keySection}
    ${usageGuide}
    ${scripts}
  `);
}
