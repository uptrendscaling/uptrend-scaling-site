import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { trackEvent } from "../lib/analytics.server";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">
          Page not found
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back
          home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    head: () => ({
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "UpTrend Scaling" },
        {
          name: "description",
          content: "Google review automation for local businesses.",
        },
        { name: "author", content: "UpTrend Scaling, LLC" },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:site", content: "@Lovable" },
      ],
      links: [
        {
          rel: "stylesheet",
          href: appCss,
        },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        {
          rel: "preconnect",
          href: "https://fonts.gstatic.com",
          crossOrigin: "anonymous",
        },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700&family=Inter:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap",
        },
        { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      ],
    }),
    shellComponent: RootShell,
    component: RootComponent,
    notFoundComponent: NotFoundComponent,
    errorComponent: ErrorComponent,
  },
);

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

// ---- Site analytics tracking (inlined here, not a separate component
// file, to keep this to as few directories as possible) -------------------
// Mounted once at the root, so it covers every page including the
// logged-in /app and /admin areas -- that's how the admin dashboard knows
// which businesses are currently logged in, without a separate mechanism.
// Fully best-effort: every call is fire-and-forget and swallows its own
// errors, so a tracking hiccup (or an ad blocker) never affects the site.

const VISITOR_ID_KEY = "uptrend_vid";
const SESSION_ID_KEY = "uptrend_sid";
const HEARTBEAT_INTERVAL_MS = 25_000;

function readOrCreateId(storage: Storage, key: string): string {
  try {
    const existing = storage.getItem(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    storage.setItem(key, created);
    return created;
  } catch {
    // Private browsing / blocked storage -- fall back to an id that's only
    // good for this one page load rather than breaking tracking entirely.
    return crypto.randomUUID();
  }
}

function useSiteAnalytics(pathname: string) {
  useEffect(() => {
    const visitorId = readOrCreateId(window.localStorage, VISITOR_ID_KEY);
    const sessionId = readOrCreateId(window.sessionStorage, SESSION_ID_KEY);

    void trackEvent({
      data: { visitorId, sessionId, kind: "pageview", path: pathname },
    }).catch(() => {});

    const heartbeat = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void trackEvent({
        data: {
          visitorId,
          sessionId,
          kind: "heartbeat",
          path: window.location.pathname,
        },
      }).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    function handleClick(event: MouseEvent) {
      const target = (event.target as HTMLElement | null)?.closest("a, button");
      if (!target) return;
      const label = (
        target.getAttribute("aria-label") ||
        target.textContent ||
        ""
      )
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 100);
      void trackEvent({
        data: {
          visitorId,
          sessionId,
          kind: "click",
          path: window.location.pathname,
          label: label || undefined,
        },
      }).catch(() => {});
    }
    document.addEventListener("click", handleClick, { capture: true });

    return () => {
      window.clearInterval(heartbeat);
      document.removeEventListener("click", handleClick, { capture: true });
    };
  }, [pathname]);
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useSiteAnalytics(pathname);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
