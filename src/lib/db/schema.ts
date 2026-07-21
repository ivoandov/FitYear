import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  integer,
  timestamp,
  jsonb,
  boolean,
  uuid,
  real,
  date,
  index,
  uniqueIndex,
  primaryKey,
  pgSchema,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Reference to Supabase Auth's auth.users table — managed by Supabase, not by us.
// We FK to it from app tables so deletes cascade correctly.
const authSchema = pgSchema("auth");
export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
});

// The coarse muscle-group vocabulary (fixed anatomical order). Source of truth
// for the taxonomy is src/lib/muscle-groups.ts (COARSE_MUSCLE_GROUPS); this
// literal is kept in schema.ts to avoid a client<-schema import and MUST stay in
// sync with it. Drives the Settings muscle manager + the manual create form.
export const DEFAULT_MUSCLE_GROUPS = [
  "Chest",
  "Back",
  "Shoulders",
  "Biceps",
  "Triceps",
  "Forearms",
  "Abs/Core",
  "Legs",
  "Cardio",
  "PT",
] as const;

export function isCustomMuscleGroup(group: string): boolean {
  return !DEFAULT_MUSCLE_GROUPS.map((g) => g.toLowerCase()).includes(
    group.toLowerCase(),
  );
}

export function hasCustomMuscleGroup(groups: string[]): boolean {
  return groups.some((g) => isCustomMuscleGroup(g));
}

// User profile — extends auth.users with app-specific fields. Synced via trigger
// on auth.users insert (set up in Phase 2). One-to-one with auth.users by id.
export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  email: text("email"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  profileImageUrl: text("profile_image_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Note on ID types: legacy DB used varchar for all `id` columns and seeded some
// exercises with non-UUID short ids ("4", etc). Keeping varchar preserves those
// IDs verbatim during migration; new rows still default to gen_random_uuid()
// which produces a UUID stored as text. Only auth.users.id (Supabase) is uuid.
export const exercises = pgTable(
  "exercises",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").references(() => authUsers.id, {
      onDelete: "cascade",
    }),
    isPublic: boolean("is_public").notNull().default(true),
    name: text("name").notNull(),
    muscleGroups: jsonb("muscle_groups").notNull().default([]),
    description: text("description").notNull(),
    imageUrl: text("image_url"),
    exerciseType: text("exercise_type").notNull().default("weight_reps"),
    isAssisted: boolean("is_assisted").notNull().default(false),
  },
  (t) => [index("exercises_user_id_idx").on(t.userId)],
);

export const workoutTemplates = pgTable(
  "workout_templates",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").references(() => authUsers.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    exercises: jsonb("exercises").notNull(),
  },
  (t) => [index("workout_templates_user_id_idx").on(t.userId)],
);

export const scheduledWorkouts = pgTable(
  "scheduled_workouts",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").references(() => authUsers.id, {
      onDelete: "cascade",
    }),
    templateId: varchar("template_id"),
    name: text("name").notNull(),
    date: timestamp("date").notNull(),
    exercises: jsonb("exercises").notNull(),
    calendarEventId: varchar("calendar_event_id"),
    routineInstanceId: varchar("routine_instance_id"),
    routineDayIndex: integer("routine_day_index"),
  },
  (t) => [
    index("scheduled_workouts_user_id_idx").on(t.userId),
    index("scheduled_workouts_routine_instance_id_idx").on(t.routineInstanceId),
  ],
);

export const completedWorkouts = pgTable(
  "completed_workouts",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").references(() => authUsers.id, {
      onDelete: "cascade",
    }),
    templateId: varchar("template_id"),
    displayId: text("display_id").notNull(),
    name: text("name").notNull(),
    // Phase 4d: the per-set data lives in workout_exercises / workout_sets. The
    // legacy `exercises` jsonb column was retired here (renamed to
    // exercises_legacy in the DB as a parachute, pending a final drop).
    completedAt: timestamp("completed_at").notNull().defaultNow(),
    startedAt: timestamp("started_at"),
    durationSeconds: integer("duration_seconds"),
    calendarEventId: varchar("calendar_event_id"),
    routineInstanceId: varchar("routine_instance_id"),
    routineDayIndex: integer("routine_day_index"),
  },
  (t) => [
    index("completed_workouts_user_id_idx").on(t.userId),
    index("completed_workouts_user_id_completed_at_idx").on(
      t.userId,
      t.completedAt.desc(),
    ),
    // Idempotency backstop for the save path: the same client-generated
    // displayId can only be recorded once per user (see the POST route's
    // duplicate handling). Applied to prod via scripts/apply-workout-display-unique.ts.
    uniqueIndex("completed_workouts_user_display_unique").on(
      t.userId,
      t.displayId,
    ),
  ],
);

