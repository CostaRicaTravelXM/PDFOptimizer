import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NextResponse } from 'next/server';

/**
 * Mint short-lived upload URLs for Cloudflare R2.
 *
 * The browser never sees the bucket credentials, and the file bytes never pass through this
 * route — the client PUTs each image straight to R2 with the signed URL. That keeps us clear
 * of the platform's request-body limit, which a multi-megabyte email export would blow
 * through immediately.
 *
 * Because this endpoint hands out write access, every field is validated before it is signed.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILES = 200;
const MAX_BYTES = 20 * 1024 * 1024;
const URL_TTL_SECONDS = 900;

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
]);

interface RequestFile {
  path: string;
  contentType: string;
  size: number;
}

function config() {
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

/**
 * Object keys are built from user input, so they are rebuilt rather than trusted: each
 * segment is filtered to safe characters, and `.`/`..` segments are dropped outright so no
 * key can climb out of its folder.
 */
function sanitizeKeyPath(input: string): string | null {
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

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const env = config();
  if (!env) {
    return bad(
      'Image hosting is not configured yet. The R2 environment variables (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL) still need to be set.',
      503,
    );
  }

  let body: { prefix?: unknown; files?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad('Malformed request.');
  }

  if (typeof body.prefix !== 'string') return bad('Missing destination folder.');
  const prefix = sanitizeKeyPath(body.prefix);
  if (!prefix) return bad('That destination folder name cannot be used.');

  if (!Array.isArray(body.files) || body.files.length === 0) {
    return bad('No files to upload.');
  }
  if (body.files.length > MAX_FILES) {
    return bad(`That archive has more than ${MAX_FILES} images, which is more than this tool handles.`);
  }

  const requested: RequestFile[] = [];
  for (const raw of body.files as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return bad('Malformed file entry.');
    const { path, contentType, size } = raw as Record<string, unknown>;

    if (typeof path !== 'string' || typeof contentType !== 'string') {
      return bad('Malformed file entry.');
    }
    if (typeof size !== 'number' || !Number.isFinite(size) || size < 0 || size > MAX_BYTES) {
      return bad(`"${path}" is larger than the ${MAX_BYTES / 1024 / 1024} MB limit for a single image.`);
    }
    if (!ALLOWED_TYPES.has(contentType)) {
      return bad(`"${path}" is not an image type this tool uploads.`);
    }
    requested.push({ path, contentType, size });
  }

  const client = new S3Client({
    region: 'auto',
    endpoint: env.endpoint,
    credentials: { accessKeyId: env.accessKeyId, secretAccessKey: env.secretAccessKey },
    // `<endpoint>/<bucket>/<key>`, which is the form Cloudflare documents. Left to itself the
    // SDK signs virtual-hosted URLs (`<bucket>.<endpoint>`), turning the bucket name into a
    // DNS label — which breaks outright for a bucket name containing a dot.
    forcePathStyle: true,
  });

  try {
    const uploads = await Promise.all(
      requested.map(async (file) => {
        const safe = sanitizeKeyPath(file.path);
        if (!safe) throw new Error(`Cannot build a safe name for "${file.path}".`);
        const key = `${prefix}/${safe}`;

        const uploadUrl = await getSignedUrl(
          client,
          new PutObjectCommand({
            Bucket: env.bucket,
            Key: key,
            ContentType: file.contentType,
            // Email images are immutable once published; a long max-age keeps the recipient's
            // client from re-fetching them on every open.
            CacheControl: 'public, max-age=31536000, immutable',
          }),
          { expiresIn: URL_TTL_SECONDS },
        );

        return {
          path: file.path,
          key,
          uploadUrl,
          publicUrl: `${env.publicBase}/${key.split('/').map(encodeURIComponent).join('/')}`,
        };
      }),
    );

    return NextResponse.json({ uploads });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    return bad(`Could not prepare the upload: ${detail}`, 500);
  }
}
