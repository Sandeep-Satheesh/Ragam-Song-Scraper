const { spawn, spawnSync } = require('child_process');

let ollamaClient = null;
try {
  // prefer official client if installed
  // eslint-disable-next-line import/no-extraneous-dependencies
  const { Ollama } = require('ollama');
  ollamaClient = new Ollama();
} catch (e) {
  try {
    const Ollama = require('ollama-js');
    ollamaClient = new Ollama();
  } catch (e2) {
    ollamaClient = null;
  }
}

// Heuristic capacities by model name
async function getMaxTokensForModel(modelId) {
  const id = String(modelId).toLowerCase();
  try {
    const info = await ollamaClient.show({ model: id });

    if (info && info.model_info && info.details && info.details.family) {
      //console.info('Model info for', id, info);
      
      let family = info.details.family;
      let contextLengthKeyName = family + '.' + 'context_length';

      if (Number.isInteger(info.model_info[contextLengthKeyName])) {
        return info.model_info[contextLengthKeyName];
      }
      else throw new Error('context length not found. info =' + JSON.stringify(info));
    }
    else throw new Error('context length not found. info =' + JSON.stringify(info));

  } catch (e) {
    console.warn('could not determine context window size for model:', id, e && e.message ? e.message : e);
  }

  if (!modelId) return 8192;

  // explicit known mappings (power-of-two token counts)
  if (id.includes('gpt-oss:120b') || id.includes('gpt-oss-120b') || id.includes('gpt-oss:120')) return 131072; // 128k
  if (id.includes('gpt-oss:20b') || id.includes('gpt-oss-20b') || id.includes('gpt-oss:20')) return 131072; // 128k (open-weight 20b supports large context)
  if (id.includes('qwen3-coder:480b') || id.includes('qwen3-coder') || id.includes('qwen3-coder:480b-cloud')) return 262144; // 256k
  if (id.includes('gemma3:4b') || id.includes('gemma3-4b') || id.includes('gemma3:27b') || id.includes('gemma3:12b') ) return 131072; // 128k (large Gemma3 variants)
  if (id.includes('gemma3:1b') || id.includes('gemma3-1b') || id.includes('gemma3:270m')) return 32768; // 32k for smaller Gemma3 variants
  if (id.includes('deepseek-r1') || id.includes('deepseek-r1:') || id.includes('deepseek-r1') ) return 32768; // DeepSeek-R1 uses 32k max gen (per model card)
  if (id.includes('mistral') || id.includes('mistral:latest') || id.includes('mistral-7b')) return 16384; // 16k sliding-window / practical limit
  if (id.includes('20b') && id.includes('gpt-oss') ) return 131072; // catch-alls for gpt-oss 20b
  if (id.includes(':480b') || id.includes('480b')) return 262144; // generic 480b -> 256k
  if (id.includes('671b') || id.includes('deepseek-671') || id.includes('671')) return 163840; // some DeepSeek 671B variants advertise ~160k native (use with caution)

  // conservative default
  return 8192;
}


// Conservative token estimator: 1 token ~= 4 chars
function estimateTokensFromText(prompt) {
  if (!prompt) return 0;
  const chars = String(prompt.system + prompt.user).length;
  return Math.ceil(chars / 4);
}

// Compute safe response token budget given model capacity and prompt size.
// Strategy:
//  - remaining = modelCap - promptTokens
//  - safetyBuffer = max( absoluteSafety, ceil(modelCap * safetyPct) )
//  - responseTokens = clamp(remaining - safetyBuffer, minResponse, modelCap)
function computeResponseBudget(modelCap, promptTokens, opts = {}) {
  const absoluteSafety = Number.isInteger(opts.absoluteSafety) ? opts.absoluteSafety : 256;
  const safetyPct = typeof opts.safetyPct === 'number' ? opts.safetyPct : 0.02; // 2% of model cap
  const minResponse = Number.isInteger(opts.minResponse) ? opts.minResponse : 2;

  const safetyBuffer = Math.max(absoluteSafety, Math.ceil(modelCap * safetyPct));
  const remaining = modelCap - promptTokens;
  const raw = remaining - safetyBuffer;
  const responseTokens = Math.max(minResponse, Math.floor(Math.max(0, raw)));
  // never exceed modelCap
  return Math.min(responseTokens, modelCap);
}

