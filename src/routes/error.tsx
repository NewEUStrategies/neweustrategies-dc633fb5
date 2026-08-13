// Dedykowana, adresowalna strona błędu. Pozwala przekierować użytkownika
// z konkretnym kodem (np. /error?kind=401) i wyświetlić instrukcję „co kliknąć”.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { FriendlyErrorPage } from "@/components/error/FriendlyErrorPage";
import { errorCopy, type ErrorKind } from "@/lib/errorCopy";
import { SITE_NAME } from "@/lib/seo/meta";

const errorSearchSchema = z.object({
  kind: z.enum(["unauthorized", "sessionExpired", "network", "generic"] as const).optional(),
  title: z.string().optional(),
  footer: z.string().optional(),
});

type ErrorSearch = z.infer<typeof errorSearchSchema>;

export const Route = createFileRoute("/error")({
  validateSearch: (search: Record<string, unknown>): ErrorSearch => {
    const parsed = errorSearchSchema.safeParse(search);
    return parsed.success ? parsed.data : { kind: "generic" };
  },
  head: () => {
    const copy = errorCopy();
    return {
      meta: [
        { title: `${copy.generic.title} - ${SITE_NAME}` },
        { name: "description", content: copy.generic.body },
        { name: "robots", content: "noindex, nofollow" },
      ],
    };
  },
  component: ErrorPage,
});

function ErrorPage() {
  const { kind, title, footer } = Route.useSearch();

  // Build a synthetic error object that FriendlyErrorPage can classify.
  const syntheticError = useSyntheticError(kind);

  return <FriendlyErrorPage error={syntheticError} title={title} footer={footer} />;
}

function useSyntheticError(kind?: ErrorKind): { status: number; message: string } {
  switch (kind) {
    case "unauthorized":
      return { status: 401, message: "unauthorized" };
    case "sessionExpired":
      return { status: 302, message: "session expired" };
    case "network":
      return { status: 0, message: "network error" };
    default:
      return { status: 500, message: "generic error" };
  }
}
