import { randomUUID } from 'node:crypto';
import { createSecretResolver, isOnePasswordRef, parseSecretRef, redactSecrets } from './secret-providers.mjs';

const VALID_ENV_VAR = /^[A-Z_][A-Z0-9_]{0,63}$/;
const BLOCKED_ENV_VARS = new Set([
  'PATH', 'HOME', 'SHELL', 'USER', 'LOGNAME', 'TMPDIR',
  'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'DYLD_FRAMEWORK_PATH',
  'LD_PRELOAD', 'LD_LIBRARY_PATH', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE',
  'GIT_INDEX_FILE', 'GIT_DIR', 'GIT_WORK_TREE',
]);

export class SecretRequestManager {
  #values = new Map();
  #requests = new Map();

  constructor({
    resolver = createSecretResolver(),
    ttlMs = 15 * 60_000,
    now = Date.now,
    id = randomUUID,
    onChange = () => {},
  } = {}) {
    Object.assign(this, { resolver, ttlMs, now, id, onChange });
  }

  #publicView(req) {
    return {
      id: req.id,
      session: req.session,
      envVar: req.envVar,
      reason: req.reason,
      suggestedRef: req.suggestedRef,
      status: req.status,
      source: req.source || '',
      refHandle: req.refHandle,
      createdAt: req.createdAt,
      expiresAt: req.expiresAt || null,
    };
  }

  request({ session, envVar, reason = '', suggestedRef = '' }) {
    if (!session || typeof session !== 'string') throw new Error('Invalid session.');
    const varName = String(envVar ?? '').trim();
    if (!VALID_ENV_VAR.test(varName) || BLOCKED_ENV_VARS.has(varName)) {
      throw new Error(`Environment variable name ${varName || '(empty)'} is not allowed.`);
    }
    const cleanReason = String(reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const cleanSuggested = String(suggestedRef ?? '').trim().slice(0, 512);
    const reqId = `sec-${this.id().slice(0, 12)}`;
    const record = {
      id: reqId,
      session,
      envVar: varName,
      reason: cleanReason,
      suggestedRef: cleanSuggested,
      status: 'pending',
      source: '',
      refHandle: `secret-ref:session/${varName}`,
      createdAt: this.now(),
      expiresAt: null,
    };
    this.#requests.set(reqId, record);
    const pub = this.#publicView(record);
    this.onChange({ session, requests: this.list(session) });
    return pub;
  }

  async resolve(id, { action = 'approve', secretRef = '', literalValue = '' } = {}) {
    const req = this.#requests.get(String(id ?? ''));
    if (!req) throw new Error('Secret request no longer exists.');
    const key = `${req.session}\u0000${req.envVar}`;
    if (action === 'deny') {
      req.status = 'denied';
      req.source = '';
      req.expiresAt = null;
      this.#values.delete(key);
      this.onChange({ session: req.session, requests: this.list(req.session) });
      return this.#publicView(req);
    }
    if (action !== 'approve') throw new Error('Choose approve or deny.');

    let resolvedValue = '';
    let source = '';
    const refInput = String(secretRef ?? '').trim();
    if (refInput) {
      const parsed = isOnePasswordRef(refInput)
        ? { provider: 'onepassword', reference: refInput }
        : parseSecretRef(refInput);
      if (!parsed) throw new Error('Invalid secret reference format.');
      const [val] = await this.resolver.read([parsed], { fresh: true });
      if (typeof val !== 'string' || !val.length) {
        throw new Error(`Could not resolve secret from ${parsed.provider}.`);
      }
      resolvedValue = val;
      source = parsed.provider;
    } else if (typeof literalValue === 'string' && literalValue.length > 0) {
      resolvedValue = literalValue;
      source = 'manual';
    } else {
      throw new Error('Provide a secret reference or value.');
    }

    const expiresAt = this.now() + this.ttlMs;
    req.status = 'approved';
    req.source = source;
    req.expiresAt = expiresAt;
    this.#values.set(key, { value: resolvedValue, source, expiresAt, envVar: req.envVar });
    this.onChange({ session: req.session, requests: this.list(req.session) });
    return this.#publicView(req);
  }

  revoke(session, envVar = '') {
    const targetVar = String(envVar ?? '').trim();
    let removed = 0;
    for (const [key, entry] of this.#values.entries()) {
      if (!key.startsWith(`${session}\u0000`)) continue;
      if (targetVar && entry.envVar !== targetVar) continue;
      this.#values.delete(key);
      removed++;
    }
    for (const req of this.#requests.values()) {
      if (req.session !== session) continue;
      if (targetVar && req.envVar !== targetVar) continue;
      if (req.status === 'pending' || req.status === 'approved') {
        req.status = 'revoked';
        req.expiresAt = null;
      }
    }
    this.onChange({ session, requests: this.list(session) });
    return removed;
  }

  list(session = '') {
    const current = this.now();
    const out = [];
    for (const req of this.#requests.values()) {
      if (session && req.session !== session) continue;
      if (req.status === 'approved' && req.expiresAt && current >= req.expiresAt) {
        req.status = 'expired';
        this.#values.delete(`${req.session}\u0000${req.envVar}`);
      }
      out.push(this.#publicView(req));
    }
    return out;
  }

  envForCommand(session, requestedVars = []) {
    const env = {};
    const secretValues = [];
    const current = this.now();
    const wanted = new Set(Array.isArray(requestedVars) ? requestedVars.map(v => String(v ?? '').trim()).filter(Boolean) : []);
    for (const [key, entry] of this.#values.entries()) {
      if (!key.startsWith(`${session}\u0000`)) continue;
      if (current >= entry.expiresAt) {
        this.#values.delete(key);
        continue;
      }
      if (!wanted.size || wanted.has(entry.envVar)) {
        env[entry.envVar] = entry.value;
        secretValues.push(entry.value);
      }
    }
    return { env, secretValues };
  }

  scrubOutput(text, secretValues = []) {
    return redactSecrets(text, secretValues);
  }
}
