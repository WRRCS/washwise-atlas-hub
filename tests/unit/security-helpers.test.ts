import { describe, expect, it } from "vitest";
import { csvCell, toCsv, neutralizeCsvText } from "../../src/lib/csv";
import { isAppUrl } from "../../src/lib/app-origin";

describe("formula-safe spreadsheet cells", () => {
  it("neutralizes text a spreadsheet would run", () => {
    expect(neutralizeCsvText("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")");
    expect(neutralizeCsvText("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(neutralizeCsvText("+1+2")).toBe("'+1+2");
    expect(csvCell("-2+3")).toBe(`"'-2+3"`);
  });
  it("keeps plain numbers and normal text", () => {
    expect(neutralizeCsvText("-12.50")).toBe("-12.50");
    expect(neutralizeCsvText("Jane Doe")).toBe("Jane Doe");
    expect(toCsv([{ a: "=1+1", b: 5 }])).toBe(`a,b\n"'=1+1",5`);
  });
});

describe("app-only web addresses", () => {
  it("accepts the app's own hosts", () => {
    expect(isAppUrl("https://wrrcs.com/settings/billing")).toBe(true);
    expect(isAppUrl("https://id-preview--d344868a-ce88-407a-a141-0f3d42ef0e99.lovable.app/x")).toBe(true);
    expect(isAppUrl("http://localhost:8080")).toBe(true);
  });
  it("rejects other sites, including other apps on the same platform", () => {
    expect(isAppUrl("https://evil.lovable.app")).toBe(false);
    expect(isAppUrl("https://wrrcs.com.evil.com")).toBe(false);
    expect(isAppUrl("http://wrrcs.com")).toBe(false);
    expect(isAppUrl("https://user:pw@wrrcs.com")).toBe(false);
  });
});
