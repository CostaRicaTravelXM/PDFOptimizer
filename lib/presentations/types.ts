/**
 * The shape of a presentation job, shared by the browser, the API routes and — by contract —
 * the n8n workflows that drive a job from "queued" to "done".
 *
 * Client-safe on purpose: no zod, no environment, nothing that pulls server code into the
 * page bundle. The server-side validation of these shapes lives under `lib/server/`.
 */

export type PresentationStyle = 'minimal' | 'immersive';
export type Audience = 'agent' | 'internal' | 'client' | 'mixed';
export type Language = 'en' | 'es';

export type JobStatus =
  | 'queued'
  | 'planning'
  | 'resolving_assets'
  | 'compiling'
  | 'importing'
  | 'done'
  | 'failed';

export type AssetSource = 'workdrive' | 'pexels' | 'unsplash' | 'placeholder';

/** What the user asked for, frozen at creation. */
export interface JobInput {
  title: string;
  style: PresentationStyle;
  audience: Audience;
  language: Language;
  clientName?: string;
  travelDates?: string;
  travelers?: string;
  destination: string;
  notes?: string;
  /** R2 key and public URL of the uploaded brief. */
  pdfKey: string;
  pdfUrl: string;
  pageCount: number;
  textChars: number;
  /** True when the PDF yielded so little text that it is probably scanned or design-tool output. */
  textLow: boolean;
}

/** One image decision, kept for the licensing audit the spec requires. */
export interface AssetUsage {
  slideId: string;
  purpose: string;
  source: AssetSource;
  provider?: string;
  providerImageId?: string;
  sourceUrl?: string;
  downloadUrl?: string;
  photographer?: string;
  licenseUrl?: string;
  query?: string;
  retrievedAt: string;
}

export interface JobRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  /** Free text from the workflow about what it is doing right now. Rendered as text only. */
  step?: string;
  input: JobInput;
  /** Where the extracted brief text lives, so a retry never re-uploads the PDF. */
  textKey: string;
  manifestKey?: string;
  pptxKey?: string;
  pptxUrl?: string;
  canva?: { designId: string; editUrl: string; viewUrl?: string };
  warnings: string[];
  assets: AssetUsage[];
  /** Model and token usage from the planning step, for cost tracking. */
  meta?: { model?: string; usage?: Record<string, unknown>; cacheRead?: number };
  error?: { message: string; step: string };
}

/** The slice of a record the history list needs. Deliberately omits the PDF URL. */
export interface JobSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  title: string;
  style: PresentationStyle;
  destination: string;
  canvaEditUrl?: string;
  pptxUrl?: string;
}

/** What n8n may change on a record. Everything else is set at creation and immutable. */
export interface JobPatch {
  status?: JobStatus;
  step?: string;
  manifestKey?: string;
  pptxKey?: string;
  pptxUrl?: string;
  canva?: JobRecord['canva'];
  /** Appended to the existing list, duplicates dropped. */
  warnings?: string[];
  assets?: AssetUsage[];
  meta?: JobRecord['meta'];
  error?: JobRecord['error'];
}

export interface UploadUrlRequest {
  name: string;
  size: number;
  contentType: string;
}

export interface UploadUrlResponse {
  jobId: string;
  pdfKey: string;
  pdfUrl: string;
  uploadUrl: string;
}

/** The form, as the page collects it. */
export interface JobFormFields {
  title: string;
  style: PresentationStyle;
  audience: Audience;
  language: Language;
  clientName?: string;
  travelDates?: string;
  travelers?: string;
  destination: string;
  notes?: string;
}

export type CreateJobRequest =
  | (JobFormFields & {
      jobId: string;
      pdfKey: string;
      pageCount: number;
      textChars: number;
      textLow: boolean;
      text: string;
    })
  | ({ retryOf: string } & Partial<JobFormFields>);

export interface CreateJobResponse {
  job: JobRecord;
}

export interface JobListResponse {
  jobs: JobSummary[];
}

export interface CompileResponse {
  pptxKey: string;
  pptxUrl: string;
  slideCount: number;
  warnings: string[];
}

export const LIMITS = {
  /** The sample itineraries are photo-heavy exports well above 100 MB. */
  PDF_MAX_BYTES: 150 * 1024 * 1024,
  /** Roughly 100k tokens of brief; anything longer is not an itinerary. */
  TEXT_MAX_CHARS: 400_000,
  TITLE_MAX: 120,
  SHORT_FIELD_MAX: 120,
  NOTES_MAX: 2000,
  /** Below this the brief is too thin to plan from — the workflow refuses it. */
  TEXT_MIN_CHARS: 200,
  /** Fewer characters per page than this and the PDF is probably a scan. */
  LOW_TEXT_CHARS_PER_PAGE: 200,
} as const;

/** `YYYYMMDD-HHMMSS-xxxxxx`, time-sortable so a bucket listing comes back newest-first. */
export const JOB_ID_RE = /^\d{8}-\d{6}-[0-9a-f]{6}$/;

export const STYLES: { value: PresentationStyle; label: string; description: string }[] = [
  {
    value: 'minimal',
    label: 'Minimal',
    description:
      'Clean, factual and scannable. For travel agents, FAM programmes, inspections and internal packs.',
  },
  {
    value: 'immersive',
    label: 'Immersive',
    description:
      'Large photography and short, evocative copy. For clients, luxury proposals and bespoke itineraries.',
  },
];

export const AUDIENCES: { value: Audience; label: string }[] = [
  { value: 'client', label: 'Client / traveler' },
  { value: 'agent', label: 'Travel agent' },
  { value: 'internal', label: 'Internal team' },
  { value: 'mixed', label: 'Mixed' },
];

export const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
];
