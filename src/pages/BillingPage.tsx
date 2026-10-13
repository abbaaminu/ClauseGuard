import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Check, CreditCard, RefreshCw, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/layouts/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/contexts/AuthContext';
import { env } from '@/lib/env';
import { changePaddlePlan, getAuditUsage, getPaddleCheckoutContext } from '@/services/api';
import type { AuditUsage } from '@/types/types';

const paddleScriptUrl = 'https://cdn.paddle.com/paddle/v2/paddle.js';

const tiers = [
  {
    tier: 'starter' as const,
    title: 'Starter',
    price: '$5',
    audits: '25 audits each month',
    features: ['Standard playbooks', 'Plain-text and PDF extraction', 'PDF audit report downloads'],
    priceId: env.VITE_PADDLE_STARTER_PRICE_ID,
  },
  {
    tier: 'pro' as const,
    title: 'Pro',
    price: '$15',
    audits: '150 audits each month',
    features: ['Custom weighted playbooks', 'Team workspace collaboration', 'Priority PDF report exports', 'DOCX extraction'],
    priceId: env.VITE_PADDLE_PRO_PRICE_ID,
  },
];

export default function BillingPage() {
  const { user, profile } = useAuth();
  const [usage, setUsage] = useState<AuditUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutReady, setCheckoutReady] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [paddleError, setPaddleError] = useState<string | null>(null);
  const initializedRef = useRef(false);

  async function refreshUsage() {
    setLoading(true);
    try {
      setUsage(await getAuditUsage());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load billing usage.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshUsage();
  }, []);

  useEffect(() => {
    if (!env.VITE_PADDLE_CLIENT_TOKEN) return;

    const initialize = () => {
      if (!window.Paddle || initializedRef.current) return;
      if (env.VITE_PADDLE_ENVIRONMENT === 'sandbox') {
        window.Paddle.Environment.set('sandbox');
      }
      window.Paddle.Initialize({
        token: env.VITE_PADDLE_CLIENT_TOKEN!,
        eventCallback: (event) => {
          if (event.name === 'checkout.completed') {
            toast.success('Checkout completed. Your subscription will activate when Paddle confirms it.');
            window.setTimeout(() => void refreshUsage(), 1500);
          }
        },
      });
      initializedRef.current = true;
      setCheckoutReady(true);
    };

    if (window.Paddle) {
      initialize();
      return;
    }

    let script = document.querySelector<HTMLScriptElement>(`script[src="${paddleScriptUrl}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = paddleScriptUrl;
      script.async = true;
      document.head.append(script);
    }
    script.addEventListener('load', initialize);
    script.addEventListener('error', () => {
      setPaddleError('Paddle checkout could not load. Check your connection and try again.');
    }, { once: true });
    return () => script?.removeEventListener('load', initialize);
  }, []);

  async function startCheckout(tier: 'starter' | 'pro', priceId?: string) {
    if (!usage?.is_workspace_owner) {
      toast.error('Only the workspace owner can manage the subscription.');
      return;
    }
    if (!window.Paddle || !profile?.organization_id || !priceId || !user) {
      toast.error('Paddle checkout is not configured. Add the client token and price IDs to the deployment environment.');
      return;
    }

    setCheckoutLoading(true);
    try {
      if (
        usage?.plan_tier !== 'free'
        && ['active', 'trialing'].includes(usage?.billing_status ?? '')
      ) {
        await changePaddlePlan(tier);
        toast.success('Plan change submitted. Paddle is updating your subscription.');
        window.setTimeout(() => void refreshUsage(), 2000);
      } else {
        const context = await getPaddleCheckoutContext();
        window.Paddle.Checkout.open({
          items: [{ priceId, quantity: 1 }],
          customer: user.email ? { email: user.email } : undefined,
          customData: {
            organization_id: context.organization_id,
            organization_signature: context.organization_signature,
            tier,
          },
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Paddle checkout could not be started.');
    } finally {
      setCheckoutLoading(false);
    }
  }

  const isCurrentPlan = (tier: 'starter' | 'pro') =>
    usage?.plan_tier === tier && ['active', 'trialing'].includes(usage.billing_status);
  const available = Boolean(env.VITE_PADDLE_CLIENT_TOKEN && checkoutReady);

  return (
    <div className="px-4 md:px-8 py-8 max-w-6xl mx-auto w-full">
      <PageHeader
        title="Plans & usage"
        subtitle="Start with three free audits, then choose a low-cost monthly plan."
        action={<Button variant="outline" size="sm" onClick={() => void refreshUsage()} disabled={loading}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>}
      />

      <Card className="mb-8">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <CreditCard className="h-4 w-4" /> Current usage
          </CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pt-5">
          <div>
            <p className="text-lg font-semibold capitalize">
              {loading ? 'Loading…' : `${usage?.plan_tier ?? 'free'} plan`}
              {usage?.billing_status === 'active' && <Badge className="ml-2">Active</Badge>}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {usage?.plan_tier && usage.plan_tier !== 'free'
                ? `${usage.monthly_audits_used} of ${usage.monthly_audits_limit} audits used this month`
                : `${usage?.free_audits_remaining ?? 0} of 3 free audits remaining`}
            </p>
          </div>
          <p className="text-xs text-muted-foreground max-w-md">
            No credit card is required for the free audits. Plan limits are shared by everyone in your organization.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        {tiers.map((tier) => (
          <Card key={tier.tier} className={tier.tier === 'pro' ? 'border-accent/50' : ''}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{tier.title}</CardTitle>
                {isCurrentPlan(tier.tier) && <Badge>Current plan</Badge>}
              </div>
              <p className="text-3xl font-semibold">{tier.price}<span className="text-sm font-normal text-muted-foreground"> / month</span></p>
              <p className="text-sm text-muted-foreground">{tier.audits}</p>
            </CardHeader>
            <Separator />
            <CardContent className="pt-5">
              <ul className="space-y-3 mb-6">
                {tier.features.map(feature => (
                  <li key={feature} className="flex items-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-green-600 shrink-0" /> {feature}
                  </li>
                ))}
              </ul>
              <Button
                className="w-full"
                variant={tier.tier === 'pro' ? 'default' : 'outline'}
                disabled={!available || !tier.priceId || checkoutLoading || isCurrentPlan(tier.tier) || !usage?.is_workspace_owner}
                onClick={() => startCheckout(tier.tier, tier.priceId)}
              >
                {isCurrentPlan(tier.tier)
                  ? 'Current plan'
                  : usage?.plan_tier !== 'free' && ['active', 'trialing'].includes(usage?.billing_status ?? '')
                    ? `Change to ${tier.title}`
                    : 'Upgrade with Paddle'}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {usage && !usage.is_workspace_owner && (
        <p className="mt-5 text-sm text-muted-foreground">Only the workspace owner can start or change a subscription.</p>
      )}
      {(!available || paddleError) && (
        <p role="status" className="mt-5 text-sm text-amber-700 dark:text-amber-400">
          {paddleError ?? 'Checkout setup is incomplete. Configure the Paddle client token and both monthly price IDs to enable upgrades.'}
        </p>
      )}
      <div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-4 w-4" />
        <span>Secure checkout powered by Paddle. <Link to="/dashboard" className="underline">Return to your workspace</Link>.</span>
      </div>
    </div>
  );
}
