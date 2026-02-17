/**
 * OpenCode Integration Routes
 * 
 * Unauthenticated endpoints for OpenCode agent skill discovery:
 *   GET /recommended-model  — JSON with current recommended model slug
 *   GET /SKILL.md           — Dynamic SKILL.md for OpenCode agent skill
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { getModelName } from '../openrouter';

export const opencodeRoutes = new Hono<AppEnv>();

/** GET /recommended-model — return the current recommended model as JSON */
opencodeRoutes.get('/recommended-model', async (c) => {
  const model = c.env.RECOMMENDED_MODEL;
  const name = await getModelName(model);
  return c.json({ model, name: name ?? model });
});

/** GET /SKILL.md — dynamically generated SKILL.md for OpenCode */
opencodeRoutes.get('/SKILL.md', async (c) => {
  const model = c.env.RECOMMENDED_MODEL;
  const name = await getModelName(model) ?? model;
  const bt = '`';
  const fence = '```';

  const lines = [
    '---',
    'name: bayleaf-api',
    'description: Set up BayLeaf API (api.bayleaf.chat) as an OpenCode provider for free LLM access at UC Santa Cruz.',
    '---',
    '',
    '# BayLeaf API — OpenCode Provider Setup',
    '',
    'BayLeaf API provides free LLM inference for UC Santa Cruz students, faculty, and staff.',
    'This skill configures OpenCode to use BayLeaf as a custom provider.',
    '',
    '## Prerequisites',
    '',
    `- You need a UCSC Google account (${bt}@ucsc.edu${bt}).`,
    '- Visit <https://api.bayleaf.chat/> and sign in to provision your personal API key.',
    `- Copy your API key from the dashboard (it starts with ${bt}sk-bayleaf-${bt}).`,
    '',
    '## Setup Steps',
    '',
    '### 1. Add provider config',
    '',
    `Add the following to your ${bt}~/.config/opencode/opencode.json${bt} (create it if it doesn't exist).`,
    `If the file already exists, merge the ${bt}"bayleaf"${bt} key into the existing ${bt}"provider"${bt} object.`,
    '',
    `${fence}json`,
    '{',
    '  "$schema": "https://opencode.ai/config.json",',
    '  "provider": {',
    '    "bayleaf": {',
    '      "npm": "@ai-sdk/openai-compatible",',
    '      "name": "BayLeaf API",',
    '      "options": {',
    '        "baseURL": "https://api.bayleaf.chat/v1"',
    '      },',
    '      "models": {',
    `        "${model}": {`,
    `          "name": "${name}"`,
    '        }',
    '      }',
    '    }',
    '  }',
    '}',
    fence,
    '',
    '**Restart OpenCode** if you made any changes to the config file.',
    '',
    '### 2. Store the API key',
    '',
    `Run the ${bt}/connect${bt} command in OpenCode and select **BayLeaf API** (under the **Other** header).`,
    '',
    `Paste your ${bt}sk-bayleaf-...${bt} API key when prompted.`,
    '',
    '### 3. Select the model',
    '',
    `Run ${bt}/models${bt} in OpenCode and select ${bt}${model}${bt} under the BayLeaf API provider.`,
    '',
    '## Keeping Up to Date',
    '',
    'The recommended model changes over time. Fetch the latest from:',
    '',
    fence,
    'GET https://api.bayleaf.chat/recommended-model',
    fence,
    '',
    `This returns JSON like ${bt}{ "model": "${model}", "name": "${name}" }${bt}.`,
    `If the returned model is not already in your ${bt}opencode.json${bt},`,
    `add it to the ${bt}"models"${bt} object under ${bt}"bayleaf"${bt}.`,
    '',
    '## Notes',
    '',
    '- BayLeaf API is an OpenAI-compatible proxy backed by OpenRouter.',
    '- Each user gets a daily spending limit (currently $1/day).',
    '- All inference uses zero-data-retention endpoints — conversations are never used for training.',
    '- On the UCSC campus network, you can use the API without a key (Campus Pass).',
  ];

  return c.text(lines.join('\n'), 200, { 'Content-Type': 'text/markdown; charset=utf-8' });
});
