/**
 * Dashboard Page Template
 */

import type { Session, OpenRouterKey } from '../types';
import { baseLayout, recommendedModelHint } from './layout';

export function dashboardPage(session: Session, key: OpenRouterKey | null, recommendedModel: string): string {
  const greeting = `Welcome, ${session.name || session.email}`;
  
  let keySection: string;
  
  if (key) {
    // Has existing key
    const remaining = key.limit_remaining?.toFixed(4) ?? 'N/A';
    const expiresAt = key.expires_at ? new Date(key.expires_at).toLocaleDateString() : 'Never';
    
    keySection = `
      <div class="card" id="keyCard">
        <h3>Your API Key</h3>
        <p>Key ID: <code>${key.label}</code></p>
        <div id="keyRecoverySlot" style="margin: 1rem 0;"></div>
        <p>Expires: ${expiresAt}</p>
        <div class="stats">
          <div class="stat">
            <div class="stat-value">$${key.usage_daily.toFixed(4)}</div>
            <div class="stat-label">Today's Usage</div>
          </div>
          <div class="stat">
            <div class="stat-value">$${remaining}</div>
            <div class="stat-label">Remaining Today</div>
          </div>
          <div class="stat">
            <div class="stat-value">$${key.usage_monthly.toFixed(4)}</div>
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

  const usageGuide = key ? `
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

  const keyHash = key?.hash || '';
  const scripts = `
    <script>
      const KEY_HASH = '${keyHash}';
      const STORAGE_KEY = 'bayleaf-keys';
      // Copy endpoint URL to clipboard
      function copyToClipboard(el) {
        const code = el.querySelector('code');
        if (!code) return;
        const text = code.textContent;
        if (!navigator.clipboard) {
          // fallback for older browsers
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
      
      // localStorage helpers
      function getStoredKeys() {
        try {
          return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        } catch { return {}; }
      }
      
      function saveKeyToStorage(hash, key) {
        try {
          const keys = getStoredKeys();
          keys[hash] = key;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
          return true;
        } catch (e) {
          console.warn('Failed to save key to localStorage:', e);
          return false;
        }
      }
      
      function getKeyFromStorage(hash) {
        const keys = getStoredKeys();
        return keys[hash] || null;
      }
      
      function removeKeyFromStorage(hash) {
        try {
          const keys = getStoredKeys();
          delete keys[hash];
          localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
        } catch (e) {
          console.warn('Failed to remove key from localStorage:', e);
        }
      }
      
      function copyKey() {
        const input = document.getElementById('apiKey');
        input.type = 'text';
        input.select();
        document.execCommand('copy');
        input.type = 'password';
        alert('Copied to clipboard!');
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
        if (res.ok && data.key && data.hash) {
          // Save key to localStorage for future recovery
          const saved = saveKeyToStorage(data.hash, data.key);
          // Store key temporarily for display, reload to get full view from OR
          sessionStorage.setItem('newKey', data.key);
          sessionStorage.setItem('newKeyHash', data.hash);
          sessionStorage.setItem('newKeySaved', saved ? 'true' : 'false');
          location.reload();
        } else {
          alert(data.error || 'Failed to create key');
        }
      }
      
      function forgetKey() {
        if (!confirm('Forget this key from your browser?\\n\\nThe key will still work, but you won\\'t be able to see it again on this device.')) return;
        removeKeyFromStorage(KEY_HASH);
        location.reload();
      }
      
      // Check for newly created key on page load
      (function() {
        const newKey = sessionStorage.getItem('newKey');
        const newKeyHash = sessionStorage.getItem('newKeyHash');
        const newKeySaved = sessionStorage.getItem('newKeySaved');
        if (newKey) {
          sessionStorage.removeItem('newKey');
          sessionStorage.removeItem('newKeyHash');
          sessionStorage.removeItem('newKeySaved');
          const keyCard = document.getElementById('keyCard');
          if (keyCard) {
            const savedNote = newKeySaved === 'true' 
              ? '<p style="color: #155724; font-size: 0.9em;">This key has been saved in your browser for future recovery.</p>'
              : '<p style="color: #856404; font-size: 0.9em;">Unable to save key in browser - make sure to copy it now.</p>';
            keyCard.insertAdjacentHTML('afterbegin', \`
              <div class="success" style="margin-bottom: 1rem;">
                <strong>Your new API key has been created!</strong>
                \${savedNote}
              </div>
              <div class="key-display" style="margin-bottom: 1rem;">
                <input type="password" value="\${newKey}" id="apiKey" readonly>
                <button class="btn copy-btn" onclick="copyKey()">Copy</button>
              </div>
            \`);
          }
        } else if (KEY_HASH) {
          // Check if we have the key stored in localStorage
          const storedKey = getKeyFromStorage(KEY_HASH);
          const keyCard = document.getElementById('keyCard');
          const keyRecoverySlot = document.getElementById('keyRecoverySlot');
          if (storedKey && keyRecoverySlot) {
            keyRecoverySlot.innerHTML = \`
              <div class="key-display" style="margin-bottom: 0.5rem;">
                <input type="password" value="\${storedKey}" id="apiKey" readonly>
                <button class="btn copy-btn" onclick="copyKey()">Copy</button>
                <button class="btn copy-btn" id="toggleBtn" onclick="toggleKeyVisibility()" style="right: 4rem;">Show</button>
              </div>
              <p style="font-size: 0.85em; color: #666; margin: 0.5rem 0 0 0;">
                Saved in this browser · <a href="#" onclick="forgetKey(); return false;">Forget</a>
              </p>
            \`;
          } else if (keyRecoverySlot) {
            keyRecoverySlot.innerHTML = \`
              <p style="font-size: 0.9em; color: #666; margin: 0;">
                Full key not available (created on a different device or browser)
              </p>
            \`;
          }
        }
      })();
      
      async function revokeKey() {
        if (!confirm('Are you sure? You will need to create a new key.')) return;
        const res = await fetch('/key', { method: 'DELETE' });
        if (res.ok) {
          // Clear from localStorage too
          removeKeyFromStorage(KEY_HASH);
          location.reload();
        } else {
          alert('Failed to revoke key');
        }
      }
    </script>
  `;

  return baseLayout('Dashboard', `
    <p>${greeting} | <a href="/logout">Sign out</a></p>
    ${keySection}
    ${usageGuide}
    ${scripts}
  `);
}
