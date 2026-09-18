/**
 * What to draw, for the exercises whose image came out WRONG from the name.
 *
 * Ivo, 2026-09-18, listed them with what was wrong in each: a Dumbbell Standing
 * Shoulder Press drawn with a barbell on a bench, a Machine Abdominal Crunch
 * holding dumbbells, a strict pull-up with the athlete standing on the floor,
 * a pushdown facing away from the cable.
 *
 * Deliberately a short list and NOT a rule for every exercise. The 2026-09-18
 * experiment gave every exercise a verbose visual brief and it moved the error
 * rather than fixing it: it broke a Nordic curl and a Y-T-W raise the bare name
 * had drawn correctly. The model's prior for a named exercise is usually
 * right, so a correction belongs only where an image has been SEEN to be wrong,
 * and it replaces the catalog description, which is written for a person
 * reading the exercise page rather than for drawing it.
 *
 * Keyed by the catalog NAME, so the app's Regenerate button and every batch
 * script get the same correction and cannot bring a wrong image back. A rename
 * silently detaches its entry; update the key if one is renamed.
 *
 * ONLY wording that produced a better image when it was tried is kept. Four
 * more were attempted and removed: two wordings drew the same fault again
 * (Flat Calf Raises came out as a knee raise twice, even when the prompt said
 * "no knee raise"), and the incline curl and the lying hamstring curl never
 * came right from words at all. Where a fix did work for those, it came from
 * EDITING an existing image with one instruction, which is not something the
 * Regenerate button does.
 */
export const IMAGE_SUBJECTS: Record<string, string> = {
  "Ab Wheel Rollouts":
    "Ab wheel rollout. The athlete kneels on a mat, both hands on the handles of an ab wheel, and has rolled it far forward so the body stretches in a straight line from the knees to the outstretched arms, core braced.",
  "Dumbbell Standing Shoulder Press":
    "Standing dumbbell shoulder press. The athlete stands upright, feet hip width apart, pressing one dumbbell in each hand overhead with the arms nearly straight. No barbell and no bench.",
  "Stairmaster":
    "Stair climber machine, seen from the side. The athlete stands upright on the moving steps facing the machine's console, stepping up onto the next step, hands lightly on the side rails.",
  "Bar Pushdowns":
    "Straight bar triceps pushdown. The athlete stands FACING a cable machine, gripping a short straight bar attached to the high pulley in front of them, elbows tucked at the sides, pushing the bar down until the arms are straight in front of the thighs.",
  "Back Extensions":
    "Back extension on a Roman chair, seen from the side. The hips rest on a padded support at waist height, both heels are hooked under a foot pad at the low back end, and the body forms one straight diagonal line, arms crossed over the chest.",
  "Bulgarian Split Squats":
    "Bulgarian split squat, seen from the side. The front foot is flat on the floor in a deep lunge; the rear leg reaches back with the top of that foot resting on a flat bench, rear knee close to the floor, torso upright.",
  "Reverse Bicep Curls":
    "Reverse grip barbell curl. The athlete stands holding a barbell with an overhand grip, palms facing down and knuckles up, curling it to chest height with the elbows pinned to the sides.",
  "Machine Abdominal Crunch":
    "Seated ab crunch machine. The athlete sits in the machine with the chest against the pad and hands on its handles, crunching the torso forward against the machine's weight stack. No dumbbells.",
  "Neutral Grip Strict Pull-ups Tempo 3-0-1":
    "Neutral grip pull-up on a power rack, seen from the side. The athlete hangs from the rack's parallel handles, palms facing each other, both feet well off the floor with knees slightly bent, chin level with the handles at the top of the pull.",
};

/** The prompt's subject line: a correction where one exists, else name plus description. */
export function imageSubjectFor(exerciseName: string, description?: string | null): string {
  const corrected = IMAGE_SUBJECTS[exerciseName];
  if (corrected) return `Subject: ${corrected}`;
  return `Subject: ${exerciseName}.${description ? ` ${description}` : ""}`;
}
