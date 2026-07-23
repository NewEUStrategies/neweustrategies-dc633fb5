import { createFileRoute } from "@tanstack/react-router";
import { ThemeOptionsPane } from "@/components/admin/ThemeOptionsPane";
import { DesignSubNav } from "@/components/admin/DesignSubNav";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";

function ThemeOptionsError(props: Parameters<typeof RouteErrorFallback>[0]) {
  return <RouteErrorFallback {...props} variant="admin" />;
}

export const Route = createFileRoute("/admin/theme-options")({
  head: () => ({
    meta: [
      { title: "Opcje motywu - Panel administracyjny" },
      { name: "description", content: "Ustawienia wyglądu, nagłówka i elementów motywu." },
      { property: "og:title", content: "Opcje motywu - Panel administracyjny" },
      { property: "og:description", content: "Ustawienia wyglądu, nagłówka i elementów motywu." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  errorComponent: ThemeOptionsError,
  notFoundComponent: () => null,
  component: () => (
    <>
      <DesignSubNav />
      <ThemeOptionsPane />
    </>
  ),
});
