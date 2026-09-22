import type Anthropic from "@anthropic-ai/sdk";

/**
 * Everything FitBot can see, everything it can remember, and everything it can
 * ask to do.
 *
 * Ivo, 2026-09-10: "make sure fitbot has access to every single part of FitYear
 * and can act on any of it." Then 2026-09-17, asking for real memory: "i want
 * this to truly feel like your own fitness coach that doesnt have silly
 * restrictions."
 *
 * There are THREE categories and the differences between them are the design:
 *
 * **READ tools run immediately.** Database reads scoped to the calling user, so
 * the model can look at anything without a round trip through the UI.
 *
 * **MEMORY tools run immediately, and they WRITE.** They are the deliberate
 * exception to the rule below, and the reasoning is specific rather than
 * convenient. That rule exists because this app's write guarantees live in its
 * route handlers - name canonicalisation, the duplicate guard, userId scoping
 * on tables with no foreign keys, the idempotent save - and a second write path
 * would have to reproduce all of them. A coach note has exactly ONE such
 * guarantee, userId scoping, and `lib/api/coach-notes.ts` is the single
 * implementation that carries it for both this and the Settings screen. Against
 * that, requiring approval for every remembered fact would mean a coach that
 * asks permission to know your shoulder hurts, which is precisely the silly
 * restriction Ivo is describing. The safety comes from VISIBILITY instead:
 * every note is listed and deletable in Settings, the model is told to say what
 * it recorded, and a note can never alter training data - it is text in a
 * prompt, not a change to a routine.
 *
 * **PROPOSAL tools do not run at all.** Calling one ends the turn and hands the
 * client a structured action, which the client renders for approval and then
 * executes against the app's OWN API routes with the user's session. Nothing
 * here re-implements a write. This is the shape Ivo asked for: "it analyzes,
 * tells me what it sees, and I approve/deny/change what it is going to do."
 *
 * If you add a tool, decide which of the three it is and put it in that list.
 * A proposal that executes in the loop is still a bug; a memory write that asks
 * for approval is still a coach with amnesia.
 */

/** Which endpoint the client calls when the user approves a proposal. */
export type ProposalRequest = {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
};

/**
 * How many workouts `list_recent_workouts` returns. The description the model
 * reads is built from these, so it cannot promise a ceiling the code does not
 * honor: it said "max 30" while the code stopped at 15, and the model asked for
 * 30 and was silently handed half.
 */
export const RECENT_WORKOUTS_DEFAULT = 10;
export const RECENT_WORKOUTS_MAX = 15;

/** The model's `limit`, clamped. Anything missing or unusable means the default. */
export function recentWorkoutsLimit(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 1) return RECENT_WORKOUTS_DEFAULT;
  return Math.min(Math.floor(n), RECENT_WORKOUTS_MAX);
}

