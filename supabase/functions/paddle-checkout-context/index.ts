import { createClient } from 'npm:@supabase/supabase-js@2';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
} as const;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const contextSecret = Deno.env.get('PADDLE_CONTEXT_SECRET');
  if (!supabaseUrl || !anonKey || !serviceKey || !contextSecret) {
    console.error('Paddle checkout context configuration is incomplete.');
    return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  const authorization = req.headers.get('Authorization');
  if (!authorization?.match(/^Bearer\s+\S+$/i)) {
    return new Response(JSON.stringify({ error: 'Authentication is required' }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError) {
    console.error('Could not load Paddle checkout organization:', profileError.message);
    return new Response(JSON.stringify({ error: 'Could not load organization billing details' }), {
      status: 500,
      headers: corsHeaders,
    });
  }
  if (!profile?.organization_id) {
    return new Response(JSON.stringify({ error: 'Organization profile is unavailable' }), {
      status: 409,
      headers: corsHeaders,
    });
  }
  const { data: organization, error: organizationError } = await serviceClient
    .from('organizations')
    .select('owner_id')
    .eq('id', profile.organization_id)
    .maybeSingle();
  if (organizationError || !organization) {
    console.error('Could not verify Paddle checkout organization:', organizationError?.message);
    return new Response(JSON.stringify({ error: 'Could not verify billing organization' }), {
      status: 500,
      headers: corsHeaders,
    });
  }
  if (organization.owner_id !== user.id) {
    return new Response(JSON.stringify({ error: 'Only the workspace owner can start a subscription' }), {
      status: 403,
      headers: corsHeaders,
    });
  }

  const organizationSignature = await signOrganization(profile.organization_id, contextSecret);
  return new Response(JSON.stringify({
    organization_id: profile.organization_id,
    organization_signature: organizationSignature,
  }), {
    status: 200,
    headers: corsHeaders,
  });
});

async function signOrganization(organizationId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(organizationId)
  ));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}
