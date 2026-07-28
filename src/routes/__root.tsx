import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";
import { AppSplash } from "@/components/app-splash";

type IOSSplash = { device: string; w: number; h: number; ratio: number; dw: number; dh: number };
const IOS_SPLASH: IOSSplash[] = [
  { device: "iphone-15-pro-max", w: 1290, h: 2796, ratio: 3, dw: 430, dh: 932 },
  { device: "iphone-15-pro",     w: 1179, h: 2556, ratio: 3, dw: 393, dh: 852 },
  { device: "iphone-14-plus",    w: 1284, h: 2778, ratio: 3, dw: 428, dh: 926 },
  { device: "iphone-14",         w: 1170, h: 2532, ratio: 3, dw: 390, dh: 844 },
  { device: "iphone-x",          w: 1125, h: 2436, ratio: 3, dw: 375, dh: 812 },
  { device: "iphone-xr",         w: 828,  h: 1792, ratio: 2, dw: 414, dh: 896 },
  { device: "iphone-8",          w: 750,  h: 1334, ratio: 2, dw: 375, dh: 667 },
  { device: "ipad-pro-12",       w: 2048, h: 2732, ratio: 2, dw: 1024, dh: 1366 },
  { device: "ipad-pro-11",       w: 1668, h: 2388, ratio: 2, dw: 834, dh: 1194 },
  { device: "ipad-mini",         w: 1536, h: 2048, ratio: 2, dw: 768, dh: 1024 },
];

const iosSplashLinks = IOS_SPLASH.flatMap((s) => [
  {
    rel: "apple-touch-startup-image",
    href: `/splash/${s.device}.png`,
    media: `(device-width: ${s.dw}px) and (device-height: ${s.dh}px) and (-webkit-device-pixel-ratio: ${s.ratio}) and (orientation: portrait)`,
  },
  {
    rel: "apple-touch-startup-image",
    href: `/splash/${s.device}-landscape.png`,
    media: `(device-width: ${s.dw}px) and (device-height: ${s.dh}px) and (-webkit-device-pixel-ratio: ${s.ratio}) and (orientation: landscape)`,
  },
]);

if (typeof window !== "undefined") {
  void import("../lib/sentry-browser").then((m) => m.initSentryClient());
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-medium text-foreground tracking-tight">404</h1>
        <h2 className="mt-4 text-xl font-medium text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          That page doesn't exist in Atlas.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:opacity-90"
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
        <h1 className="text-xl font-medium tracking-tight text-foreground">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Try again or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:opacity-90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#3b82f6" },
      { title: "Atlas — Wash Rinse Repeat Cleaning" },
      { name: "description", content: "Internal field service management for Wash Rinse Repeat Cleaning: jobs, scheduling, SOPs, invoicing." },
      { property: "og:title", content: "Atlas — Wash Rinse Repeat Cleaning" },
      { property: "og:description", content: "Internal field service management for Wash Rinse Repeat Cleaning: jobs, scheduling, SOPs, invoicing." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "twitter:title", content: "Atlas — Wash Rinse Repeat Cleaning" },
      { name: "twitter:description", content: "Internal field service management for Wash Rinse Repeat Cleaning: jobs, scheduling, SOPs, invoicing." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/50f631e2-33dd-4294-85d7-ff8b3e23ce39/id-preview-ab85c438--d344868a-ce88-407a-a141-0f3d42ef0e99.lovable.app-1783111080692.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/50f631e2-33dd-4294-85d7-ff8b3e23ce39/id-preview-ab85c438--d344868a-ce88-407a-a141-0f3d42ef0e99.lovable.app-1783111080692.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&display=swap",
      },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/wrrc-apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

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

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster />
    </QueryClientProvider>
  );
}
