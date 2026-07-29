import { describe, it, expect } from "vitest";
import { urlBase64ToUint8Array } from "@/lib/push-client";

describe("urlBase64ToUint8Array", () => {
  it("decodes a base64url VAPID key to raw bytes", () => {
    // "hello" in base64 is aGVsbG8=
    const bytes = urlBase64ToUint8Array("aGVsbG8");
    expect(Array.from(bytes)).toEqual([104, 101, 108, 108, 111]);
  });

  it("restores padding the base64url form omits", () => {
    expect(Array.from(urlBase64ToUint8Array("YQ"))).toEqual([97]); // "a"
    expect(Array.from(urlBase64ToUint8Array("YWI"))).toEqual([97, 98]); // "ab"
    expect(Array.from(urlBase64ToUint8Array("YWJj"))).toEqual([97, 98, 99]); // "abc"
  });

  it("translates the url-safe alphabet (- and _) back to + and /", () => {
    // 0xFB 0xFF encodes as "+/8" in standard base64, "-_8" in base64url.
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([251, 255]);
  });

  it("produces a real ArrayBuffer-backed view for applicationServerKey", () => {
    const bytes = urlBase64ToUint8Array("aGVsbG8");
    expect(bytes.buffer).toBeInstanceOf(ArrayBuffer);
    expect(bytes.byteLength).toBe(5);
  });

  it("decodes a full-length (87 char) VAPID public key to 65 bytes", () => {
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!key) return; // not set in CI - the shape assertions above still hold
    expect(urlBase64ToUint8Array(key).byteLength).toBe(65);
  });
});
