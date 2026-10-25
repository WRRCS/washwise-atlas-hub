// Compare content, never filenames or the mere presence of property text.
export function normalizeSopContent(text: string) {
  return text.normalize("NFKC").replace(/[\u200b\u00ad\u2022\u25cf]/g, "").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2010-\u2014]/g, "-").replace(/\s+/g, "").trim();
}

export function sopContentIsCovered(documentText: string, readableText: string) {
  const document = normalizeSopContent(documentText);
  const readable = normalizeSopContent(readableText);
  return document.length > 0 && readable.includes(document);
}

export function distinctSopAttachments<T extends { id: string; storage_path: string }>(attachments: T[]) {
  const ids = new Set<string>();
  const paths = new Set<string>();
  return attachments.filter((attachment) => {
    if (ids.has(attachment.id) || paths.has(attachment.storage_path)) return false;
    ids.add(attachment.id);
    paths.add(attachment.storage_path);
    return true;
  });
}