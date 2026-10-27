import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { DownloadPhoto } from "../../src/lib/photo-downloads";

const mocks = vi.hoisted(() => ({ selected: new Set<string>(), deliver: vi.fn(), prepare: vi.fn(), build: vi.fn(), trigger: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: () => {},
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [value instanceof Set ? mocks.selected : value, vi.fn()],
}));
vi.mock("../../src/lib/photo-downloads", async (original) => ({
  ...await original<typeof import("../../src/lib/photo-downloads")>(),
  preparePhotoExport: mocks.prepare,
  deliverPhotoFile: mocks.deliver,
  buildPhotoZip: mocks.build,
  triggerDownload: mocks.trigger,
}));
import { usePhotoDownloads } from "../../src/components/photo-download-controls";

const photo: DownloadPhoto = { id: "a", storage_path: "a", url: "signed", uploaded_by: "cleaner", uploader_name: "Cleaner" };
function clickableElements(node: unknown): ReactElement<{ onClick: () => Promise<void> }>[] {
  if (Array.isArray(node)) return node.flatMap(clickableElements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<{ onClick?: () => Promise<void>; children?: unknown }>;
  return [...(element.props.onClick ? [element as ReactElement<{ onClick: () => Promise<void> }>] : []), ...clickableElements(element.props.children)];
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.selected = new Set();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  mocks.prepare.mockImplementation(async (items: DownloadPhoto[]) => ({ files: items.map(p => ({ photoId: p.id, blob: new Blob([p.id], { type: "image/png" }), filename: `${p.id}.png` })), failures: [], failedPhotos: [] }));
  mocks.build.mockResolvedValue(new Blob(["zip"], { type: "application/zip" }));
});
describe("photo download actions", () => {
  it("downloads all on a one-photo job as an image, not a ZIP", async () => {
    const downloads = usePhotoDownloads([photo], { date: "2026-10-27", property: "Test" });
    await clickableElements(downloads.toolbar)[0].props.onClick();
    expect(mocks.deliver).toHaveBeenCalledWith(expect.objectContaining({ type: "image/png" }), "a.png");
    expect(mocks.build).not.toHaveBeenCalled();
  });
  it("downloads a single selected photo as an image from a larger collection", async () => {
    mocks.selected.add("a");
    const downloads = usePhotoDownloads([photo, { ...photo, id: "b", storage_path: "b" }], { date: "2026-10-27", property: "Test" });
    await clickableElements(downloads.toolbar)[2].props.onClick();
    expect(mocks.prepare.mock.calls[0][0].map((p: DownloadPhoto) => p.id)).toEqual(["a"]);
    expect(mocks.deliver).toHaveBeenCalledWith(expect.objectContaining({ type: "image/png" }), "a.png");
    expect(mocks.build).not.toHaveBeenCalled();
  });
  it("retains one flat ZIP for multi-photo downloads", async () => {
    const downloads = usePhotoDownloads([photo, { ...photo, id: "b", storage_path: "b" }], { date: "2026-10-27", property: "Test" });
    await clickableElements(downloads.toolbar)[0].props.onClick();
    expect(mocks.build.mock.calls[0][0]).toHaveLength(2);
    expect(mocks.trigger).toHaveBeenCalledWith(expect.objectContaining({ type: "application/zip" }), "Test_2026-10-27_photos.zip");
  });
});