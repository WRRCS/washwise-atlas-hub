import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

/** Registration must reference a successfully stored image, never an invented path. */
export async function requireStoredPhoto(admin: SupabaseClient<Database>, path: string) {
  const slash = path.lastIndexOf('/');
  const folder = path.slice(0, slash), filename = path.slice(slash + 1);
  const { data, error } = await admin.storage.from('job-photos').list(folder, { search: filename, limit: 100 });
  if (error) throw new Error('Could not verify the uploaded image. Please try again.');
  const file = data?.find(item => item.name === filename);
  if (!file || !file.metadata?.size || !String(file.metadata?.mimetype ?? '').startsWith('image/')) {
    throw new Error('Photo upload is missing or incomplete. Please upload the image again.');
  }
}