// Organizm: wersje dokumentów prawnych (regulamin, prywatność, zwroty).
// Lista wersji + podgląd dokładnie tego, co zobaczy odwiedzający, oraz
// publikacja / archiwizacja / przywrócenie wersji jako nowego szkicu.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, FilePlus2, RotateCcw, Send, Trash2, Archive } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LegalPage } from "@/components/legal/LegalPage";
import { PreviewFrame } from "../atoms/PreviewFrame";
import { VersionStatusBadge } from "../atoms/VersionStatusBadge";
import { VersionRow } from "../molecules/VersionRow";
import { LEGAL_DOC_LIST, LEGAL_DOCS } from "@/lib/legal/registry";
import { resolveLegalCopy } from "@/lib/legal/resolve";
import type { LegalDocContent, LegalDocKey, LegalDocumentVersion } from "@/lib/legal/types";
import { useLegalVersionActions, useLegalVersions } from "@/lib/legal/versions";
import { uiLocale } from "@/lib/i18n/format";

const BASELINE_ID = "__baseline__";

function formatDate(iso: string, lang: "pl" | "en") {
  try {
    return new Intl.DateTimeFormat(uiLocale(lang), {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function PolicyVersionsPane({ lang }: { lang: "pl" | "en" }) {
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const [docKey, setDocKey] = useState<LegalDocKey>("terms");
  const [selectedId, setSelectedId] = useState<string>(BASELINE_ID);
  const [previewLang, setPreviewLang] = useState<"pl" | "en">(lang);

  const doc = LEGAL_DOCS[docKey];
  const versionsQ = useLegalVersions(docKey);
  const actions = useLegalVersionActions(docKey);

  const versions: LegalDocumentVersion[] = useMemo(() => versionsQ.data ?? [], [versionsQ.data]);
  const selected = versions.find((v) => v.id === selectedId) ?? null;
  const content: LegalDocContent = selected?.content ?? doc.baseline;
  const preview = resolveLegalCopy(content[previewLang]);
  const published = versions.find((v) => v.status === "published") ?? null;

  const switchDoc = (key: LegalDocKey) => {
    setDocKey(key);
    setSelectedId(BASELINE_ID);
  };

  const createFrom = async (source: LegalDocContent, label: string) => {
    try {
      await actions.create.mutateAsync({ docKey, label, content: source });
      toast.success(L("Utworzono szkic wersji", "Draft version created"));
    } catch {
      toast.error(L("Nie udało się utworzyć wersji", "Could not create the version"));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {LEGAL_DOC_LIST.map((d) => (
          <Button
            key={d.key}
            size="sm"
            variant={d.key === docKey ? "default" : "outline"}
            onClick={() => switchDoc(d.key)}
          >
            {lang === "pl" ? d.labelPl : d.labelEn}
          </Button>
        ))}
        <a
          href={doc.path}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {doc.path}
        </a>
      </div>

      <p className="text-xs text-muted-foreground">
        {published
          ? L(
              `Na stronie publicznej widoczna jest wersja "${published.label}".`,
              `The public page currently serves the "${published.label}" version.`,
            )
          : L(
              "Brak opublikowanej wersji - strona publiczna korzysta z treści z kodu.",
              "No published version - the public page serves the code baseline.",
            )}
      </p>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="space-y-2">
          <div className="rounded-md border border-border overflow-hidden">
            <ul className="divide-y divide-border">
              <VersionRow
                title={L("Treść z kodu", "Code baseline")}
                meta={L(
                  "Zawsze dostępna jako punkt wyjścia",
                  "Always available as a starting point",
                )}
                active={selectedId === BASELINE_ID}
                onSelect={() => setSelectedId(BASELINE_ID)}
                badge={<VersionStatusBadge status="baseline" lang={lang} />}
              />
              {versions.map((v) => (
                <VersionRow
                  key={v.id}
                  title={v.label}
                  meta={formatDate(v.created_at, lang)}
                  active={selectedId === v.id}
                  onSelect={() => setSelectedId(v.id)}
                  badge={<VersionStatusBadge status={v.status} lang={lang} />}
                />
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={actions.create.isPending}
              onClick={() =>
                createFrom(
                  doc.baseline,
                  L(
                    `Z kodu - ${new Date().toISOString().slice(0, 10)}`,
                    `From code - ${new Date().toISOString().slice(0, 10)}`,
                  ),
                )
              }
            >
              <FilePlus2 className="mr-1.5 h-3.5 w-3.5" />
              {L("Nowa wersja z kodu", "New version from code")}
            </Button>
            {selected ? (
              <Button
                size="sm"
                variant="outline"
                disabled={actions.create.isPending}
                onClick={() =>
                  createFrom(
                    selected.content,
                    L(`Kopia: ${selected.label}`, `Copy of: ${selected.label}`),
                  )
                }
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                {L("Przywróć jako szkic", "Restore as draft")}
              </Button>
            ) : null}
          </div>

          {selected ? (
            <div className="flex flex-wrap gap-2">
              {selected.status !== "published" ? (
                <Button
                  size="sm"
                  disabled={actions.publish.isPending}
                  onClick={async () => {
                    try {
                      await actions.publish.mutateAsync(selected.id);
                      toast.success(L("Opublikowano wersję", "Version published"));
                    } catch {
                      toast.error(L("Publikacja nie powiodła się", "Publishing failed"));
                    }
                  }}
                >
                  <Send className="mr-1.5 h-3.5 w-3.5" />
                  {L("Opublikuj", "Publish")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actions.unpublish.isPending}
                  onClick={async () => {
                    await actions.unpublish.mutateAsync(selected.id);
                    toast.success(
                      L("Wersja przeniesiona do archiwum", "Version moved to the archive"),
                    );
                  }}
                >
                  <Archive className="mr-1.5 h-3.5 w-3.5" />
                  {L("Wycofaj publikację", "Unpublish")}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={actions.remove.isPending}
                onClick={async () => {
                  await actions.remove.mutateAsync(selected.id);
                  setSelectedId(BASELINE_ID);
                  toast.success(L("Usunięto wersję", "Version deleted"));
                }}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                {L("Usuń", "Delete")}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {L("Podgląd języka:", "Preview language:")}
            </span>
            {(["pl", "en"] as const).map((l) => (
              <Button
                key={l}
                size="sm"
                variant={previewLang === l ? "default" : "outline"}
                aria-pressed={previewLang === l}
                onClick={() => setPreviewLang(l)}
              >
                {l.toUpperCase()}
              </Button>
            ))}
          </div>
          <PreviewFrame label={L("Tak zobaczy to odwiedzający", "What a visitor will see")}>
            <LegalPage
              eyebrow={preview.eyebrow}
              title={preview.title}
              lead={preview.lead}
              updatedLabel={preview.updated}
              sections={preview.sections}
              footnote={preview.footnote}
            />
          </PreviewFrame>
        </div>
      </div>
    </div>
  );
}
