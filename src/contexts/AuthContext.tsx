import React, { createContext, useContext, useEffect, useState } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/db/supabase';
import type { Profile } from '@/types/types';
import { toast } from 'sonner';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, organizationName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let activeUserId: string | null = null;
    let profileRequestId = 0;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextUserId = nextSession?.user.id ?? null;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (nextUserId === activeUserId) return;

      activeUserId = nextUserId;
      const requestId = ++profileRequestId;
      if (!nextUserId) {
        setProfile(null);
        setLoading(false);
        return;
      }

      setProfile(null);
      setLoading(true);
      queueMicrotask(async () => {
        try {
          const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', nextUserId)
            .maybeSingle();
          if (error) throw error;
          if (mounted && requestId === profileRequestId) setProfile(data as Profile | null);
        } catch (error) {
          if (mounted && requestId === profileRequestId) {
            toast.error('Could not load your organization profile. Refresh and try again.');
            setProfile(null);
          }
        } finally {
          if (mounted && requestId === profileRequestId) setLoading(false);
        }
      });
    });

    return () => {
      mounted = false;
      profileRequestId += 1;
      subscription.unsubscribe();
    };
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  }

  async function signUp(email: string, password: string, organizationName: string) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { organization_name: organizationName } },
    });
    return { error: error as Error | null };
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