export const userSettings = pgTable("user_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  selectedCalendarId: varchar("selected_calendar_id"),
  selectedCalendarName: text("selected_calendar_name"),
  weightUnit: text("weight_unit").default("lbs"),
  monthlyWorkoutGoal: integer("monthly_workout_goal").default(16),
  fitbotDefaultFocus: text("fitbot_default_focus").default("strength"),
  hasCompletedOnboarding: boolean("has_completed_onboarding")
    .notNull()
    .default(false),
  onboardingDaysPerWeek: integer("onboarding_days_per_week"),
  onboardingProgramLength: integer("onboarding_program_length"),
});

export const activeWorkouts = pgTable("active_workouts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  workoutData: jsonb("workout_data").notNull(),
  trackingProgress: jsonb("tracking_progress"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const routines = pgTable(
  "routines",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    defaultDurationDays: integer("default_duration_days").notNull().default(7),
    // Rotation period in days for FitBot rotating-cycle programs (the number of
    // days in one repeat of the workout/rest cycle). Null for manual routines and
    // legacy weekday-split routines, which fall back to the M-S weekday strip on
    // the Routines card. Set by ai/save-program from the assembled program's
    // cycleLength so the card can show the true rotation, not a 7-day collapse.
    cycleLength: integer("cycle_length"),
    isPublic: boolean("is_public").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("routines_user_id_idx").on(t.userId)],
);

export const routineEntries = pgTable(
  "routine_entries",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    routineId: varchar("routine_id")
      .notNull()
      .references(() => routines.id, { onDelete: "cascade" }),
    dayIndex: integer("day_index").notNull(),
    workoutTemplateId: varchar("workout_template_id"),
    workoutName: text("workout_name"),
    exercises: jsonb("exercises"),
  },
  (t) => [index("routine_entries_routine_id_idx").on(t.routineId)],
);

export const routineInstances = pgTable(
  "routine_instances",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    routineId: varchar("routine_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    routineName: text("routine_name").notNull(),
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date").notNull(),
    durationDays: integer("duration_days").notNull(),
    totalWorkouts: integer("total_workouts").notNull().default(0),
    completedWorkouts: integer("completed_workouts").notNull().default(0),
    skippedWorkouts: integer("skipped_workouts").notNull().default(0),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (t) => [index("routine_instances_user_id_idx").on(t.userId)],
);

export const exerciseGoals = pgTable(
  "exercise_goals",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    exerciseId: varchar("exercise_id").notNull(),
    exerciseName: text("exercise_name").notNull(),
    targetReps: integer("target_reps").notNull(),
    period: text("period").notNull().default("week"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("exercise_goals_user_id_idx").on(t.userId)],
);

export const googleCalendarTokens = pgTable("google_calendar_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  refreshToken: text("refresh_token").notNull(),
  accessToken: text("access_token"),
  expiresAt: timestamp("expires_at"),
  connectedAt: timestamp("connected_at").notNull().defaultNow(),
});

// New table for the Workout Complete + History PR Tab features.
export const prHistory = pgTable(
  "pr_history",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    exerciseId: varchar("exercise_id").notNull(),
    workoutId: varchar("workout_id").notNull(),
    prType: text("pr_type").notNull(),
    newValue: real("new_value").notNull(),
    previousValue: real("previous_value"),
    achievedAt: timestamp("achieved_at").notNull().defaultNow(),
  },
  (t) => [
    index("pr_history_user_id_idx").on(t.userId),
    index("pr_history_user_id_achieved_at_idx").on(
      t.userId,
      t.achievedAt.desc(),
    ),
  ],
);

// Per-user, per-day counter for paid AI/Imagen endpoints. One row per
// (user, UTC day, kind); enforceDailyQuota upsert-increments and 429s past the
// limit. Caps runaway Anthropic/Vertex spend from a single authed user.
export const aiUsage = pgTable(
  "ai_usage",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    kind: text("kind").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day, t.kind] })],
);

// --- Phase 4: sets-as-rows (normalized storage) ---
// These sit ALONGSIDE completed_workouts.exercises (jsonb) during the
// migration. The jsonb stays the source of truth until reads are switched over
// (Phase 4c) and the column is dropped (Phase 4d, gated). Snapshots
// (name/muscleGroups/type/isAssisted) are copied inline so a workout still
// renders correctly if its library exercise is later renamed or deleted.
export const workoutExercises = pgTable(
  "workout_exercises",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    completedWorkoutId: varchar("completed_workout_id")
      .notNull()
      .references(() => completedWorkouts.id, { onDelete: "cascade" }),
    exerciseId: varchar("exercise_id").notNull(),
    position: integer("position").notNull(),
    nameSnapshot: text("name_snapshot"),
    muscleGroupsSnapshot: jsonb("muscle_groups_snapshot"),
    exerciseType: text("exercise_type"),
    isAssisted: boolean("is_assisted"),
  },
  (t) => [index("workout_exercises_completed_workout_id_idx").on(t.completedWorkoutId)],
);

