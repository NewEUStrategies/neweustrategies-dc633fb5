// Atom: plakietka statusu wersji dokumentu prawnego.
import { Badge } from "@/components/ui/badge";
import type { LegalVersionStatus } from "@/lib/legal/types";

const LABELS: Record<LegalVersionStatus | "baseline", { pl: string; en: string }> = {
  published: { pl: "Opublikowana", en: "Published" },
  draft: { pl: "Szkic", en: "Draft" },
  archived: { pl: "Archiwum", en: "Archived" },
  baseline: { pl: "Wersja z kodu", en: "Code baseline" },
};

export function VersionStatusBadge({
  status,
  lang,
}: {
  status: LegalVersionStatus | "baseline";
  lang: "pl" | "en";
}) {
  const variant =
    status === "published" ? "default" : status === "draft" ? "secondary" : "outline";
  return (
    <Badge variant={variant} className="text-[0.6875rem]">
      {LABELS[status][lang]}
    </Badge>
  );
}
