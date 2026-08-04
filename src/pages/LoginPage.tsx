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
  password: z.string().min(6, 'Password must be at least 6 characters'),
});
type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: FormValues) {
    setLoading(true);
    const { error } = await signIn(values.email, values.password);
    setLoading(false);
    if (error) {
      toast.error(error.message || 'Sign-in failed. Please try again.');
      return;
    }
    navigate('/dashboard');
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
            Contract intelligence<br />for legal teams.
          </h1>
          <p className="text-muted-foreground text-base leading-relaxed max-w-sm text-pretty">
            Automated compliance audits, risk scoring, and AI-suggested clause alternatives — all in one secure workspace.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} ClauseGuard. Enterprise-grade security.
        </p>
      </div>

      {/* Right: form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-10 lg:hidden">
            <ShieldCheck className="h-6 w-6 text-accent" strokeWidth={1.5} />
            <span className="font-semibold text-base">ClauseGuard</span>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mb-1">Sign in</h2>
          <p className="text-sm text-muted-foreground mb-8">
            Welcome back. Enter your credentials to continue.
          </p>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="you@organization.com"
                        className="px-3 h-10"
                        {...field}
                      />
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
                          placeholder="••••••••"
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
              <Button type="submit" className="w-full h-10 font-medium" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </Form>

          <p className="mt-6 text-sm text-center text-muted-foreground">
            Don&apos;t have an account?{' '}
            <Link to="/register" className="text-accent-foreground font-medium underline-offset-4 hover:underline" style={{ color: 'hsl(var(--accent))' }}>
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
