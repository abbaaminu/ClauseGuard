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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const paddleApiKey = Deno.env.get('PADDLE_API_KEY');
  const starterPriceId = Deno.env.get('PADDLE_STARTER_PRICE_ID');
  const proPriceId = Deno.env.get('PADDLE_PRO_PRICE_ID');
  const environment = Deno.env.get('PADDLE_ENVIRONMENT') ?? 'sandbox';
  if (
    !supabaseUrl || !anonKey || !serviceKey || !paddleApiKey
    || !starterPriceId || !proPriceId
    || !['sandbox', 'production'].includes(environment)
  ) {
    console.error('Paddle plan change configuration is incomplete.');
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

  let request: { tier?: unknown };
  try {
    request = await req.json() as { tier?: unknown };
  } catch {
    return new Response(JSON.stringify({ error: 'A plan tier is required' }), {
      status: 400,
      headers: corsHeaders,
    });
  }
  if (request.tier !== 'starter' && request.tier !== 'pro') {
    return new Response(JSON.stringify({ error: 'Unsupported plan tier' }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const serviceClient = createClient(supabaseUrl, serviceKey);
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError || !profile?.organization_id) {
    console.error('Could not resolve the billing organization:', profileError?.message);
    return new Response(JSON.stringify({ error: 'Organization profile is unavailable' }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  const { data: organization, error: organizationError } = await serviceClient
    .from('organizations')
    .select('owner_id, plan_tier, billing_status, paddle_subscription_id')
    .eq('id', profile.organization_id)
    .maybeSingle();
  if (organizationError) {
    console.error('Could not load the billing subscription:', organizationError.message);
    return new Response(JSON.stringify({ error: 'Could not load subscription details' }), {
      status: 500,
      headers: corsHeaders,
    });
  }
  if (!organization || organization.owner_id !== user.id) {
    return new Response(JSON.stringify({ error: 'Only the workspace owner can change its plan' }), {
      status: 403,
      headers: corsHeaders,
    });
  }
  if (
    !organization.paddle_subscription_id
    || !['active', 'trialing'].includes(organization.billing_status)
  ) {
    return new Response(JSON.stringify({ error: 'No active Paddle subscription can be changed' }), {
      status: 409,
      headers: corsHeaders,
    });
  }

  const targetPriceId = request.tier === 'starter' ? starterPriceId : proPriceId;
  const apiBaseUrl = environment === 'sandbox'
    ? 'https://sandbox-api.paddle.com'
    : 'https://api.paddle.com';
  const paddleResponse = await fetch(
    `${apiBaseUrl}/subscriptions/${encodeURIComponent(organization.paddle_subscription_id)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${paddleApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [{ price_id: targetPriceId, quantity: 1 }],
        proration_billing_mode: 'prorated_immediately',
      }),
    }
  );

  if (!paddleResponse.ok) {
    await paddleResponse.body?.cancel();
    console.error('Paddle plan update failed with status:', paddleResponse.status);
    return new Response(JSON.stringify({ error: 'Paddle could not update the subscription. Try again or contact support.' }), {
      status: 502,
      headers: corsHeaders,
    });
  }

  return new Response(JSON.stringify({ updated: true, tier: request.tier }), {
    status: 200,
    headers: corsHeaders,
  });
});
