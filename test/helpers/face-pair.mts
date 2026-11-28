// A full Fairy's phone link with a face paired to it over real TLS, for the two-Macs tests: setup(ask) pairs a Mac,
// call() makes a request with its key, and events() follows its event stream.
import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eventParser, type FaceStreamEvent } from '../../desktop/face-client.mjs';
import { FaceLink } from '../../desktop/face-link.mjs';
import { PhoneLink, makeCertificate } from '../../desktop/phone-link.mjs';

export const NAME = 'mini.example.ts.net';
export const PNG = Buffer.from('a picture').toString('base64');

type CertType = Awaited<ReturnType<typeof makeCertificate>>;
type FaceLinkAskFn = ConstructorParameters<typeof FaceLink>[0]['ask'];

let shared: CertType | undefined;
const certificate = async (options: Parameters<typeof makeCertificate>[0]): Promise<CertType> => {
  shared ??= await makeCertificate(options);
  return shared;
};

export const until = async (check: () => unknown, ms = 4000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

export interface FacePairSetup {
  link: PhoneLink;
  face: FaceLink;
  key: string;
  approveKey: string;
  done: () => Promise<void>;
}

export async function setup(ask: FaceLinkAskFn): Promise<FacePairSetup> {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-face-pair-'));
  const face = new FaceLink({ ask, name: () => 'Fairy' });
  const link = new PhoneLink({
    path: join(dir, 'phone-link.json'),
    port: 0,
    every: 1e7,
    certificate,
    accepts: () => true,
    address: () => '127.0.0.1',
    name: async () => NAME,
    reach: async () => 'open',
    overview: () => ({ chats: [], approvals: [] }),
    chat: async id => ({ id }),
    answer: () => {},
    face: face as unknown as ConstructorParameters<typeof PhoneLink>[0]['face'],
  });
  await link.start();
  await link.setEnabled(true);
  const { url } = link.pair({ kind: 'mac' });
  const code = new URL(url).searchParams.get('code');
  const paired = (await call(link, '/v1/pair', { method: 'POST', body: { code, name: 'MacBook', kind: 'mac' } })).json as {
    readKey: string;
    approveKey: string;
  };
  const key = paired.readKey;
  return {
    link,
    face,
    key,
    approveKey: paired.approveKey,
    done: async () => {
      await link.stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export interface FacePairCallOptions {
  method?: string;
  key?: string;
  body?: unknown;
  raw?: string | Buffer | Uint8Array;
  headers?: Record<string, string>;
}

export interface FacePairCallResult {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json?: any;
  bytes?: Buffer;
  headers?: IncomingHttpHeaders;
  error?: Error;
}

export function call(
  link: { server: { address(): AddressInfo | string | null } | null },
  path: string,
  { method = 'GET', key, body, raw, headers = {} }: FacePairCallOptions = {},
): Promise<FacePairCallResult> {
  const port = (link.server?.address() as AddressInfo).port;
  return new Promise((resolve) => {
    const request = httpsRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        agent: false,
        rejectUnauthorized: false,
        headers: {
          Host: `${NAME}:${port}`,
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
          'Content-Type': 'application/json',
          ...headers,
        },
      },
      response => {
        const parts: Buffer[] = [];
        response.on('data', (part: Buffer) => parts.push(part));
        response.on('end', () => {
          const bytes = Buffer.concat(parts);
          let json: unknown = null;
          try { json = JSON.parse(bytes.toString()); } catch {}
          resolve({ status: response.statusCode ?? 0, json, bytes, headers: response.headers });
        });
      },
    );
    request.on('error', error => resolve({ status: 0, error }));
    request.end(raw ?? (body === undefined ? undefined : JSON.stringify(body)));
  });
}

export type FaceEventsList = FaceStreamEvent[] & { stop: () => void };

export function events(link: { server: { address(): AddressInfo | string | null } | null }, key: string): FaceEventsList {
  const port = (link.server?.address() as AddressInfo).port;
  const list = [] as unknown as FaceEventsList;
  const parser = eventParser();
  const request = httpsRequest(
    {
      host: '127.0.0.1',
      port,
      path: '/v1/face/events',
      agent: false,
      rejectUnauthorized: false,
      headers: { Host: `${NAME}:${port}`, Authorization: `Bearer ${key}` },
    },
    response => {
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => list.push(...parser.feed(chunk)));
    },
  );
  request.on('error', () => {});
  request.end();
  list.stop = () => request.destroy();
  return list;
}
