import { createHash, createPublicKey, generateKeyPairSync, randomUUID, sign, verify, type JsonWebKey, type KeyObject } from 'node:crypto';

export interface DpopPublicJwk {
  kty: string;
  crv: string;
  x: string;
  y: string;
}

export interface DpopKeyPair {
  publicKey: KeyObject;
  privateKey: KeyObject;
  publicJwk: DpopPublicJwk;
  thumbprint: string;
}

export interface SignDpopProofOptions {
  privateKey?: KeyObject;
  publicJwk?: Partial<DpopPublicJwk>;
  htm?: string;
  htu?: string | URL;
  jti?: string;
  iat?: number;
  nonce?: string;
}

export interface DpopReplayCacheOptions {
  ttlSec?: number;
  maxEntries?: number;
  nowSec?: () => number;
}

export interface DpopReplayCache {
  checkAndRecord(jti: string, thumbprint: string): boolean;
  size(): number;
}

export interface VerifyDpopProofOptions {
  expectedHtm?: string;
  expectedHtu?: string | URL;
  maxAgeSec?: number;
  nowSec?: () => number;
  replayCache?: DpopReplayCache | null;
}

export interface DpopJwtPayload {
  jti?: unknown;
  htm?: unknown;
  htu?: unknown;
  iat?: unknown;
  nonce?: unknown;
  [key: string]: unknown;
}

export type VerifyDpopResult =
  | { valid: false; reason: string }
  | { valid: true; jti: string; thumbprint: string; payload: DpopJwtPayload };

function b64u(input: string | Uint8Array): string {
  return Buffer.from(input).toString('base64url');
}

function unb64u(str: unknown): Buffer {
  return Buffer.from(String(str || ''), 'base64url');
}

export function jwkThumbprint(jwk: Partial<DpopPublicJwk> | null | undefined): string {
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
    throw new Error('Expected P-256 EC public JWK.');
  }
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return createHash('sha256').update(canonical).digest('base64url');
}

export function createDpopKeyPair(): DpopKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const publicJwk: DpopPublicJwk = { kty: jwk.kty ?? '', crv: jwk.crv ?? '', x: jwk.x ?? '', y: jwk.y ?? '' };
  return {
    publicKey,
    privateKey,
    publicJwk,
    thumbprint: jwkThumbprint(publicJwk),
  };
}

export function normalizeHtu(rawUrl: string | URL): string {
  const u = new URL(String(rawUrl));
  u.search = '';
  u.hash = '';
  return u.toString();
}

export function signDpopProof({
  privateKey,
  publicJwk,
  htm,
  htu,
  jti = randomUUID(),
  iat = Math.floor(Date.now() / 1000),
  nonce = '',
}: SignDpopProofOptions = {}): string {
  if (!privateKey || !publicJwk) throw new Error('Missing DPoP signing key material.');
  const header = {
    typ: 'dpop+jwt',
    alg: 'ES256',
    jwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y },
  };
  const payload = {
    jti: String(jti),
    htm: String(htm || 'GET').toUpperCase(),
    htu: normalizeHtu(htu as string | URL),
    iat: Math.floor(Number(iat)),
    ...(nonce ? { nonce: String(nonce) } : {}),
  };
  const signingInput = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`;
  const sig = sign('sha256', Buffer.from(signingInput, 'utf8'), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64u(sig)}`;
}

export function createDpopReplayCache({ ttlSec = 300, maxEntries = 5000, nowSec = () => Math.floor(Date.now() / 1000) }: DpopReplayCacheOptions = {}): DpopReplayCache {
  const seen = new Map<string, number>();

  function prune(cur: number): void {
    for (const [k, exp] of seen.entries()) {
      if (cur >= exp) seen.delete(k);
    }
  }

  return {
    checkAndRecord(jti: string, thumbprint: string): boolean {
      const cur = nowSec();
      prune(cur);
      const key = `${thumbprint}:${jti}`;
      if (seen.has(key)) return false;
      seen.set(key, cur + ttlSec);
      while (seen.size > maxEntries) {
        const oldest = seen.keys().next().value;
        if (oldest === undefined) break;
        seen.delete(oldest);
      }
      return true;
    },
    size: () => seen.size,
  };
}

export function verifyDpopProof(token: unknown, {
  expectedHtm,
  expectedHtu,
  maxAgeSec = 120,
  nowSec = () => Math.floor(Date.now() / 1000),
  replayCache = null,
}: VerifyDpopProofOptions = {}): VerifyDpopResult {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return { valid: false, reason: 'malformed_jwt' };
  let header: { typ?: unknown; alg?: unknown; jwk?: Partial<DpopPublicJwk> & JsonWebKey };
  let payload: DpopJwtPayload;
  try {
    header = JSON.parse(unb64u(parts[0]).toString('utf8')) as { typ?: unknown; alg?: unknown; jwk?: Partial<DpopPublicJwk> & JsonWebKey };
    payload = JSON.parse(unb64u(parts[1]).toString('utf8')) as DpopJwtPayload;
  } catch {
    return { valid: false, reason: 'invalid_json' };
  }

  if (header?.typ !== 'dpop+jwt' || header?.alg !== 'ES256') {
    return { valid: false, reason: 'unsupported_header' };
  }
  const jwk = header?.jwk;
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
    return { valid: false, reason: 'invalid_jwk' };
  }

  let thumbprint: string;
  let keyObj: KeyObject;
  try {
    thumbprint = jwkThumbprint(jwk);
    keyObj = createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' });
  } catch {
    return { valid: false, reason: 'invalid_key' };
  }

  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8');
  const sig = unb64u(parts[2]);
  const sigOk = verify('sha256', signingInput, { key: keyObj, dsaEncoding: 'ieee-p1363' }, sig);
  if (!sigOk) return { valid: false, reason: 'bad_signature' };

  if (expectedHtm && String(payload?.htm || '').toUpperCase() !== String(expectedHtm).toUpperCase()) {
    return { valid: false, reason: 'htm_mismatch' };
  }
  try {
    if (expectedHtu && normalizeHtu(String(payload?.htu)) !== normalizeHtu(expectedHtu)) {
      return { valid: false, reason: 'htu_mismatch' };
    }
  } catch {
    return { valid: false, reason: 'invalid_htu' };
  }

  const iat = Number(payload?.iat);
  const cur = nowSec();
  if (!Number.isFinite(iat) || Math.abs(cur - iat) > maxAgeSec) {
    return { valid: false, reason: 'stale_iat' };
  }

  const jti = String(payload?.jti || '');
  if (!jti) return { valid: false, reason: 'missing_jti' };
  if (replayCache && !replayCache.checkAndRecord(jti, thumbprint)) {
    return { valid: false, reason: 'replayed_jti' };
  }

  return { valid: true, jti, thumbprint, payload };
}
