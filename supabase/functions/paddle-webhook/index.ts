import { createClient } from 'npm:@supabase/supabase-js@2';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

const jsonHeaders = { 'Content-Type': 'application/json' };

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  const webhookSecret = Deno.env.get('PADDLE_WEBHOOK_SECRET');
  const contextSecret = Deno.env.get('PADDLE_CONTEXT_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const starterPriceId = Deno.env.get('PADDLE_STARTER_PRICE_ID');
  const proPriceId = Deno.env.get('PADDLE_PRO_PRICE_ID');
  if (!webhookSecret || !contextSecret || !supabaseUrl || !serviceKey || !starterPriceId || !proPriceId) {
    console.error('Paddle webhook configuration is incomplete.');
    return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  const rawBody = await req.text();
  const signatureHeader = req.headers.get('Paddle-Signature') ?? '';
  if (!await verifySignature(rawBody, signatureHeader, webhookSecret)) {
    return new Response(JSON.stringify({ error: 'Invalid Paddle signature' }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  let event: PaddleEvent;
  try {
    event = JSON.parse(rawBody) as PaddleEvent;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid event body' }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const subscriptionEvents = new Set([
    'subscription.created',
    'subscription.updated',
    'subscription.activated',
    'subscription.resumed',
    'subscription.paused',
    'subscription.canceled',
  ]);
  if (!subscriptionEvents.has(event.event_type)) {
    return new Response(JSON.stringify({ received: true, ignored: true }), {
      status: 200,
      headers: jsonHeaders,
    });
  }

  const data = event.data;
  const organizationId = data.custom_data?.organization_id;
  const currentPeriod = data.current_billing_period;
  const firstItem = data.items?.[0];
  const priceId = firstItem?.price?.id;
  const occurredAt = Date.parse(event.occurred_at);
  if (
    typeof event.event_id !== 'string'
    || typeof data.id !== 'string'
    || typeof data.status !== 'string'
    || !Number.isFinite(occurredAt)
    || !['active', 'trialing', 'past_due', 'canceled', 'paused'].includes(data.status)
    || (data.status === 'active' && typeof priceId !== 'string')
  ) {
    return new Response(JSON.stringify({ error: 'Invalid subscription event fields' }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const verifiedOrganizationId = isUuid(organizationId)
    && await verifyOrganizationContext(
      organizationId,
      data.custom_data?.organization_signature,
      contextSecret
    )
    ? organizationId
    : null;
  const { error } = await supabase.rpc('sync_paddle_subscription', {
    p_event_id: event.event_id,
    p_organization_id: verifiedOrganizationId,
    p_customer_id: typeof data.customer_id === 'string' ? data.customer_id : null,
    p_subscription_id: data.id,
    p_status: data.status,
    p_price_id: typeof priceId === 'string' ? priceId : null,
    p_starter_price_id: starterPriceId,
    p_pro_price_id: proPriceId,
    p_period_start: validIsoDate(currentPeriod?.starts_at),
    p_period_end: validIsoDate(currentPeriod?.ends_at),
    p_occurred_at: new Date(occurredAt).toISOString(),
  });

  if (error) {
    console.error('Paddle subscription synchronization failed:', error.message);
    return new Response(JSON.stringify({ error: 'Subscription update failed' }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: jsonHeaders,
  });
});

interface PaddleEvent {
  event_id: string;
  event_type: string;
  occurred_at: string;
  data: {
    id: string;
    status: string;
    customer_id?: string | null;
    custom_data?: { organization_id?: string; organization_signature?: string } | null;
    current_billing_period?: { starts_at?: string | null; ends_at?: string | null } | null;
    items?: Array<{ price?: { id?: string } | null }>;
  };
}

async function verifySignature(
  body: string,
  header: string,
  secret: string
): Promise<boolean> {
  const parts = header.split(';').map(part => part.trim());
  const timestamp = parts.find(part => part.startsWith('ts='))?.slice(3);
  const signatures = parts.filter(part => part.startsWith('h1=')).map(part => part.slice(3));
  if (!timestamp || signatures.length === 0 || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

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
    new TextEncoder().encode(`${timestamp}:${body}`)
  ));
  const expected = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  return signatures.some(signature => constantTimeEqual(signature, expected));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function verifyOrganizationContext(
  organizationId: string,
  signature: string | undefined,
  secret: string
): Promise<boolean> {
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
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
  const expected = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  return constantTimeEqual(signature, expected);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validIsoDate(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}
