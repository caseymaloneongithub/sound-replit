/**
 * Display alias for flavor OPTION labels (owner, 2026-09-03): the Mixed choice is
 * the gateway to both the fixed assortment and the pick-2 split, so pickers and
 * shop cards label it "Mixed / Split". The internal flavor name stays 'Mixed' —
 * the board's MX column, stock exclusions, and split resolution all key on it —
 * and resulting ITEMS still display plain "Mixed".
 */
export function flavorOptionLabel(name: string): string {
  return name === 'Mixed' ? 'Mixed / Split' : name;
}

/**
 * Each flavor's display accent — the big name is set in its color, Camellia Grove
 * style (shared by Our Kombucha and the flavor-first shop). Mid-tone hues so they
 * hold on both light and dark grounds; unknown names fall back to the normal
 * foreground by returning undefined.
 */
export const FLAVOR_ACCENTS: Record<string, string> = {
  Mist: "#5b7a94",
  Sunbreak: "#d97b16",
  Wildberry: "#9d3c6c",
  Bonfire: "#b5451f",
  "Island Hop": "#1f8a70",
  Evergreen: "#38684a",
  Hummingbrew: "#c25e6a",
  Northzest: "#7a8c1e",
  Mixed: "#6b7a72",
};
