import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { I18nProvider, useI18n } from "@/lib/i18n/context";
import { readRequestLocale } from "@/lib/i18n/request-locale";
import { translate } from "@/lib/i18n/translate";
import { localeFromMatches } from "@/lib/i18n/page-title";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  beforeLoad: async () => ({ locale: await readRequestLocale() }),
  head: ({ matches }) => {
    const locale = localeFromMatches(matches);
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "KLYVONA Connect" },
        { name: "description", content: translate(locale, "meta.homeDescription") },
        { name: "theme-color", content: "#F7F6F9" },
      ],
      links: [
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700&family=Noto+Sans:wght@400;500;600;700&display=swap",
        },
        { rel: "stylesheet", href: appCss },
        { rel: "manifest", href: "/__grok/manifest.webmanifest" },
        { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      ],
    };
  },
  component: RootShell,
});

function RootShell() {
  const { locale } = Route.useRouteContext();
  return (
    <I18nProvider initialLocale={locale}>
      <Document />
    </I18nProvider>
  );
}

function Document() {
  const { lang, dir } = useI18n();
  return (
    <html lang={lang} dir={dir} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="overflow-x-clip">
        <PreviewHostBridge />
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}
