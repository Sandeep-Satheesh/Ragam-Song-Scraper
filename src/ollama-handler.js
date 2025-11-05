// src/ollama-handler.js
// Encapsulates all Ollama interactions.
// Exports: runOllamaModel(model, prompt, timeoutMs)
// and extractJsonFromOutput(text)

const { spawn } = require('child_process');

let ollamaClient = null;
try {
  // prefer official client if installed
  // eslint-disable-next-line import/no-extraneous-dependencies
  const { Ollama } = require('ollama');
  ollamaClient = new Ollama();
} catch (e) {
  try {
    // alternate package name
    // eslint-disable-next-line import/no-extraneous-dependencies
    const Ollama = require('ollama-js');
    ollamaClient = new Ollama();
  } catch (e2) {
    ollamaClient = null;
  }
}

function getMaxTokensForModel(modelId) {
  const id = (modelId || '').toLowerCase();
  if (id.includes('20b') || id.includes('qwen-20') || id.includes('mistral') || id.includes('mixtral')) return 8192;
  if (id.includes('32k') || id.includes('qwen3') || id.includes('gemma') || id.includes('qwen-32')) return 32768;
  if (id.includes('120b') || id.includes(':120b') || id.includes('gpt-oss:120b')) return 32768;
  if (id.includes('480b') || id.includes('qwen3-coder:480b')) return 65536;
  if (id.includes('671b') || id.includes('deepseek-v3') || id.includes('671')) return 65536;
  return 8192;
}

async function runOllamaModelViaClient(model, prompt, timeoutMs = 600000) {
  if (!ollamaClient) throw new Error('ollama-js client not available');

  const maxTokens = getMaxTokensForModel(model);
  // base payload; we keep temperature/top_p explicit
  const base = { model, prompt, temperature: 0, top_p: 1 };

  // prefer high-control chat if available
  if (typeof ollamaClient.chat === 'function') {
    const messages = [
      { role: 'system', content: 'Return EXACTLY one JSON array and nothing else. Do not output extra commentary.' },
      { role: 'user', content: prompt }
    ];
    const chatPayload = {
      model,
      messages,
      options: { temperature: 0, top_p: 1, max_tokens: maxTokens }
    };
    const res = await ollamaClient.chat(chatPayload);
    // normalize shapes
    return res.message.content;
  }

  // next preference: run / generate / create style APIs
  if (typeof ollamaClient.run === 'function') {
    const payload = Object.assign({}, base, { max_tokens: maxTokens, num_predict: maxTokens });
    const res = await ollamaClient.run(payload);
    return res?.toString?.() || String(res);
  }

  if (typeof ollamaClient.generate === 'function') {
    const payload = Object.assign({}, base, { max_tokens: maxTokens });
    const res = await ollamaClient.generate(payload);
    if (res && typeof res === 'object') {
      if (res.output) return res.output.toString();
      if (res.choices && res.choices[0]) return res.choices[0].text || JSON.stringify(res.choices[0]);
    }
    return null;
  }

  throw new Error('Unsupported ollama client interface');
}

function runOllamaModelViaCli(model, prompt, timeoutMs = 600000) {
  const maxTokens = getMaxTokensForModel(model);
  return new Promise((resolve, reject) => {
    const ollamaPath = process.env.OLLAMA_PATH || 'ollama';
    const args = ['run', model, '--num-predict', String(maxTokens), '--max-tokens', String(maxTokens)];
    const proc = spawn(ollamaPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('OLLAMA timeout')); }, timeoutMs);
    proc.stdout.on('data', d => out += d.toString());
    proc.stderr.on('data', d => err += d.toString());
    proc.on('error', e => { clearTimeout(timer); reject(e); });
    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 && !out) return reject(new Error('ollama exited ' + code + ' ' + err));
      resolve(out.trim());
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

async function runOllamaModel(model, prompt, timeoutMs = 600000) {
  try {
    if (ollamaClient) {
      return await runOllamaModelViaClient(model, prompt, timeoutMs);
    }
  } catch (e) {
    // fall back to CLI
    console.warn('ollama-js client call failed, falling back to CLI:', e && e.message ? e.message : e);
  }
  return await runOllamaModelViaCli(model, prompt, timeoutMs);
}

function extractJsonFromOutput(text) {
  if (!text) return null;
  const startArr = text.indexOf('[');
  const startObj = text.indexOf('{');
  const s = (startArr === -1 || (startObj !== -1 && startObj < startArr)) ? startObj : startArr;
  if (s === -1) return null;
  const candidate = text.slice(s);
  try { return JSON.parse(candidate); }
  catch {
    const last = Math.max(candidate.lastIndexOf(']'), candidate.lastIndexOf('}'));
    if (last !== -1) {
      try { return JSON.parse(candidate.slice(0, last + 1)); } catch { }
    }
    return null;
  }
}

module.exports = { runOllamaModel, extractJsonFromOutput };
