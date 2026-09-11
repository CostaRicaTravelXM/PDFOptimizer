import { LAYOUT_IDS, SLIDE_TYPES } from './manifest';

/**
 * The JSON Schema the planner is held to, via the Messages API's structured outputs.
 *
 * Structured outputs want every property listed as required and `additionalProperties:
 * false` on every object. The obvious way to express "optional" is then a nullable type —
 * but the API caps a schema at 16 union-typed parameters ("exponential compilation cost")
 * and this manifest has far more optional fields than that. Two earlier attempts died on
 * that limit and on the related rule that an `enum` may not sit on a nullable type.
 *
 * So nothing here is nullable. An unused text field is the empty string, an unused list is
 * the empty array, and the workflow's validator strips both before the compiler sees them.
 * The prompt states the same convention.
 *
 * Length limits, item counts and ordering rules are not expressible here either; the
 * validator enforces those. Enums come from the same constants the compiler uses, so a new
 * layout is one edit.
 */

const str = { type: 'string' };
const arr = (items: unknown) => ({ type: 'array', items });

function obj(properties: Record<string, unknown>) {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

export const MANIFEST_JSON_SCHEMA = obj({
  presentation: obj({
    title: str,
    subtitle: str,
    style: { type: 'string', enum: ['minimal', 'immersive'] },
    audience: { type: 'string', enum: ['agent', 'internal', 'client', 'mixed'] },
    language: { type: 'string', enum: ['en', 'es'] },
  }),
  brand: obj({
    palette: arr(str),
    title_font: str,
    body_font: str,
  }),
  slides: arr(
    obj({
      id: str,
      type: { type: 'string', enum: SLIDE_TYPES },
      layout: { type: 'string', enum: LAYOUT_IDS },
      theme: { type: 'string', enum: ['light', 'dark', 'accent'] },
      copy: obj({
        eyebrow: str,
        title: str,
        subtitle: str,
        body: str,
        day_label: str,
        meta: arr(str),
        stops: arr(obj({ label: str, sublabel: str, date: str })),
        cards: arr(obj({ title: str, body: str })),
        options: arr(obj({ name: str, location: str, room: str, notes: str, price: str })),
        included: arr(str),
        excluded: arr(str),
        contact: obj({ name: str, email: str, phone: str, website: str }),
        cta: str,
      }),
      assets: arr(
        obj({
          purpose: {
            type: 'string',
            enum: ['background', 'primary_photo', 'secondary_photo', 'tertiary_photo', 'decorative_element'],
          },
          source: { type: 'string', enum: ['workdrive', 'pexels', 'placeholder'] },
          subject_kind: { type: 'string', enum: ['generic_scene', 'named_property', 'brand_element'] },
          asset_match: str,
          fallback_query: str,
          orientation: { type: 'string', enum: ['landscape', 'portrait'] },
        }),
      ),
      warnings: arr(str),
    }),
  ),
});
