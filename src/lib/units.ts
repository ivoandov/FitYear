/**
 * Weight-unit conversion — the single source of truth.
 *
 * The DB always stores weight in **lbs**. The UI shows/edits in the user's
 * chosen unit (`lbs` | `kg`). Before this module, `2.20462` was hand-rolled in
 * ~13 places with THREE different rounding conventions (`Math.round(x*10)/10`,
 * `.toFixed(1)`, `.toFixed(0)`), so the same weight rendered differently across
 * screens. Everything now routes through here with ONE convention: round to 1
 * decimal place.
 *
 *   read  (DB lbs -> display):  lbsToDisplay(lbs, unit)
 *   write (display -> DB lbs):  displayToLbs(val, unit)
 *   reunit (in-memory flip):    convertWeight(val, from, to)
 */
export const LB_PER_KG = 2.20462;

export type WeightUnit = "lbs" | "kg";

/** Round to 1 decimal place (the app-wide weight rounding convention). */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Convert a stored lbs value to the user's display unit. Returns null for a
 * null/undefined input so callers can render an empty field.
 */
export function lbsToDisplay(
  lbs: number | null | undefined,
  unit: WeightUnit,
): number | null {
  if (lbs == null) return null;
  return unit === "kg" ? round1(lbs / LB_PER_KG) : round1(lbs);
}

/**
 * Convert a display-unit value back to lbs for storage. Returns null for a
 * null/undefined input.
 */
export function displayToLbs(
  val: number | null | undefined,
  unit: WeightUnit,
): number | null {
  if (val == null) return null;
  return unit === "kg" ? round1(val * LB_PER_KG) : round1(val);
}

/**
 * Convert an in-memory value from one unit to another. A same-unit conversion
 * is a pass-through (no rounding) so restoring in-progress sets in the current
 * unit is an exact no-op.
 */
export function convertWeight(
  val: number | null,
  from: WeightUnit,
  to: WeightUnit,
): number | null {
  if (val == null || from === to) return val;
  return from === "lbs" ? round1(val / LB_PER_KG) : round1(val * LB_PER_KG);
}
