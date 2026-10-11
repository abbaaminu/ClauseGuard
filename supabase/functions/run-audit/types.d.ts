declare module 'npm:@supabase/supabase-js@2' {
  export { createClient } from '@supabase/supabase-js';
  export type { SupabaseClient } from '@supabase/supabase-js';
}

declare module 'npm:zod@3.25.76' {
  export { z } from 'zod';
}

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  env: {
    get(key: string): string | undefined;
  };
};
