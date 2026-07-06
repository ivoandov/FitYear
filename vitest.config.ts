import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Mirrors the tsconfig `@/*` -> `./src/*` path alias so unit tests can import
// app modules the same way the app does. Pure-logic tests run in the node
// environment (no DOM needed).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
