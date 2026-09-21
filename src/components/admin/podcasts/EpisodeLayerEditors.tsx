// Powtarzalne edytory warstw odcinka (uczestnicy, rozdziały, cytaty, źródła) -
// WYCIĄG z `routes/admin.podcasts.tsx`.
//
// Cztery listy o tym samym szkielecie: karta z przyciskiem „Dodaj", wiersze
// z uchwytem i koszem, pusty stan. Logika jest w trzech operacjach na tablicy
// (dodaj / zmień po indeksie / usuń po indeksie) i to one są tu przedmiotem
// dowodu: pomyłka w indeksie zmienia CUDZY wiersz, a `filter` po tożsamości
// obiektu gubi wiersze o identycznej treści.
//
// Stan trzyma edytor odcinka (`EpisodeEditorPane`) - te komponenty są
// bezstanowe z założenia, bo „Zapisz" wysyła CAŁY zestaw warstw jednym
// strzałem i nie może czytać stanu rozsianego po czterech kartach.
import type React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2 } from "@/lib/lucide-shim";
import { GripVertical } from "lucide-react";
import type { PodcastChapter, PodcastQuote, PodcastResource } from "@/lib/podcast/types";
import { formatDuration, parseDuration } from "@/lib/podcast/types";
import type { PersonDraft, ProfileOption } from "@/lib/podcast/shape";
import { ensureI18n as ensureAdminPodcastsI18n } from "@/lib/i18n-admin-podcasts";

export function SectionCard({
  title,
  hint,
  onAdd,
  addLabel,
  children,
}: {
  title: string;
  hint: string;
  onAdd: () => void;
  addLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{hint}</div>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onAdd}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          {addLabel}
        </Button>
      </div>
      {children}
    </div>
  );
}

