import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Everything the server does with the Cloudflare R2 bucket goes through here.
 *
 * The presign route was the only caller for a while and carried this logic inline. The
 * presentation tool added a second family of routes that read and write objects directly
 * (job records, extracted text, compiled decks), so the client construction, the env reading
 * and the key hygiene moved into one place rather than being copied.
 *
 * Server-only: this module reads secrets from the environment. Nothing under `lib/` that is
 * imported by a client component may import it.
 */

export interface R2Config {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Public base URL of the bucket, no trailing slash. */
  publicBase: string;
  endpoint: string;
}

export const R2_ENV_NAMES =
  'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL';

export function getR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const publicBase = process.env.R2_PUBLIC_BASE_URL;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBase) {
    return null;
  }
  return {
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBase: publicBase.replace(/\/+$/, ''),
    // Overridable because R2 buckets created in a specific jurisdiction sign against
    // `<account>.<eu|fedramp>.r2.cloudflarestorage.com` rather than the default host.
    endpoint:
      process.env.R2_ENDPOINT?.replace(/\/+$/, '') ||
      `https://${accountId}.r2.cloudflarestorage.com`,
  };
}

export class R2NotConfiguredError extends Error {
  constructor() {
    super(
      `Cloud storage is not configured yet. The environment variables (${R2_ENV_NAMES}) still need to be set.`,
    );
  }
}

/** Like getR2Config, for callers that cannot do anything useful without a bucket. */
export function requireR2Config(): R2Config {
  const config = getR2Config();
  if (!config) throw new R2NotConfiguredError();
  return config;
}

let cached: { key: string; client: S3Client } | null = null;

/**
 * One client per configuration for the life of the process. Serverless instances are short
 * lived anyway, but a warm instance serving a polling loop would otherwise build a fresh
 * client — and re-resolve credentials — on every status request.
 */
export function r2Client(config: R2Config): S3Client {
  const key = `${config.endpoint}|${config.accessKeyId}|${config.bucket}`;
  if (cached?.key === key) return cached.client;
  const client = new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // `<endpoint>/<bucket>/<key>`, which is the form Cloudflare documents. Left to itself the
    // SDK signs virtual-hosted URLs (`<bucket>.<endpoint>`), turning the bucket name into a
    // DNS label — which breaks outright for a bucket name containing a dot.
    forcePathStyle: true,
  });
  cached = { key, client };
  return client;
}

/**
 * Object keys built from user input are rebuilt rather than trusted: each segment is
 * filtered to safe characters, and `.`/`..` segments are dropped outright so no key can
 * climb out of its folder.
 */
export function sanitizeKeyPath(input: string): string | null {
  const segments = input
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== '.' && s !== '..')
    .map((s) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean);

  if (segments.length === 0) return null;
  const key = segments.join('/');
  return key.length <= 512 ? key : null;
}

export function publicUrlFor(config: R2Config, key: string): string {
  return `${config.publicBase}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export async function presignPut(
  config: R2Config,
  key: string,
  contentType: string,
  opts: { ttlSeconds: number; cacheControl?: string },
): Promise<string> {
  return getSignedUrl(
    r2Client(config),
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ContentType: contentType,
      CacheControl: opts.cacheControl,
    }),
    { expiresIn: opts.ttlSeconds },
  );
}

export async function putObject(
  config: R2Config,
  key: string,
  body: Buffer | string,
  contentType: string,
  cacheControl = 'no-store',
): Promise<void> {
  await r2Client(config).send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl,
    }),
  );
}

export async function putJson(config: R2Config, key: string, value: unknown): Promise<void> {
  await putObject(config, key, JSON.stringify(value, null, 2), 'application/json; charset=utf-8');
}

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return (
    e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404
  );
}

/** The object's bytes, or null when there is no such key. Other failures still throw. */
export async function getObject(config: R2Config, key: string): Promise<Buffer | null> {
  try {
    const result = await r2Client(config).send(
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    );
    if (!result.Body) return null;
    return Buffer.from(await result.Body.transformToByteArray());
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function getJson<T>(config: R2Config, key: string): Promise<T | null> {
  const bytes = await getObject(config, key);
  if (!bytes) return null;
  return JSON.parse(bytes.toString('utf8')) as T;
}

export async function headObject(
  config: R2Config,
  key: string,
): Promise<{ size: number; contentType?: string } | null> {
  try {
    const result = await r2Client(config).send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
    );
    return { size: result.ContentLength ?? 0, contentType: result.ContentType };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/**
 * The "folders" directly under a prefix. Used to enumerate jobs without reading any of
 * them: with `Delimiter: '/'` the bucket returns one entry per job prefix instead of one per
 * object inside it.
 */
export async function listCommonPrefixes(config: R2Config, prefix: string): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const page = await r2Client(config).send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix,
        Delimiter: '/',
        ContinuationToken: token,
      }),
    );
    for (const p of page.CommonPrefixes ?? []) if (p.Prefix) out.push(p.Prefix);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return out;
}
