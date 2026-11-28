import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandPath } from './work-sandbox.mjs';

const SECRET_PROVIDER_SLUG = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const ONE_PASSWORD_REF = /^op:\/\/[^/\r\n]+\/[^/\r\n]+(?:\/[^/\r\n]+)+$/;

export interface SecretRef {
  provider: string;
  reference: string;
}

export interface SecretExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type SecretExecFn = (
  binary: string,
  args: string[],
  options?: { timeoutMs?: number },
) => Promise<SecretExecResult>;

export interface OnePasswordDriverOptions {
  exec?: SecretExecFn;
  timeoutMs?: number;
}

export interface OnePasswordDriverConfig {
  account?: string;
  [key: string]: unknown;
}

export interface SecretDriver<TConfig = Record<string, unknown>> {
  kind: string;
  isReference: (reference: unknown) => boolean;
  read: (config?: TConfig, references?: readonly string[]) => Promise<(string | undefined)[]>;
}

export interface SecretProviderEntry {
  kind?: string;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

export type SecretProvidersMap = Record<string, SecretProviderEntry | undefined>;

export interface SecretResolverOptions {
  drivers?: readonly SecretDriver<any>[];
  getProviders?: () => SecretProvidersMap | null | undefined | Promise<SecretProvidersMap | null | undefined>;
}

export interface SecretReadOptions {
  fresh?: boolean;
}

export interface SecretResolver {
  read: (references?: readonly SecretRef[], options?: SecretReadOptions) => Promise<(string | undefined)[]>;
  invalidate: (references?: readonly SecretRef[]) => void;
}

interface ResolvedPlan {
  driver: SecretDriver<any>;
  config: Record<string, unknown>;
  configKey: string;
}

interface CacheEntry {
  configKey: string;
  value: string | undefined;
}

export function isOnePasswordRef(reference: unknown): boolean {
  return typeof reference === 'string' && ONE_PASSWORD_REF.test(reference.trim());
}

/**
 * Parses `secret-ref:<provider>/<reference>` (or direct `secret-ref:<provider>:<reference>`).
 * Returns `{ provider, reference }` or `null` when malformed.
 */
export function parseSecretRef(raw: unknown): SecretRef | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('secret-ref:')) return null;
  const body = trimmed.slice('secret-ref:'.length);
  const slash = body.indexOf('/');
  const colon = body.indexOf(':');
  const sep = slash >= 0 && (colon < 0 || slash < colon) ? slash : colon;
  if (sep <= 0) return null;
  const provider = body.slice(0, sep).trim();
  const reference = body.slice(sep + 1).trim();
  if (!SECRET_PROVIDER_SLUG.test(provider)) return null;
  if (!reference || reference.length > 1024 || /[\r\n]/.test(reference)) return null;
  return { provider, reference };
}

/** Redacts plaintext secrets, URL-encoded forms, and Base64 forms from text/logs. */
export function redactSecrets(text: unknown, secretValues: readonly unknown[] = []): string {
  let out = String(text ?? '');
  if (!out || !secretValues?.length) return out;
  const variants = new Set<string>();
  for (const val of secretValues) {
    if (typeof val !== 'string' || val.length < 6) continue;
    variants.add(val);
    const trimmed = val.trim();
    if (trimmed.length >= 6) variants.add(trimmed);
    const b64 = Buffer.from(val, 'utf8').toString('base64');
    if (b64.length >= 6) variants.add(b64);
    try {
      const encoded = encodeURIComponent(val);
      if (encoded !== val && encoded.length >= 6) variants.add(encoded);
    } catch {}
  }
  const ordered = [...variants].sort((a, b) => b.length - a.length);
  for (const token of ordered) {
    if (out.includes(token)) out = out.split(token).join('[REDACTED_SECRET]');
  }
  return out;
}

function defaultExec(binary: string, args: string[], { timeoutMs = 45_000 }: { timeoutMs?: number } = {}): Promise<SecretExecResult> {
  return new Promise(resolve => {
    execFile(
      binary,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        encoding: 'utf8',
        env: { ...process.env, PATH: commandPath(), OP_BIOMETRIC_UNLOCK_ENABLED: process.env.OP_BIOMETRIC_UNLOCK_ENABLED || 'true' },
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0;
        resolve({ code, stdout: stdout || '', stderr: stderr || '' });
      },
    );
  });
}

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined;

/**
 * 1Password CLI (`op`) driver with single-prompt batching via `op inject` when reading multiple secrets.
 */