export const workoutSets = pgTable(
  "workout_sets",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    workoutExerciseId: varchar("workout_exercise_id")
      .notNull()
      .references(() => workoutExercises.id, { onDelete: "cascade" }),
    setNumber: integer("set_number").notNull(),
    weightLbs: real("weight_lbs"),
    reps: integer("reps"),
    distance: real("distance"),
    time: integer("time"),
    completed: boolean("completed").notNull().default(false),
  },
  (t) => [index("workout_sets_workout_exercise_id_idx").on(t.workoutExerciseId)],
);

export type WorkoutExercise = typeof workoutExercises.$inferSelect;
export type WorkoutSet = typeof workoutSets.$inferSelect;

// Zod schemas
export const insertExerciseSchema = createInsertSchema(exercises).omit({
  id: true,
});
export const insertUserSettingsSchema = createInsertSchema(userSettings).omit({
  id: true,
});
export const insertWorkoutTemplateSchema = createInsertSchema(
  workoutTemplates,
).omit({ id: true });
export const insertScheduledWorkoutSchema = createInsertSchema(
  scheduledWorkouts,
).omit({ id: true });
export const insertCompletedWorkoutSchema = createInsertSchema(
  completedWorkouts,
).omit({ id: true });
export const insertActiveWorkoutSchema = createInsertSchema(
  activeWorkouts,
).omit({ id: true });
export const insertRoutineSchema = createInsertSchema(routines).omit({
  id: true,
  createdAt: true,
});
export const insertRoutineEntrySchema = createInsertSchema(
  routineEntries,
).omit({ id: true });
export const insertRoutineInstanceSchema = createInsertSchema(
  routineInstances,
).omit({ id: true, createdAt: true, completedAt: true });
export const insertExerciseGoalSchema = createInsertSchema(exerciseGoals).omit({
  id: true,
  createdAt: true,
});
export const insertGoogleCalendarTokensSchema = createInsertSchema(
  googleCalendarTokens,
).omit({ id: true, connectedAt: true });
export const insertProfileSchema = createInsertSchema(profiles).omit({
  createdAt: true,
  updatedAt: true,
});
export const insertPrHistorySchema = createInsertSchema(prHistory).omit({
  id: true,
  achievedAt: true,
});

// Inferred types
export type Profile = typeof profiles.$inferSelect;
export type Exercise = typeof exercises.$inferSelect;
export type WorkoutTemplate = typeof workoutTemplates.$inferSelect;
export type ScheduledWorkout = typeof scheduledWorkouts.$inferSelect;
export type CompletedWorkout = typeof completedWorkouts.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
export type ActiveWorkout = typeof activeWorkouts.$inferSelect;
export type Routine = typeof routines.$inferSelect;
export type RoutineEntry = typeof routineEntries.$inferSelect;
export type RoutineInstance = typeof routineInstances.$inferSelect;
export type ExerciseGoal = typeof exerciseGoals.$inferSelect;
export type GoogleCalendarTokens = typeof googleCalendarTokens.$inferSelect;
export type PrHistory = typeof prHistory.$inferSelect;
export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type InsertExercise = z.infer<typeof insertExerciseSchema>;
export type InsertExerciseGoal = z.infer<typeof insertExerciseGoalSchema>;
export type InsertWorkoutTemplate = z.infer<typeof insertWorkoutTemplateSchema>;
export type InsertScheduledWorkout = z.infer<
  typeof insertScheduledWorkoutSchema
>;
export type InsertCompletedWorkout = z.infer<
  typeof insertCompletedWorkoutSchema
>;
export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;
export type InsertActiveWorkout = z.infer<typeof insertActiveWorkoutSchema>;
export type InsertRoutine = z.infer<typeof insertRoutineSchema>;
export type InsertRoutineEntry = z.infer<typeof insertRoutineEntrySchema>;
export type InsertRoutineInstance = z.infer<typeof insertRoutineInstanceSchema>;
export type InsertGoogleCalendarTokens = z.infer<
  typeof insertGoogleCalendarTokensSchema
>;
export type InsertPrHistory = z.infer<typeof insertPrHistorySchema>;
