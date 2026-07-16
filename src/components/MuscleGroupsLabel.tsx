import { nestedMuscleGroups } from "@/lib/muscle-groups";

// Nested muscle subtitle (Design 2026-07-16): coarse group in primary ink,
// its specifics dimmed in parens - "Legs (Glutes, Hamstrings) · Chest", and
// just "Chest" when a group has no specifics. Inherits font size/family from
// the parent (pass those via className); only the ink hierarchy is set here.
export function MuscleGroupsLabel({
  groups,
  className,
}: {
  groups: string[];
  className?: string;
}) {
  const nested = nestedMuscleGroups(groups);
  if (nested.length === 0) return null;
  return (
    <span className={className}>
      {nested.map((g, i) => (
        <span key={g.coarse}>
          {i > 0 ? <span className="text-tertiary-foreground"> · </span> : null}
          <span className="text-foreground">{g.coarse}</span>
          {g.specifics.length ? (
            <span className="text-tertiary-foreground">
              {" "}
              ({g.specifics.join(", ")})
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}