export function createOnePasswordDriver(
  { exec = defaultExec, timeoutMs = 45_000 }: OnePasswordDriverOptions = {},
): SecretDriver<OnePasswordDriverConfig> {
  const runOp = (args: string[]) => exec('op', ['--cache=false', ...args], { timeoutMs });

  async function readOne(account: string, reference: string): Promise<string | undefined> {
    const args = ['read', ...(account ? [`--account=${account}`] : []), '--no-newline', reference];
    const res = await runOp(args);
    return res.code === 0 ? nonEmpty(res.stdout) : undefined;
  }

  async function readTogether(account: string, references: readonly string[]): Promise<(string | undefined)[] | undefined> {
    const dir = await mkdtemp(join(tmpdir(), 'fairy-op-'));
    const templatePath = join(dir, 'template.txt');
    const separator = `__fairy-op-${randomUUID()}__`;
    try {
      await writeFile(templatePath, references.map(ref => `{{ ${ref} }}${separator}`).join(''), { mode: 0o600 });
      const args = ['inject', ...(account ? [`--account=${account}`] : []), '-i', templatePath];
      const res = await runOp(args);
      if (res.code !== 0) return undefined;
      const values = String(res.stdout ?? '').split(separator);
      const trailing = values.pop();
      if (values.length !== references.length || trailing === undefined || trailing.trim().length > 0) {
        return undefined;
      }
      return values.map(nonEmpty);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  return {
    kind: 'onepassword',
    isReference: isOnePasswordRef,
    async read(config: OnePasswordDriverConfig = {}, references: readonly string[] = []): Promise<(string | undefined)[]> {
      const account = typeof config?.account === 'string' ? config.account.trim() : '';
      if (!references.length) return [];
      const invalid = references.some(ref => !isOnePasswordRef(ref));
      if (invalid) return references.map(() => undefined);

      if (references.length > 1) {
        const batched = await readTogether(account, references).catch(() => undefined);
        if (batched) return batched;
      }
      const out: (string | undefined)[] = [];
      for (const ref of references) {
        out.push(await readOne(account, ref).catch(() => undefined));
      }
      return out;
    },
  };
}

/**
 * In-memory, single-flight secret resolver across configured secret providers.
 */
export function createSecretResolver({
  drivers = [createOnePasswordDriver()],
  getProviders = () => ({ onePassword: {} }),
}: SecretResolverOptions = {}): SecretResolver {
  const driversByKind = new Map<string, SecretDriver<any>>(drivers.map(d => [d.kind, d]));
  const cache = new Map<string, CacheEntry>();
  let lock: Promise<void> = Promise.resolve();

  const keyFor = (ref: SecretRef): string => `${ref.provider}\u0000${ref.reference}`;

  const withLock = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = lock.then(fn, fn);
    lock = next.then(() => {}, () => {});
    return next;
  };

  function resolvePlan(providers: SecretProvidersMap, ref: SecretRef): ResolvedPlan | null {
    const cfg = providers?.[ref.provider];
    const kind = cfg?.kind || (ref.provider === 'onepassword' || ref.provider === '1password' ? 'onepassword' : ref.provider);
    const driver = driversByKind.get(kind);
    if (!driver || !driver.isReference(ref.reference)) return null;
    const providerCfg = (cfg?.config ?? cfg ?? {}) as Record<string, unknown>;
    return { driver, config: providerCfg, configKey: JSON.stringify(providerCfg) };
  }

  return {
    async read(references: readonly SecretRef[] = [], { fresh = false }: SecretReadOptions = {}): Promise<(string | undefined)[]> {
      const providers = (await getProviders()) || {};
      const plans = references.map(ref => resolvePlan(providers, ref));
      const needsFetch = (ref: SecretRef, idx: number): boolean => {
        const plan = plans[idx];
        if (!plan) return false;
        const cached = cache.get(keyFor(ref));
        return fresh || !cached || cached.configKey !== plan.configKey;
      };
      if (!references.some(needsFetch)) {
        return references.map((ref, idx) => {
          const plan = plans[idx];
          if (!plan) return undefined;
          const hit = cache.get(keyFor(ref));
          return hit && hit.configKey === plan.configKey ? hit.value : undefined;
        });
      }
      return withLock(async () => {
        const groups = new Map<string, { plan: ResolvedPlan; refsByStr: Map<string, SecretRef> }>();
        references.forEach((ref, idx) => {
          const plan = plans[idx];
          if (!plan || !needsFetch(ref, idx)) return;
          let g = groups.get(ref.provider);
          if (!g) {
            g = { plan, refsByStr: new Map<string, SecretRef>() };
            groups.set(ref.provider, g);
          }
          g.refsByStr.set(ref.reference, ref);
        });
        for (const { plan, refsByStr } of groups.values()) {
          const rawRefs = [...refsByStr.keys()];
          const values = await plan.driver.read(plan.config, rawRefs);
          rawRefs.forEach((refStr, idx) => {
            const refObj = refsByStr.get(refStr);
            if (!refObj) return;
            const value = values?.[idx];
            const k = keyFor(refObj);
            const prev = cache.get(k);
            if (!fresh || nonEmpty(value) !== undefined || !prev || prev.configKey !== plan.configKey) {
              cache.set(k, { configKey: plan.configKey, value });
            }
          });
        }
        return references.map((ref, idx) => {
          const plan = plans[idx];
          if (!plan) return undefined;
          const hit = cache.get(keyFor(ref));
          return hit && hit.configKey === plan.configKey ? hit.value : undefined;
        });
      });
    },
    invalidate(references?: readonly SecretRef[]): void {
      if (!references) {
        cache.clear();
        return;
      }
      for (const ref of references) cache.delete(keyFor(ref));
    },
  };
}
