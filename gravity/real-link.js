// Modified 2026-11-21: resolve a presentation deep link against the existing catalogue.
import { findGalaxy } from './sparc.js';

/** Return a canonical SPARC ID, or null so the view keeps its normal default. */
export function galaxyFromSearch(data, search = '') {
  const requested = new URLSearchParams(search).get('galaxy');
  return requested ? findGalaxy(data, requested)?.name ?? null : null;
}
