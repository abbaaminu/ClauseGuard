import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useAuth } from '@/contexts/AuthContext';

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  organization_name: z.string().trim(),
  organization_invite_code: z.string().trim().max(64, 'Invite code is too long'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirm_password: z.string(),
}).refine(d => d.password === d.confirm_password, {
  message: "Passwords don't match",
  path: ['confirm_password'],
}).refine(d => Boolean(d.organization_invite_code) || d.organization_name.length >= 2, {
  message: 'Enter at least 2 characters or use an organization invite code',
  path: ['organization_name'],
});
type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', organization_name: '', organization_invite_code: '', password: '', confirm_password: '' },
  });

  async function onSubmit(values: FormValues) {
    setLoading(true);
    const toastId = toast.loading('Creating your account...');
    try {
      const { error } = await signUp(
        values.email,
        values.password,
        values.organization_name,
        values.organization_invite_code
      );
      if (error) {
        const message = values.organization_invite_code && /database error saving new user/i.test(error.message)
          ? 'This team invite code is invalid, expired, or fully used. Ask your workspace owner for a fresh code.'
          : error.message || 'Registration failed. Please try again.';
        toast.error(message, { id: toastId });
        return;
      }
      toast.success('Account created. Check your email to verify it.', { id: toastId });
      navigate('/login');
    } catch {
      toast.error('Registration failed. Check your connection and try again.', { id: toastId });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left: branding panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-secondary p-12">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-7 w-7 text-accent" strokeWidth={1.5} />
          <span className="text-lg font-semibold tracking-tight">ClauseGuard</span>
        </div>
        <div>
          <h1 className="text-4xl font-semibold tracking-tight leading-tight mb-6 text-balance">
            Start auditing smarter,<br />not harder.
          </h1>
          <ul className="space-y-3 text-muted-foreground text-sm">
            {[
              'AI-powered clause analysis with source citations',
              'Standard playbooks for GDPR, NDA, SaaS, and more',
              'Risk scoring with actionable alternative suggestions',
            ].map(item => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-0.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: 'hsl(var(--accent))', marginTop: 6 }} />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} ClauseGuard. Enterprise-grade security.
        </p>
      </div>

      {/* Right: form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 mb-10 lg:hidden">
            <ShieldCheck className="h-6 w-6 text-accent" strokeWidth={1.5} />
            <span className="font-semibold text-base">ClauseGuard</span>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mb-1">Create account</h2>
          <p className="text-sm text-muted-foreground mb-8">
            Set up your legal workspace and get 3 free contract audits. No credit card required.
          </p>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Work email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="you@organization.com" className="px-3 h-10" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="organization_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Organization name for a new workspace</FormLabel>
                    <FormControl>
                      <Input placeholder="Acme Legal Group" className="px-3 h-10" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="organization_invite_code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Team invite code</FormLabel>
                    <FormControl>
                      <Input placeholder="Optional invite code" className="px-3 h-10" autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Password</FormLabel>
                    <div className="relative">
                      {/* FormControl must wrap the <input> itself: it injects the
                          id/aria-describedby that link this field to its label and
                          error message. The toggle stays a sibling of FormControl so
                          it doesn't swallow those attributes. */}
                      <FormControl>
                        <Input
                          type={showPass ? 'text' : 'password'}
                          placeholder="Min. 8 characters"
                          className="px-3 h-10 pr-10"
                          {...field}
                        />
                      </FormControl>
                      <button
                        type="button"
                        onClick={() => setShowPass(p => !p)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={showPass ? 'Hide passwords' : 'Show passwords'}
                        aria-pressed={showPass}
                      >
                        {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirm_password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Confirm password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" className="px-3 h-10" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full h-10 font-medium" disabled={loading}>
                {loading ? 'Creating account…' : 'Create account'}
              </Button>
            </form>
          </Form>

          <p className="mt-6 text-sm text-center text-muted-foreground">
            Already have an account?{' '}
            <Link to="/login" className="font-medium underline-offset-4 hover:underline" style={{ color: 'hsl(var(--accent))' }}>
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