// Choose smallest model that can hold prompt + safetyBuffer + minResponse
async function chooseBestModelForPrompt(availableModels, prompt, opts = {}) {
  const promptTokens = estimateTokensFromText(prompt);
  const absoluteSafety = Number.isInteger(opts.absoluteSafety) ? opts.absoluteSafety : 256;
  const safetyPct = typeof opts.safetyPct === 'number' ? opts.safetyPct : 0.02;
  const minResponse = Number.isInteger(opts.minResponse) ? opts.minResponse : 2;

  const capacities = (await Promise.allSettled(availableModels.map(async (m) => ({ name: m, cap: await getMaxTokensForModel(m) })))).map(r => {
    if (r.status === 'fulfilled') return r.value;
    return null;
  }).filter(Boolean);
  capacities.sort((a, b) => a.cap - b.cap);

  for (const c of capacities) {
    const safetyBuffer = Math.max(absoluteSafety, Math.ceil(c.cap * safetyPct));
    if (c.cap >= promptTokens + safetyBuffer + minResponse) return c.name;
  }
  // none fit, return largest
  return capacities.length ? capacities[capacities.length - 1].name : null;
}

// --- Available models discovery ---
async function getAvailableModels() {
  try {
    if (ollamaClient && typeof ollamaClient.list === 'function') {
      const res = await ollamaClient.list();
      if (Array.isArray(res)) return res.map(r => (r && r.name) ? r.name : String(r));
      if (Array.isArray(res.models)) return res.models.map(r => (r && r.name) ? r.name : String(r));
      if (res && typeof res === 'object') return Object.keys(res);
    }
  } catch (e) {
    console.warn('ollama-js client list() failed, falling back to CLI:', e && e.message ? e.message : e);
  }

  try {
    const ollamaPath = process.env.OLLAMA_PATH || 'ollama';
    const j = spawnSync(ollamaPath, ['list', '--json'], { encoding: 'utf8' });
    if (j.status === 0 && j.stdout) {
      try {
        const parsed = JSON.parse(j.stdout);
        if (Array.isArray(parsed)) return parsed.map(p => p.name || String(p));
      } catch (e) { /* ignore */ }
    }
    const p = spawnSync(ollamaPath, ['list'], { encoding: 'utf8' });
    if (p.status === 0 && p.stdout) {
      const lines = p.stdout.split('\n').map(l => l.trim()).filter(Boolean);
      return lines.map(line => {
        const parts = line.split(/\s+/);
        return parts[0];
      });
    }
  } catch (e) {
    console.warn('ollama CLI list failed:', e && e.message ? e.message : e);
  }
  return [];
}

// --- run via client ---
async function runOllamaModelViaClient(model, prompt, responseTokens, timeoutMs = 600000) {
  if (!ollamaClient) throw new Error('ollama-js client not available');

  const maxTokens = responseTokens;
  const base = { model, prompt, temperature: 0, top_p: 1 };

  if (typeof ollamaClient.chat === 'function') {
    const messages = [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user }
    ];
    const chatPayload = {
      model,
      messages,
      options: { temperature: 0, top_p: 1, max_tokens: maxTokens }
    };
    const res = await ollamaClient.chat(chatPayload);
    return { content: res.message.content, thinking: res.message.thinking || null };
  }

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

// --- run via CLI ---
function runOllamaModelViaCli(model, prompt, responseTokens, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const maxTokens = responseTokens;
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
    proc.stdin.write(prompt.system + '\n' + prompt.user);
    proc.stdin.end();
  });
}

// --- Public run: accept only prompt, pick optimal model, compute dynamic response budget, then run ---
async function runOllamaModel(prompt, timeoutMs = 600000) {
  if (!prompt) throw new Error('prompt required');

  let available = await getAvailableModels();
  if (!available || available.length === 0) throw new Error('No ollama models available');
  
  const promptTokens = estimateTokensFromText(prompt);

  // pick a model that can hold prompt + safety + minimal response
  const pickedModel = await chooseBestModelForPrompt(available, prompt, { absoluteSafety: 256, safetyPct: 0.02, minResponse: 2 }) || available[0];
  const modelCap = await getMaxTokensForModel(pickedModel);

  // compute responseTokens to use as the model's max output (use remaining capacity minus safety)
  const responseTokens = computeResponseBudget(modelCap, promptTokens, { absoluteSafety: 256, safetyPct: 0.02, minResponse: 2 });

  console.info(`Using model "${pickedModel}" (cap: ${modelCap} tokens) for prompt (${promptTokens} tokens). Allocated response tokens: ${responseTokens}.`);

  // If remaining capacity is non-positive, warn and still proceed with minimal responseTokens
  if (modelCap - promptTokens <= 0) {
    console.warn(`prompt tokens (${promptTokens}) exceed or equal model capacity (${modelCap}). Truncation likely.`);
  }

  try {
    if (ollamaClient) {
      return { ...await runOllamaModelViaClient(pickedModel, prompt, responseTokens, timeoutMs), model_name: pickedModel };
    }
  } catch (e) {
    console.warn('ollama-js client call failed, falling back to CLI:', e && e.message ? e.message : e);
  }
  return { ...await runOllamaModelViaClient(pickedModel, prompt, responseTokens, timeoutMs), model_name: pickedModel };
}

module.exports = {
  runOllamaModel,
  getAvailableModels
};