export const READ_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_training_summary",
    description:
      "How this user has actually been training: hard sets per week per muscle group, which groups are behind their own baseline, their most-used exercises per group, and total workouts. Start here for any question about what they should train next.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_active_program",
    description:
      "The routine the user is currently running, the exercises prescribed for each of its days, and a plan-versus-actual comparison of every session they have completed against it: exercises they added, exercises they skipped, and set counts they changed. Use this to notice drift from the plan. Returns null when no program is running.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_routines",
    description: "Every routine the user owns, with its day count and whether it is currently running.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_routine",
    description: "One routine in full: every day, in rotation order, with the exercises prescribed for it.",
    input_schema: {
      type: "object",
      properties: { routineId: { type: "string" } },
      required: ["routineId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_recent_workouts",
    description:
      "Recently completed workouts with the exercises and completed sets actually logged. Use it to see what they have really been lifting, including weights and reps.",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: `How many workouts, newest first. Default ${RECENT_WORKOUTS_DEFAULT}, max ${RECENT_WORKOUTS_MAX}; a larger number returns ${RECENT_WORKOUTS_MAX}.`,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_exercises",
    description:
      "Search for an exercise by name or muscle group. Returns TWO lists and the difference matters. `inCatalog` are exercises that already exist for this user - reuse one of these by its exact name wherever you can, so their history stays joined up. `standardNames` are recognised exercise names that do NOT exist yet, offered so you propose a standard name rather than inventing one; proposing one creates it. Always search before naming any exercise, and prefer a catalog entry, then a standard name, and only invent a name when neither has the movement you mean.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Part of an exercise name." },
        muscleGroup: { type: "string", description: "A coarse muscle group, e.g. Back, Legs, Biceps." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_upcoming_workouts",
    description: "Workouts already scheduled from today onward, with the date and exercises planned for each.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_body_measurements",
    description: "Recent body measurements: weight, body fat percentage and circumferences, newest first.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_personal_records",
    description: "The user's best recorded set per exercise, for talking about progress on a specific lift.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "integer", description: "Default 20." } },
      additionalProperties: false,
    },
  },
  {
    name: "get_settings",
    description:
      "The user's preferences: weight unit for display, monthly workout goal, default training focus, time zone, and daysPerWeekTarget - how many days a week they said they can realistically train. Check that before proposing any program: training more days than they said they have is the fastest way to write a plan they will not follow.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

/**
 * Memory. These EXECUTE, and they are the only writes in this file that do.
 *
 * The header of this module explains why. The short version: a note is text in
 * a prompt rather than a change to anyone's training, the single write helper
 * carries the only guarantee that applies, and every note is visible and
 * deletable in Settings - so the cost of getting one wrong is the person
 * deleting a line, not a corrupted routine.
 *
 * Note the deliberate asymmetry in `update_memory` and `forget`: the model is
 * told, in the system prompt and in these descriptions, not to quietly rewrite
 * something the person stated themselves. What someone tells you about their
 * own body outranks what you inferred about it.
 */
export const MEMORY_TOOLS: Anthropic.Tool[] = [
  {
    name: "remember",
    description:
      "Record something about this person that will still matter in a month, so you know it in every future conversation. Use it the moment you learn a goal, an injury or physical limitation, what equipment they have, when they can train, a strong preference, or something the two of you agreed to do. Do not use it for anything you can already read with a tool - their workouts, weights and records are all readable, and duplicating them here is noise. Say in your reply what you noted.",
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["goal", "constraint", "preference", "context", "agreement"],
          description:
            "constraint = a hard rule you must never propose around (injury, missing equipment, a day they cannot train). goal = what they are training for. preference = a leaning you may push back on. context = a life fact that affects training. agreement = something you both decided.",
        },
        content: {
          type: "string",
          description:
            "One specific fact, in plain language, that will read correctly to you months from now with no other context. 'Left shoulder painful on overhead pressing since Aug 2026, fine on incline' rather than 'shoulder issue'.",
        },
        expiresOn: {
          type: "string",
          description:
            "YYYY-MM-DD, only when the fact stops being true on a known date, such as travel or a deload block. Omit for anything permanent. A fact with no end date and no expiry set is how memory turns into clutter.",
        },
      },
      required: ["kind", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "update_memory",
    description:
      "Revise something you already know, using the id shown in your memory. Prefer this over remembering a second, contradictory version: if their goal changes or an injury resolves, the old fact should become the new one rather than sitting beside it. Do not rewrite a note marked as stated by the person themselves without asking them first.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The id in square brackets in your memory." },
        kind: {
          type: "string",
          enum: ["goal", "constraint", "preference", "context", "agreement"],
        },
        content: { type: "string" },
        expiresOn: { type: "string", description: "YYYY-MM-DD, or empty string to clear it." },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "forget",
    description:
      "Drop something you know that has stopped being true or was wrong. Use it freely: a wrong fact about someone's body is worse than no fact. Do not delete a note marked as stated by the person themselves unless they ask you to.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The id in square brackets in your memory." },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
];

