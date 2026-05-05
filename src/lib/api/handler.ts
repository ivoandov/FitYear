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
      console.error("[api]", e);
      const message = e instanceof Error ? e.message : "Internal Server Error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}
