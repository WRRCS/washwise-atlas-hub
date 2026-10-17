import { describe, expect, it } from "vitest";
import { sopDocumentKind, isImportedSopPlaceholder } from "../../src/lib/sop-document";

describe("saved SOP documents", () => {
  it("reads the saved Word-named PDFs as PDFs", () => {
    expect(sopDocumentKind("BEACH BUM SOP .docx.pdf")).toBe("pdf");
    expect(sopDocumentKind("Fern - Standard Operating Procedures.docx (2).pdf")).toBe("pdf");
  });
  it("supports text and image instructions directly", () => {
    expect(sopDocumentKind("instructions.txt")).toBe("text");
    expect(sopDocumentKind("instructions.JPG")).toBe("image");
  });
  it("does not pretend unrecognized files can be previewed", () => {
    expect(sopDocumentKind("instructions.zip")).toBe("unsupported");
  });
  it("identifies the old download-only placeholder, not real instructions", () => {
    expect(isImportedSopPlaceholder("Refer to attached document")).toBe(true);
    expect(isImportedSopPlaceholder("Clean the kitchen")).toBe(false);
  });
});