/**
 * Proposals. Each maps to an endpoint the CLIENT calls after approval.
 *
 * `summary` is required on every one of them because the user reads it before
 * deciding. A proposal the user cannot understand is one they cannot
 * meaningfully approve, which would make the confirmation step theater.
 */
export const PROPOSAL_TOOLS: Anthropic.Tool[] = [
  {
    name: "propose_routine_change",
    description:
      "Propose replacing a routine's days. Send the COMPLETE new set of days: days you omit are deleted. dayIndex is a position in the rotation and the gaps are the rest days, so a 4-day week in a 7-day cycle is 1, 3, 5, 6 and never 1, 2, 3, 4. Reps stay free text ('6-8', 'AMRAP', '30s') and are never collapsed to a number.",
    input_schema: {
      type: "object",
      properties: {
        routineId: { type: "string" },
        summary: { type: "string", description: "One sentence the user will read before approving." },
        progression: {
          type: "object",
          description:
            "The routine's DEFAULT progressive-overload rule, applied to every exercise that has a starting weight and no rule of its own. Send null to turn progression off. Omit the field entirely to leave the current setting alone.",
          properties: {
            incrementLbs: { type: "number" },
            everyWeeks: { type: "integer" },
          },
          required: ["incrementLbs", "everyWeeks"],
        },
        days: {
          type: "array",
          items: {
            type: "object",
            properties: {
              dayIndex: { type: "integer" },
              workoutName: { type: "string" },
              exercises: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    sets: { type: "integer" },
                    reps: { type: "string", description: "Free text. Never a number." },
                    rest: { type: "integer", description: "Seconds." },
                    notes: { type: "string" },
                    targetLoadLbs: {
                      type: "number",
                      description:
                        "The STARTING working weight in pounds. Progression climbs from here, so an exercise without one never gets a computed target.",
                    },
                    progression: {
                      type: "object",
                      description:
                        "Overrides the routine's default progression FOR THIS EXERCISE. Set it where the routine's one rule does not fit: a squat tolerates bigger jumps than a lateral raise. Omit it to inherit the routine default. It replaces that default whole rather than merging with it.",
                      properties: {
                        incrementLbs: { type: "number", description: "Pounds added each step." },
                        everyWeeks: {
                          type: "integer",
                          description: "Weeks at each load before adding. 1 means every week.",
                        },
                      },
                      required: ["incrementLbs", "everyWeeks"],
                    },
                  },
                  required: ["name", "sets", "reps"],
                },
              },
            },
            required: ["dayIndex", "workoutName", "exercises"],
          },
        },
      },
      required: ["routineId", "summary", "days"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_start_routine",
    description:
      "Propose STARTING a routine: it schedules the routine's days across the calendar from a start date and creates the program that tracks progress against it. This is also how a finished routine is RUN AGAIN, and how a program is made longer - starting it again with a bigger durationWeeks is what extends it. The routine must not already be running (list_routines says which is); a running one answers 409 and must be finished or cancelled by the user first. Omit durationWeeks to use the routine's own default length.",
    input_schema: {
      type: "object",
      properties: {
        routineId: { type: "string" },
        startDate: {
          type: "string",
          description: "The calendar day it begins, YYYY-MM-DD, in the user's own dates. Today or later.",
        },
        durationWeeks: {
          type: "integer",
          description: "How many WEEKS to schedule. Whole weeks, because the rotation repeats on weeks.",
        },
        summary: { type: "string", description: "One sentence the user will read before approving." },
      },
      required: ["routineId", "startDate", "summary"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_program_resync",
    description:
      "Propose pushing a routine's current contents onto the sessions already scheduled from today onward. Only offer this after a routine change, and only when a program is running. Set removeOrphaned when the change dropped a day and its already-scheduled sessions should go with it; leave it false to keep them on the calendar.",
    input_schema: {
      type: "object",
      properties: {
        routineId: { type: "string" },
        removeOrphaned: { type: "boolean" },
        summary: { type: "string" },
      },
      required: ["routineId", "summary"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_schedule_workout",
    description: "Propose putting a new workout on a specific date. The date is a calendar day the user chose, in YYYY-MM-DD.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD." },
        exercises: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              sets: { type: "integer" },
              reps: { type: "string" },
            },
            required: ["name"],
          },
        },
        summary: { type: "string" },
      },
      required: ["name", "date", "exercises", "summary"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_update_scheduled_workout",
    description: "Propose changing one already-scheduled workout: its name, its date, or the exercises in it.",
    input_schema: {
      type: "object",
      properties: {
        scheduledWorkoutId: { type: "string" },
        name: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD." },
        exercises: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              sets: { type: "integer" },
              reps: { type: "string" },
            },
            required: ["name"],
          },
        },
        summary: { type: "string" },
      },
      required: ["scheduledWorkoutId", "summary"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_delete_scheduled_workout",
    description: "Propose removing an upcoming scheduled workout from the calendar.",
    input_schema: {
      type: "object",
      properties: {
        scheduledWorkoutId: { type: "string" },
        summary: { type: "string" },
      },
      required: ["scheduledWorkoutId", "summary"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_create_exercise",
    description:
      "Propose adding a new exercise to the shared catalog. Search first: the catalog is shared by every user and a near-duplicate fragments history. Muscle groups must come from the app's coarse list.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        muscleGroups: { type: "array", items: { type: "string" } },
        exerciseType: {
          type: "string",
          enum: ["weight_reps", "bodyweight_reps", "weight_time", "distance_time"],
        },
        summary: { type: "string" },
      },
      required: ["name", "muscleGroups", "summary"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_log_measurement",
    description: "Propose recording a body measurement for a given day. Weight is in POUNDS; convert if the user speaks in kilos.",
    input_schema: {
      type: "object",
      properties: {
        measuredOn: { type: "string", description: "YYYY-MM-DD." },
        weightLbs: { type: "number" },
        bodyFatPct: { type: "number" },
        notes: { type: "string" },
        summary: { type: "string" },
      },
      required: ["measuredOn", "summary"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_update_settings",
    description: "Propose changing a preference: display weight unit, monthly workout goal, or default training focus.",
    input_schema: {
      type: "object",
      properties: {
        weightUnit: { type: "string", enum: ["lbs", "kg"] },
        monthlyWorkoutGoal: { type: "integer" },
        fitbotDefaultFocus: { type: "string" },
        summary: { type: "string" },
      },
      required: ["summary"],
      additionalProperties: false,
    },
  },
];

/**
 * Turn an approved proposal into the request the client should send.
 *
 * Every path here is an endpoint that already existed and that the UI already
 * uses, which is the point: an approved proposal takes exactly the same code
 * path as the user doing it by hand, so it inherits exercise-name
 * canonicalisation, the duplicate guard and userId scoping for free.
 *
 * The per-tool shaping is why this is a function rather than a field map. The
 * model proposes `days`, but a routine is written as `entries`, and the two are
 * not the same shape - collapsing that difference into a generic field copier
 * would have sent the model's vocabulary straight to the database.
 *
 * Returns null for an unknown tool rather than throwing, so a model that
 * invents a tool name cannot break the page.
 */
export function buildProposalRequest(
  tool: string,
  input: Record<string, unknown>,
): ProposalRequest | null {
  switch (tool) {
    case "propose_routine_change": {
      const days = Array.isArray(input.days) ? input.days : [];
      return {
        method: "PUT",
        path: `/api/routines/${input.routineId}`,
        body: {
          // Only sent when the model named it: a PUT carrying undefined would
          // read as "leave alone", but an explicit null CLEARS the rule, and
          // the two must not be confused.
          ...(input.progression !== undefined ? { progression: input.progression } : {}),
          entries: days.map((d) => {
            const day = d as Record<string, unknown>;
            return {
              dayIndex: day.dayIndex,
              workoutName: day.workoutName,
              // Days FitBot writes are always inline, never template-backed.
              workoutTemplateId: null,
              exercises: day.exercises ?? [],
            };
          }),
        },
      };
    }
    case "propose_start_routine": {
      // Weeks in, days out. The model and the user talk in weeks; the route
      // takes days, and its own repetition logic lays the rotation out across
      // whole weeks. A non-numeric or absent value sends nothing, which the
      // route reads as the routine's own default length rather than zero days.
      const weeks = Number(input.durationWeeks);
      const durationDays =
        Number.isFinite(weeks) && weeks >= 1 ? Math.floor(weeks) * 7 : undefined;
      return {
        method: "POST",
        path: `/api/routines/${input.routineId}/start`,
        body: {
          startDate: input.startDate,
          ...(durationDays !== undefined ? { durationDays } : {}),
        },
      };
    }
    case "propose_program_resync":
      return {
        method: "POST",
        path: `/api/routines/${input.routineId}/update-active-instances`,
        body: { removeOrphaned: input.removeOrphaned === true },
      };
    case "propose_schedule_workout":
      return {
        method: "POST",
        path: "/api/scheduled-workouts",
        body: {
          name: input.name,
          date: input.date,
          exercises: input.exercises ?? [],
        },
      };
    case "propose_update_scheduled_workout": {
      const body: Record<string, unknown> = {};
      // Only the fields the model actually named: a PUT carrying undefined
      // would blank a value the user never asked to change.
      if (input.name !== undefined) body.name = input.name;
      if (input.date !== undefined) body.date = input.date;
      if (input.exercises !== undefined) body.exercises = input.exercises;
      return {
        method: "PUT",
        path: `/api/scheduled-workouts/${input.scheduledWorkoutId}`,
        body,
      };
    }
    case "propose_delete_scheduled_workout":
      return {
        method: "DELETE",
        path: `/api/scheduled-workouts/${input.scheduledWorkoutId}`,
      };
    case "propose_create_exercise":
      return {
        method: "POST",
        path: "/api/exercises",
        body: {
          name: input.name,
          muscleGroups: input.muscleGroups ?? [],
          exerciseType: input.exerciseType ?? "weight_reps",
          description: "",
        },
      };
    case "propose_log_measurement": {
      const body: Record<string, unknown> = { measuredOn: input.measuredOn };
      if (input.weightLbs !== undefined) body.weightLbs = input.weightLbs;
      if (input.bodyFatPct !== undefined) body.bodyFatPct = input.bodyFatPct;
      if (input.notes !== undefined) body.notes = input.notes;
      return { method: "POST", path: "/api/body-measurements", body };
    }
    case "propose_update_settings": {
      const body: Record<string, unknown> = {};
      if (input.weightUnit !== undefined) body.weightUnit = input.weightUnit;
      if (input.monthlyWorkoutGoal !== undefined)
        body.monthlyWorkoutGoal = input.monthlyWorkoutGoal;
      if (input.fitbotDefaultFocus !== undefined)
        body.fitbotDefaultFocus = input.fitbotDefaultFocus;
      return { method: "PATCH", path: "/api/user-settings", body };
    }
    default:
      return null;
  }
}

/** The tool names that END THE TURN and are handed to the user to approve. */
export const PROPOSAL_TOOL_NAMES = new Set(PROPOSAL_TOOLS.map((t) => t.name));

/** The tool names that write memory and execute in the loop. */
export const MEMORY_TOOL_NAMES = new Set(MEMORY_TOOLS.map((t) => t.name));

export const ALL_TOOLS: Anthropic.Tool[] = [
  ...READ_TOOLS,
  ...MEMORY_TOOLS,
  ...PROPOSAL_TOOLS,
];

export function isProposalTool(name: string): boolean {
  return PROPOSAL_TOOL_NAMES.has(name);
}

export function isMemoryTool(name: string): boolean {
  return MEMORY_TOOL_NAMES.has(name);
}
