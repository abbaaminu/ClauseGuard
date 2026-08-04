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
  organization_name: z.string().min(2, 'Organization name must be at least 2 characters'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirm_password: z.string(),
}).refine(d => d.password === d.confirm_password, {
  message: "Passwords don't match",
  path: ['confirm_password'],
});
type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', organization_name: '', password: '', confirm_password: '' },
  });

  async function onSubmit(values: FormValues) {
    setLoading(true);
    const { error } = await signUp(values.email, values.password, values.organization_name);
    setLoading(false);
    if (error) {
      toast.error(error.message || 'Registration failed. Please try again.');
      return;
    }
    toast.success('Account created! Please check your email to verify your account.');
    navigate('/login');
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
            Set up your organization's legal workspace.
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
                    <FormLabel className="text-sm font-medium">Organization name</FormLabel>
                    <FormControl>
                      <Input placeholder="Acme Legal Group" className="px-3 h-10" {...field} />
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
                    <FormControl>
                      <div className="relative">
                        <Input
                          type={showPass ? 'text' : 'password'}
                          placeholder="Min. 8 characters"
                          className="px-3 h-10 pr-10"
                          {...field}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPass(p => !p)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          tabIndex={-1}
                        >
                          {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </FormControl>
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
