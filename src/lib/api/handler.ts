import { NextResponse } from "next/server";
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
      // Log the real error server-side, but never return it: Drizzle/postgres
      // errors carry SQL fragments, column and constraint names. ApiError
      // messages are intentional + user-safe and handled above.
      console.error("[api]", e);
      return NextResponse.json(
        { error: "Something went wrong. Please try again." },
        { status: 500 },
      );
    }
  };
}
