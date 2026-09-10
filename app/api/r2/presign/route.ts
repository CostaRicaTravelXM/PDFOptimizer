import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NextResponse } from 'next/server';
import { getR2Config, publicUrlFor, r2Client, R2_ENV_NAMES, sanitizeKeyPath } from '@/lib/server/r2';

/**
 * Mint short-lived upload URLs for Cloudflare R2.
 *
 * The browser never sees the bucket credentials, and the file bytes never pass through this
 * route — the client PUTs each image straight to R2 with the signed URL. That keeps us clear
 * of the platform's request-body limit, which a multi-megabyte email export would blow
 * through immediately.
 *
 * Because this endpoint hands out write access, every field is validated before it is signed.
 * The bucket client and the key hygiene live in `lib/server/r2.ts`, shared with the
 * presentation routes.
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

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const env = getR2Config();
  if (!env) {
    return bad(
      `Image hosting is not configured yet. The R2 environment variables (${R2_ENV_NAMES}) still need to be set.`,
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

  const client = r2Client(env);

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
          publicUrl: publicUrlFor(env, key),
        };
      }),
    );

    return NextResponse.json({ uploads });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    return bad(`Could not prepare the upload: ${detail}`, 500);
  }
}
