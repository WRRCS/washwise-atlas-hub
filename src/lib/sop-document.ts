export type SopDocumentKind = "pdf" | "image" | "text" | "unsupported";

export function sopDocumentKind(filename: string): SopDocumentKind {
  const extension = filename.toLowerCase().split(".").pop();
  if (extension === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(extension ?? "")) return "image";
  if (["txt", "md", "csv"].includes(extension ?? "")) return "text";
  return "unsupported";
}

export function isImportedSopPlaceholder(title: string) {
  return title.trim().toLowerCase() === "refer to attached document";
}