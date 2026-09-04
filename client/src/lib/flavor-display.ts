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
