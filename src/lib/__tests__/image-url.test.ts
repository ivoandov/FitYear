import { describe, it, expect } from "vitest";
import { rewriteImageUrl } from "@/lib/image-url";

describe("rewriteImageUrl", () => {
  it("prefixes legacy /objects paths with /api", () => {
    expect(rewriteImageUrl("/objects/public/exercises/bench.jpg")).toBe(
      "/api/objects/public/exercises/bench.jpg",
    );
  });

  it("maps /generated_images to the /api/objects/exercises proxy", () => {
    expect(rewriteImageUrl("/generated_images/squat.jpg")).toBe(
      "/api/objects/exercises/squat.jpg",
    );
  });

  it("passes http and https URLs through unchanged", () => {
    expect(rewriteImageUrl("http://example.com/a.jpg")).toBe("http://example.com/a.jpg");
    expect(rewriteImageUrl("https://storage.googleapis.com/b.jpg")).toBe(
      "https://storage.googleapis.com/b.jpg",
    );
  });

  it("returns null for null/undefined/empty", () => {
    expect(rewriteImageUrl(null)).toBeNull();
    expect(rewriteImageUrl(undefined)).toBeNull();
    expect(rewriteImageUrl("")).toBeNull();
  });

  it("leaves an already-proxied path unchanged", () => {
    expect(rewriteImageUrl("/api/objects/public/x.jpg")).toBe("/api/objects/public/x.jpg");
  });
});
