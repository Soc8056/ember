// Supabase client — loaded straight from a CDN so there is no build step (PRD: no bundler).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { ENV, HAS_SUPABASE } from './config.js';

export { HAS_SUPABASE };

export const supabase = HAS_SUPABASE
  ? createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,          // AUTH-4: session survives app launches
        autoRefreshToken: true,
        detectSessionInUrl: true,      // completes the magic-link redirect
        flowType: 'pkce',
      },
    })
  : null;
