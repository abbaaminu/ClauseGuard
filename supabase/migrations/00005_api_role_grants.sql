-- Grant the browser API roles only the table operations used by the app.
-- Row-level security policies remain responsible for tenant isolation.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

REVOKE ALL ON public.profiles FROM anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;

REVOKE ALL ON public.playbooks FROM anon, authenticated;
GRANT SELECT ON public.playbooks TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.playbooks TO authenticated;

REVOKE ALL ON public.contracts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contracts TO authenticated;

REVOKE ALL ON public.audit_results FROM anon, authenticated;
GRANT SELECT ON public.audit_results TO authenticated;
GRANT INSERT ON public.audit_results TO service_role;

GRANT EXECUTE ON FUNCTION public.auth_org_id() TO anon, authenticated;
