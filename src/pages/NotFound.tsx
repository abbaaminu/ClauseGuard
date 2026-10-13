import { Link } from 'react-router-dom';
import PageMeta from '@/components/common/PageMeta';

/**
 * Rendered for unknown paths inside the app shell (`path="*"`). Uses a
 * viewport-relative height so it sits correctly under `AppLayout`'s header.
 */
export default function NotFound() {
  return (
    <>
      <PageMeta
        title="Page not found"
        description="The requested ClauseGuard page does not exist."
      />
      <div className="flex items-center justify-center min-h-[60vh] p-6">
        <div className="mx-auto w-full max-w-md text-center">
          <img
            src="/clauseguard-logo.svg"
            alt=""
            aria-hidden="true"
            className="mx-auto mb-6 h-10 w-10 opacity-80"
          />

          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Error 404
          </p>
          <h1 className="mt-3 text-xl font-semibold tracking-tight">
            Page not found
          </h1>
          <p className="mt-2 text-sm text-muted-foreground text-pretty">
            The page you requested may have been moved or deleted. Check the URL,
            or go back to your dashboard.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/dashboard"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Back to dashboard
            </Link>
            <Link
              to="/playbooks"
              className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
            >
              View playbooks
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
