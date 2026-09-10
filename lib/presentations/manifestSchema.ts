import { LAYOUT_IDS, SLIDE_TYPES } from './manifest';

/**
 * The JSON Schema the planner is held to, via the Messages API's structured outputs.
 *
 * Structured outputs want every property listed as required and `additionalProperties:
 * false` on every object, so "optional" is expressed as nullable. Length limits, item counts
 * and ordering rules are not expressible here; the workflow's validator enforces those and
 * the compile route tolerates the nulls. Enums come from the same constants the compiler
 * uses, so a new layout is one edit.
 */

const nullable = (type: string) => ({ type: [type, 'null'] });
const str = { type: 'string' };
const nstr = nullable('string');

function obj(properties: Record<string, unknown>, opts: { description?: string } = {}) {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
    ...(opts.description ? { description: opts.description } : {}),
  };
}

const nullableArray = (items: unknown) => ({ type: ['array', 'null'], items });

export const MANIFEST_JSON_SCHEMA = obj({
  presentation: obj({
    title: str,
    subtitle: nstr,
    style: { type: 'string', enum: ['minimal', 'immersive'] },
    audience: { type: 'string', enum: ['agent', 'internal', 'client', 'mixed'] },
    language: { type: 'string', enum: ['en', 'es'] },
  }),
  brand: obj({
    palette: nullableArray(str),
    title_font: nstr,
    body_font: nstr,
  }),
  slides: {
    type: 'array',
    items: obj({
      id: str,
      type: { type: 'string', enum: SLIDE_TYPES },
      layout: { type: 'string', enum: LAYOUT_IDS },
      theme: { type: ['string', 'null'], enum: ['light', 'dark', 'accent', null] },
      copy: obj({
        eyebrow: nstr,
        title: nstr,
        subtitle: nstr,
        body: nstr,
        day_label: nstr,
        meta: nullableArray(str),
        stops: nullableArray(obj({ label: str, sublabel: nstr, date: nstr })),
        cards: nullableArray(obj({ title: str, body: nstr })),
        options: nullableArray(obj({ name: str, location: nstr, room: nstr, notes: nstr, price: nstr })),
        included: nullableArray(str),
        excluded: nullableArray(str),
        contact: {
          type: ['object', 'null'],
          additionalProperties: false,
          required: ['name', 'email', 'phone', 'website'],
          properties: { name: nstr, email: nstr, phone: nstr, website: nstr },
        },
        cta: nstr,
      }),
      assets: {
        type: 'array',
        items: obj({
          purpose: {
            type: 'string',
            enum: ['background', 'primary_photo', 'secondary_photo', 'tertiary_photo', 'decorative_element'],
          },
          source: { type: 'string', enum: ['workdrive', 'pexels', 'placeholder'] },
          subject_kind: { type: 'string', enum: ['generic_scene', 'named_property', 'brand_element'] },
          asset_match: nstr,
          fallback_query: nstr,
          orientation: { type: ['string', 'null'], enum: ['landscape', 'portrait', null] },
        }),
      },
      layout_constraints: {
        type: ['object', 'null'],
        additionalProperties: false,
        required: ['title_max_chars', 'body_max_chars'],
        properties: { title_max_chars: nullable('integer'), body_max_chars: nullable('integer') },
      },
      warnings: nullableArray(str),
    }),
  },
});
