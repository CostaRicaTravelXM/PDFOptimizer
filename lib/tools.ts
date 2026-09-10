/**
 * The suite's table of contents.
 *
 * Both the landing grid and the in-tool header switcher read from here, so adding a third
 * tool is one entry plus a route — nothing else needs to learn about it.
 */
export interface Tool {
  slug: string;
  href: string;
  name: string;
  tagline: string;
  /** One-line description for the landing card. */
  blurb: string;
  /** Where the work happens, stated plainly — people ask. */
  note: string;
  /** Path data for a 24x24 stroked icon. */
  icon: string[];
}

export const TOOLS: Tool[] = [
  {
    slug: 'pdf-optimizer',
    href: '/tools/pdf-optimizer',
    name: 'PDF Optimizer',
    tagline: 'Make PDFs small enough to send',
    blurb:
      'Drop an oversized itinerary and get it back light enough for email, looking the same.',
    note: 'Runs on this device',
    icon: [
      'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z',
      'M14 2v5h5',
      'm9 15 3 3 3-3',
      'M12 11v7',
    ],
  },
  {
    slug: 'email-images',
    href: '/tools/email-images',
    name: 'Email Image Hosting',
    tagline: 'Host email images on the cloud',
    blurb:
      'Upload an email export .zip. Images go to Cloudflare R2 and the HTML is rewritten to point at them.',
    note: 'Uploads to R2',
    icon: [
      'M12 13v8',
      'm8 17 4-4 4 4',
      'M4.4 15a7 7 0 1 1 12.1-6.7A5 5 0 0 1 18 18h-1.4',
    ],
  },
  {
    slug: 'itinerary-presentation',
    href: '/tools/itinerary-presentation',
    name: 'AI Itinerary Presentation',
    tagline: 'Turn an itinerary PDF into a Canva deck',
    blurb:
      'Drop an itinerary brief, pick a style, and get an editable Canva presentation with photos already in place.',
    note: 'Uploads to R2 · builds in the cloud',
    icon: [
      'M3 5h18v11H3z',
      'M8 21h8',
      'M12 16v5',
      'M7 12l3-3 2 2 3-4 2 3',
    ],
  },
];

export function toolBySlug(slug: string): Tool | undefined {
  return TOOLS.find((t) => t.slug === slug);
}
