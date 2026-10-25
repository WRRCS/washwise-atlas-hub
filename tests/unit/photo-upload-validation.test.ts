import { describe, expect, it } from 'vitest';
import { requireStoredPhoto } from '../../src/lib/photo-upload-validation.server';

function storageResult(data: unknown, error: unknown = null) {
  return { storage: { from: () => ({ list: async () => ({ data, error }) }) } } as unknown as Parameters<typeof requireStoredPhoto>[0];
}
describe('saved image registration', () => {
  it('rejects missing files instead of recording an invented photo', async () => {
    await expect(requireStoredPhoto(storageResult([]), 'tenant/job/cleaner/photo.jpg')).rejects.toThrow('missing or incomplete');
  });
  it('rejects unrelated search results', async () => {
    await expect(requireStoredPhoto(storageResult([{ name: 'other.jpg', metadata: { size: 10, mimetype: 'image/jpeg' } }]), 'tenant/job/cleaner/photo.jpg')).rejects.toThrow();
  });
  it('rejects nonimages and empty uploads', async () => {
    await expect(requireStoredPhoto(storageResult([{ name: 'photo.jpg', metadata: { size: 10, mimetype: 'text/html' } }]), 'tenant/job/cleaner/photo.jpg')).rejects.toThrow();
    await expect(requireStoredPhoto(storageResult([{ name: 'photo.jpg', metadata: { size: 0, mimetype: 'image/jpeg' } }]), 'tenant/job/cleaner/photo.jpg')).rejects.toThrow();
  });
  it('accepts the exact successfully stored image', async () => {
    await expect(requireStoredPhoto(storageResult([{ name: 'photo.jpg', metadata: { size: 350, mimetype: 'image/jpeg' } }]), 'tenant/job/cleaner/photo.jpg')).resolves.toBeUndefined();
  });
});