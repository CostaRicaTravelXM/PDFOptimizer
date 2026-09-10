import type { LayoutId } from '@/lib/presentations/manifest';
import { asymmetricTwoPhoto } from './asymmetricTwoPhoto';
import { closingStory } from './closingStory';
import { fullBleedHero } from './fullBleedHero';
import { hotelComparison } from './hotelComparison';
import { informationCards } from './informationCards';
import type { LayoutRenderer } from './shared';
import { splitPhotoText } from './splitPhotoText';
import { timelineRoute } from './timelineRoute';

/** The layout primitive library: one renderer per id the planner may choose. */
export const LAYOUTS: Record<LayoutId, LayoutRenderer> = {
  full_bleed_hero_with_left_copy: fullBleedHero,
  split_photo_text: splitPhotoText,
  asymmetric_two_photo_editorial: asymmetricTwoPhoto,
  timeline_route: timelineRoute,
  information_cards: informationCards,
  hotel_comparison: hotelComparison,
  closing_story: closingStory,
};

export type { LayoutRenderer, RenderContext } from './shared';
