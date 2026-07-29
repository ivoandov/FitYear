import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { ZodError } from "zod";
import { ApiError } from "./auth";

/**
 * Wraps a route handler so any thrown ApiError becomes a JSON response
 * with the right status, and any other thrown error becomes a 500.
 */
export function handle<T extends (...args: never[]) => Promise<Response | unknown>>(
  fn: T,
): (...args: Parameters<T>) => Promise<Response> {
  return async (...args) => {
    try {
      const result = await fn(...args);
      if (result instanceof Response) return result;
      return NextResponse.json(result);
    } catch (e) {
      if (e instanceof ApiError) {
        return NextResponse.json(
          { error: e.message, ...(e.details ? { details: e.details } : {}) },
          { status: e.status },
        );
      }
      // A schema violation is the CALLER's mistake, not a server fault. These
      // were falling through to the 500 branch below: the client got a generic
      // "Something went wrong" for a fixable bad field, and every one was filed
      // in Sentry as a real error, burying genuine failures.
      if (e instanceof ZodError) {
        return NextResponse.json(
          {
            error: "Invalid request",
            details: e.issues.map((i) => ({
              field: i.path.join(".") || "(body)",
              message: i.message,
            })),
          },
          { status: 400 },
        );
      }
      // Log the real error server-side, but never return it: Drizzle/postgres
      // errors carry SQL fragments, column and constraint names. ApiError
      // messages are intentional + user-safe and handled above. Report the
      // genuine 500 to Sentry (ApiError 4xx never reach here, so they aren't
      // reported as errors).
      console.error("[api]", e);
      Sentry.captureException(e);
      return NextResponse.json(
        { error: "Something went wrong. Please try again." },
        { status: 500 },
      );
    }
  };
}