export function RowShell({
  onRemove,
  children,
}: {
  onRemove: () => void;
  children: React.ReactNode;
}) {
  ensureAdminPodcastsI18n();
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2 rounded border border-border bg-muted/20 p-2">
      <GripVertical className="w-4 h-4 text-muted-foreground/50 mt-2 shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">{children}</div>
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive p-1 mt-1"
        aria-label={t("adminPodcasts.rowRemove")}
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

export function PeopleEditor({
  people,
  setPeople,
  profiles,
}: {
  people: PersonDraft[];
  setPeople: React.Dispatch<React.SetStateAction<PersonDraft[]>>;
  profiles: ProfileOption[];
}) {
  ensureAdminPodcastsI18n();
  const { t } = useTranslation();
  const update = (i: number, patch: Partial<PersonDraft>) =>
    setPeople((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const remove = (i: number) => setPeople((prev) => prev.filter((_, idx) => idx !== i));
  const add = () =>
    setPeople((prev) => [...prev, { profile_id: null, display_name: "", role: "guest", url: "" }]);

  return (
    <SectionCard
      title={t("adminPodcasts.people.title")}
      hint={t("adminPodcasts.people.hint")}
      onAdd={add}
      addLabel={t("adminPodcasts.people.add")}
    >
      {people.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">{t("adminPodcasts.people.empty")}</p>
      ) : (
        <div className="space-y-2">
          {people.map((person, i) => (
            <RowShell key={person.id ?? i} onRemove={() => remove(i)}>
              <div className="grid sm:grid-cols-[110px_1fr] gap-2">
                <select
                  className="px-2 py-1.5 rounded border border-input bg-background text-sm"
                  value={person.role}
                  onChange={(e) => update(i, { role: e.target.value as "host" | "guest" })}
                >
                  <option value="host">{t("adminPodcasts.people.roleHost")}</option>
                  <option value="guest">{t("adminPodcasts.people.roleGuest")}</option>
                </select>
                <select
                  className="px-2 py-1.5 rounded border border-input bg-background text-sm"
                  value={person.profile_id ?? ""}
                  onChange={(e) => {
                    const id = e.target.value || null;
                    const prof = profiles.find((x) => x.id === id);
                    // Auto-uzupełnij nazwisko z profilu, gdy pole puste.
                    update(i, {
                      profile_id: id,
                      display_name:
                        !person.display_name && prof?.display_name
                          ? prof.display_name
                          : person.display_name,
                    });
                  }}
                >
                  <option value="">{t("adminPodcasts.people.externalGuest")}</option>
                  {profiles.map((prof) => (
                    <option key={prof.id} value={prof.id}>
                      {prof.display_name || prof.slug || prof.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                <Input
                  value={person.display_name}
                  onChange={(e) => update(i, { display_name: e.target.value })}
                  placeholder={t("adminPodcasts.people.displayNamePlaceholder")}
                />
                <Input
                  value={person.url}
                  onChange={(e) => update(i, { url: e.target.value })}
                  placeholder={t("adminPodcasts.people.urlPlaceholder")}
                />
              </div>
            </RowShell>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

export function ChaptersEditor({
  chapters,
  setChapters,
}: {
  chapters: PodcastChapter[];
  setChapters: React.Dispatch<React.SetStateAction<PodcastChapter[]>>;
}) {
  ensureAdminPodcastsI18n();
  const { t } = useTranslation();
  const update = (i: number, patch: Partial<PodcastChapter>) =>
    setChapters((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const remove = (i: number) => setChapters((prev) => prev.filter((_, idx) => idx !== i));
  const add = () => setChapters((prev) => [...prev, { start: 0, title_pl: "", title_en: "" }]);

  return (
    <SectionCard
      title={t("adminPodcasts.chapters.title")}
      hint={t("adminPodcasts.chapters.hint")}
      onAdd={add}
      addLabel={t("adminPodcasts.chapters.add")}
    >
      {chapters.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">{t("adminPodcasts.chapters.empty")}</p>
      ) : (
        <div className="space-y-2">
          {chapters.map((c, i) => (
            <RowShell key={i} onRemove={() => remove(i)}>
              <div className="grid sm:grid-cols-[120px_1fr_1fr] gap-2">
                <Input
                  value={formatDuration(c.start)}
                  onChange={(e) => update(i, { start: parseDuration(e.target.value) })}
                  placeholder="MM:SS"
                  aria-label={t("adminPodcasts.chapters.startTime")}
                />
                <Input
                  value={c.title_pl}
                  onChange={(e) => update(i, { title_pl: e.target.value })}
                  placeholder={t("adminPodcasts.chapters.titlePlPlaceholder")}
                />
                <Input
                  value={c.title_en}
                  onChange={(e) => update(i, { title_en: e.target.value })}
                  placeholder="Title (EN)"
                />
              </div>
            </RowShell>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

export function QuotesEditor({
  quotes,
  setQuotes,
}: {
  quotes: PodcastQuote[];
  setQuotes: React.Dispatch<React.SetStateAction<PodcastQuote[]>>;
}) {
  ensureAdminPodcastsI18n();
  const { t } = useTranslation();
  const update = (i: number, patch: Partial<PodcastQuote>) =>
    setQuotes((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const remove = (i: number) => setQuotes((prev) => prev.filter((_, idx) => idx !== i));
  const add = () => setQuotes((prev) => [...prev, { text_pl: "", text_en: "", attribution: "" }]);

  return (
    <SectionCard
      title={t("adminPodcasts.quotes.title")}
      hint={t("adminPodcasts.quotes.hint")}
      onAdd={add}
      addLabel={t("adminPodcasts.quotes.add")}
    >
      {quotes.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">{t("adminPodcasts.quotes.empty")}</p>
      ) : (
        <div className="space-y-2">
          {quotes.map((q, i) => (
            <RowShell key={i} onRemove={() => remove(i)}>
              <Textarea
                rows={2}
                value={q.text_pl}
                onChange={(e) => update(i, { text_pl: e.target.value })}
                placeholder={t("adminPodcasts.quotes.quotePlPlaceholder")}
              />
              <Textarea
                rows={2}
                value={q.text_en}
                onChange={(e) => update(i, { text_en: e.target.value })}
                placeholder="Quote (EN)"
              />
              <Input
                value={q.attribution}
                onChange={(e) => update(i, { attribution: e.target.value })}
                placeholder={t("adminPodcasts.quotes.attributionPlaceholder")}
              />
            </RowShell>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

export function ResourcesEditor({
  resources,
  setResources,
}: {
  resources: PodcastResource[];
  setResources: React.Dispatch<React.SetStateAction<PodcastResource[]>>;
}) {
  ensureAdminPodcastsI18n();
  const { t } = useTranslation();
  const update = (i: number, patch: Partial<PodcastResource>) =>
    setResources((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const remove = (i: number) => setResources((prev) => prev.filter((_, idx) => idx !== i));
  const add = () =>
    setResources((prev) => [...prev, { label_pl: "", label_en: "", url: "", kind: "source" }]);

  return (
    <SectionCard
      title={t("adminPodcasts.resources.title")}
      hint={t("adminPodcasts.resources.hint")}
      onAdd={add}
      addLabel={t("adminPodcasts.resources.add")}
    >
      {resources.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">{t("adminPodcasts.resources.empty")}</p>
      ) : (
        <div className="space-y-2">
          {resources.map((r, i) => (
            <RowShell key={i} onRemove={() => remove(i)}>
              <div className="grid sm:grid-cols-[150px_1fr] gap-2">
                <select
                  className="px-2 py-1.5 rounded border border-input bg-background text-sm"
                  value={r.kind}
                  onChange={(e) =>
                    update(i, { kind: e.target.value === "related" ? "related" : "source" })
                  }
                >
                  <option value="source">{t("adminPodcasts.resources.kindSource")}</option>
                  <option value="related">{t("adminPodcasts.resources.kindRelated")}</option>
                </select>
                <Input
                  value={r.url}
                  onChange={(e) => update(i, { url: e.target.value })}
                  placeholder="https://…"
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                <Input
                  value={r.label_pl}
                  onChange={(e) => update(i, { label_pl: e.target.value })}
                  placeholder={t("adminPodcasts.resources.labelPlPlaceholder")}
                />
                <Input
                  value={r.label_en}
                  onChange={(e) => update(i, { label_en: e.target.value })}
                  placeholder="Label (EN)"
                />
              </div>
            </RowShell>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
