import type Anthropic from "@anthropic-ai/sdk";

/**
 * Everything FitBot can see and everything it can ask to do.
 *
 * Ivo, 2026-09-10: "make sure fitbot has access to every single part of FitYear
 * and can act on any of it."
 *
 * The split is the whole design, and it is not a limitation - it is what makes
 * "act on any of it" safe enough to be worth having:
 *
 * **READ tools run immediately.** They are database reads scoped to the calling
 * user, so the model can look at anything without a round trip through the UI.
 *
 * **WRITE tools are PROPOSALS.** The model does not perform them. Calling one
 * ends the turn and hands the client a structured action, which the client
 * renders for approval and then executes against the app's OWN API routes with
 * the user's session. Nothing here re-implements a write.
 *
 * Two reasons it is built this way rather than letting the loop write directly:
 *
 * 1. Ivo asked for exactly this shape: "it analyzes, tells me what it sees, and
 *    I approve/deny/change what it is going to do."
 * 2. Every write guarantee this app has lives in its route handlers - exercise
 *    name canonicalisation, the duplicate guard, userId scoping on tables with
 *    no foreign keys, the idempotent completed-workout save. A second write
 *    path would have to reproduce all of it and would drift the first time one
 *    changed.
 */

/** Which endpoint the client calls when the user approves a proposal. */
export type ProposalRequest = {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
};

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
        limit: { type: "integer", description: "How many workouts, newest first. Default 10, max 30." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_exercises",
    description:
      "Search the shared exercise catalog by name or muscle group. Use this before proposing any exercise so you reuse an existing one rather than creating a near-duplicate.",
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
      "The user's preferences: weight unit for display, monthly workout goal, default training focus and time zone.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

/**
 * Proposals. Each maps to an endpoint the CLIENT calls after approval.
 *
 * `summary` is required on every one of them because the user reads it before
 * deciding. A proposal the user cannot understand is one they cannot
 * meaningfully approve, which would make the confirmation step theater.
 */
export const WRITE_TOOLS: Anthropic.Tool[] = [
  {
    name: "propose_routine_change",
    description:
      "Propose replacing a routine's days. Send the COMPLETE new set of days: days you omit are deleted. dayIndex is a position in the rotation and the gaps are the rest days, so a 4-day week in a 7-day cycle is 1, 3, 5, 6 and never 1, 2, 3, 4. Reps stay free text ('6-8', 'AMRAP', '30s') and are never collapsed to a number.",
    input_schema: {
      type: "object",
      properties: {
        routineId: { type: "string" },
        summary: { type: "string", description: "One sentence the user will read before approving." },
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
                    targetLoadLbs: { type: "number" },
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

/** The tool names that are proposals rather than reads. */
export const WRITE_TOOL_NAMES = new Set(WRITE_TOOLS.map((t) => t.name));

export const ALL_TOOLS: Anthropic.Tool[] = [...READ_TOOLS, ...WRITE_TOOLS];

export function isWriteTool(name: string): boolean {
  return WRITE_TOOL_NAMES.has(name);
}
