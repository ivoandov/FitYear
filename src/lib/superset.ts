/**
 * Supersets: exercises you alternate between without resting in between.
 *
 * The data model is deliberately the smallest thing that can express it - a
 * shared `supersetGroup` label on consecutive exercises - rather than a nested
 * structure. Nesting would have changed the shape of every workout everywhere:
 * the tracker indexes exercises flat, `exerciseSets` is keyed by instanceId,
 * history stores a flat array, and the editor reorders by index. A label leaves
 * all of that untouched, and an app that does not understand supersets still
 * renders a grouped workout correctly as a plain list.
 *
 * PURE, so the one genuinely behavioural rule - when do you rest - is testable
 * without a browser.
 */

export interface SupersetMember {
  instanceId?: string;
  supersetGroup?: string | null;
}

/** Members of the current exercise's group, in workout order. Empty when solo. */
export function groupMembers<T extends SupersetMember>(
  exercises: T[],
  index: number,
): T[] {
  const group = exercises[index]?.supersetGroup;
  if (!group) return [];
  // Contiguous run only. Two separate A-blocks in one workout are two
  // supersets, not one four-exercise superset with the rest of the session
  // wedged in the middle - and a label match alone cannot tell those apart.
  let start = index;
  while (start > 0 && exercises[start - 1]?.supersetGroup === group) start--;
  let end = index;
  while (end < exercises.length - 1 && exercises[end + 1]?.supersetGroup === group) end++;
  return exercises.slice(start, end + 1);
}

/** 1-based position within the group, or null when the exercise is solo. */
export function positionInGroup<T extends SupersetMember>(
  exercises: T[],
  index: number,
): { position: number; total: number } | null {
  const members = groupMembers(exercises, index);
  if (members.length < 2) return null;
  const me = exercises[index];
  const pos = members.findIndex((m) => m.instanceId === me.instanceId);
  if (pos < 0) return null;
  return { position: pos + 1, total: members.length };
}

/**
 * The index to move to after finishing a set, and whether to rest first.
 *
 * The whole point of a superset: you go straight from A1 to A2 and only rest
 * once you have been round the group. Resting between the pair would make it
 * two ordinary exercises done slowly.
 *
 * Returns null when this is not a superset, so the caller keeps its existing
 * behaviour untouched rather than routing every workout through this.
 */
export function nextInSuperset<T extends SupersetMember>(
  exercises: T[],
  index: number,
): { nextIndex: number; restFirst: boolean } | null {
  const members = groupMembers(exercises, index);
  if (members.length < 2) return null;

  const firstIndex = exercises.findIndex((e) => e.instanceId === members[0].instanceId);
  const posInGroup = index - firstIndex;
  const isLastOfGroup = posInGroup === members.length - 1;

  return isLastOfGroup
    ? // Round complete: back to the top of the group, and NOW you rest.
      { nextIndex: firstIndex, restFirst: true }
    : // Straight into the next movement, no rest.
      { nextIndex: index + 1, restFirst: false };
}

/** "A1", "B2". The label a lifter expects on a superset. */
export function supersetLabel<T extends SupersetMember>(
  exercises: T[],
  index: number,
): string | null {
  const group = exercises[index]?.supersetGroup;
  const pos = positionInGroup(exercises, index);
  if (!group || !pos) return null;
  return `${group}${pos.position}`;
}

/**
 * Assign the next unused group label.
 *
 * Letters, because "A1/A2" is what a program written on paper says. Falls back
 * to numbers past Z rather than failing - a 27-superset workout is absurd, but
 * returning undefined for it would be a crash rather than an absurdity.
 */
export function nextGroupLabel<T extends SupersetMember>(exercises: T[]): string {
  const used = new Set(exercises.map((e) => e.supersetGroup).filter(Boolean) as string[]);
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    if (!used.has(letter)) return letter;
  }
  return String(used.size + 1);
}
