import { describe, it, expect } from "vitest";
import { xmlEscape } from "@/lib/voice-ai.server";

describe("xmlEscape", () => {
  it("escapes XML special characters", () => {
    expect(xmlEscape(`<a href="x">'foo' & "bar"</a>`))
      .toBe("&lt;a href=&quot;x&quot;&gt;&apos;foo&apos; &amp; &quot;bar&quot;&lt;/a&gt;");
  });

  it("returns plain text unchanged", () => {
    expect(xmlEscape("Hello there.")).toBe("Hello there.");
  });

  it("handles empty string", () => {
    expect(xmlEscape("")).toBe("");
  });
});
