import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type ChangeEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FloatingInput, FloatingTextarea } from "@/components/ui/floating-input";
import { AdminColorPicker } from "@/components/admin/blocks/AdminColorPicker";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Plus, Save, Trash2, ChevronUp, ChevronDown } from "@/lib/lucide-shim";
import { useAuth } from "@/hooks/useAuth";
import { ensureI18n as ensureAdminMiscRoutesI18n } from "@/lib/i18n-admin-misc-routes";
import {
  newStoryPage,
  safeParsePages,
  type StoryPage,
  type WebStory,
  type WebStoryStatus,
} from "@/lib/web-stories/types";
import { adminToast } from "@/lib/adminToasts";
import { replaceStrokeLetters } from "@/lib/text/strokeLetters";

// BEZ WŁASNEJ POWŁOKI PANELU. `admin.tsx` rysuje `<AdminShell>` wokół KAŻDEJ
// trasy `/admin/*` (poza studiem wydarzeń), więc `<AdminShell hideSidebar>`
// tutaj dawał DRUGĄ, zagnieżdżoną powłokę: drugi `<main id="main-content">`
// (zduplikowane `id`, kotwica „przejdź do treści" trafiała w zewnętrzny),
// pływający przełącznik języka nad paskiem bocznym, który ma już własny,
// do tego podwójny padding i drugi komplet zapytań powłoki (ustawienia,
// liczniki klubów). Ta sama naprawa co w `admin.events.tsx`: trasa oddaje
// sam kontent.
export const Route = createFileRoute("/admin/web-stories")({ component: Page });

/** Klucz listy panelu i PREFIKS publicznej przestrzeni historii (`lib/queries/webStories`). */
const ADMIN_KEY = ["admin", "web-stories"] as const;
const PUBLIC_KEY = ["web-stories"] as const;

/**
 * Slug adresu historii. Transliteracja liter z przekreśleniem (`ł` -> `l`) idzie
 * PRZED rozkładem NFD i zdjęciem znaków diakrytycznych, a te - przed zamianą
 * reszty na dywizy. Wcześniej zostawał sam ostatni krok, więc każda polska
 * litera stawała się dywizem: „Szczyt w Gdańsku" dawało `szczyt-w-gda-sku`,
 * „Łódź" - `d`. Świadomie BEZ limitu długości (w przeciwieństwie do
 * `slugifyTaxonomy`): slug istniejącej historii przechodzi tędy przy KAŻDYM
 * zapisie, a obcięcie zmieniłoby opublikowany adres.
 */
function storySlug(raw: string): string {
  return replaceStrokeLetters(raw.toLowerCase())
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Czas wyświetlania planszy: CAŁKOWITA liczba sekund 2..30, puste pole = 6.
 * Zaokrąglenie nie jest kosmetyką: `StoryPageSchema` wymaga `int()`, a
 * `safeParsePages` przy JEDNEJ złej planszy odrzuca CAŁĄ tablicę - wpisane
 * „2.5" kasowało więc po zapisie wszystkie strony historii - publicznie i w tym
 * edytorze, gdzie dodanie planszy i kolejny zapis nadpisywały już oryginał.
 */
function clampDuration(raw: string): number {
  return Math.round(Math.max(2, Math.min(30, Number(raw) || 6)));
}

/** Kopia z jednym polem podmienionym; typ wartości jest związany z kluczem (bez rzutowań). */
function withField<T, K extends keyof T>(target: T, key: K, value: T[K]): T {
  const next = { ...target };
  next[key] = value;
  return next;
}

type TextChange = ChangeEvent<HTMLInputElement | HTMLTextAreaElement>;
type StoryTextKey = "slug" | "title_pl" | "title_en" | "description_pl" | "description_en";
type PageTextKey =
  | "media_url"
  | "poster_url"
  | "title_pl"
  | "title_en"
  | "caption_pl"
  | "caption_en"
  | "cta_label_pl"
  | "cta_label_en"
  | "cta_href";
type SetPageField = <K extends keyof StoryPage>(key: K, value: StoryPage[K]) => void;

type Row = Pick<WebStory, "id" | "slug" | "title_pl" | "title_en" | "status" | "cover_url"> & {
  published_at: string | null;
};

function Page() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureAdminMiscRoutesI18n();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { tenantId } = useAuth();
  const [editing, setEditing] = useState<WebStory | null>(null);

  const { data: rows } = useQuery({
    queryKey: ADMIN_KEY,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("web_stories")
        .select("id,slug,title_pl,title_en,status,cover_url,published_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const loadOne = useMutation({
    mutationFn: async (id: string): Promise<WebStory> => {
      const { data, error } = await supabase
        .from("web_stories")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(adminToast.error());
      return { ...data, status: data.status as WebStoryStatus, pages: safeParsePages(data.pages) };
    },
    onSuccess: (d) => setEditing(d),
    // Bez tego klik w tytuł po odmowie RLS albo padniętym transporcie nie robił
    // NIC - ani edytora, ani słowa. Pozostałe mutacje tej trasy miały toast.
    onError: (e: Error) => toast.error(e.message),
  });

  const newDraft = (): WebStory => ({
    id: "",
    tenant_id: tenantId ?? "",
    slug: "",
    title_pl: "Nowa historia",
    title_en: "",
    description_pl: "",
    description_en: "",
    cover_url: null,
    pages: [newStoryPage()],
    status: "draft",
    published_at: null,
    author_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const save = useMutation({
    mutationFn: async (s: WebStory) => {
      const slug = storySlug(s.slug || s.title_pl);
      if (!slug) throw new Error(t("adminMiscRoutes.webStories.errSlug"));
      if (!s.pages.length) throw new Error(t("adminMiscRoutes.webStories.errPages"));
      const payload = {
        slug,
        title_pl: s.title_pl,
        title_en: s.title_en,
        description_pl: s.description_pl,
        description_en: s.description_en,
        cover_url: s.cover_url,
        pages: s.pages,
        status: s.status,
        published_at:
          s.status === "published" ? (s.published_at ?? new Date().toISOString()) : s.published_at,
      };
      if (s.id) {
        const { error } = await supabase.from("web_stories").update(payload).eq("id", s.id);
        if (error) throw error;
      } else {
        if (!tenantId) throw new Error(t("adminMiscRoutes.webStories.errTenant"));
        const { error } = await supabase
          .from("web_stories")
          .insert({ ...payload, tenant_id: tenantId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ADMIN_KEY });
      qc.invalidateQueries({ queryKey: PUBLIC_KEY });
      toast.success(adminToast.saved());
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("web_stories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      // OBA klucze, jak przy zapisie: bez publicznego czytelnik w tej samej
      // sesji dalej widział usuniętą historię na liście i trafiał w 404.
      qc.invalidateQueries({ queryKey: ADMIN_KEY });
      qc.invalidateQueries({ queryKey: PUBLIC_KEY });
      toast.success(adminToast.deleted());
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl">Web Stories</h1>
        <Button onClick={() => setEditing(newDraft())}>
          <Plus className="w-4 h-4 mr-2" />
          {t("adminMiscRoutes.webStories.newStory")}
        </Button>
      </div>

      {editing ? (
        // `key` PRZEMONTOWUJE edytor przy zmianie edytowanej historii. Edytor
        // trzyma kopię roboczą w `useState(s)`, który czyta `s` TYLKO przy
        // montażu - „Nowa historia" klikniętą w trakcie edycji zostawiała na
        // ekranie poprzednią, a zapis szedł UPDATE-em w nią.
        <Editor
          key={editing.id || editing.created_at}
          s={editing}
          onCancel={() => setEditing(null)}
          onSave={(s) => save.mutate(s)}
          saving={save.isPending}
        />
      ) : (
        <section className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left p-2 w-12"></th>
                <th className="text-left p-2">{t("adminMiscRoutes.webStories.colTitle")}</th>
                <th className="text-left p-2">Slug</th>
                <th className="text-left p-2">Status</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows?.map((r) => (
                <tr key={r.id} className="border-b border-border/60">
                  <td className="p-2">
                    {r.cover_url ? (
                      <img src={r.cover_url} alt="" className="w-10 h-14 object-cover rounded" />
                    ) : (
                      <div className="w-10 h-14 bg-muted rounded" />
                    )}
                  </td>
                  <td className="p-2">
                    <button
                      className="hover:underline text-left"
                      onClick={() => loadOne.mutate(r.id)}
                    >
                      {r.title_pl}
                    </button>
                  </td>
                  <td className="p-2 font-mono text-xs text-muted-foreground">{r.slug}</td>
                  <td className="p-2">
                    <span className="text-xs px-2 py-0.5 rounded bg-muted">{r.status}</span>
                  </td>
                  <td className="p-2 text-right">
                    <button
                      onClick={() => {
                        if (confirm(t("adminMiscRoutes.webStories.confirmRemove")))
                          remove.mutate(r.id);
                      }}
                      className="text-xs text-destructive hover:underline"
                    >
                      <Trash2 className="w-3 h-3 inline mr-1" />
                      {t("adminMiscRoutes.webStories.remove")}
                    </button>
                  </td>
                </tr>
              ))}
              {!rows?.length && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted-foreground">
                    {t("adminMiscRoutes.webStories.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function Editor({
  s,
  onSave,
  onCancel,
  saving,
}: {
  s: WebStory;
  onSave: (s: WebStory) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const statusId = useId();
  const [d, setD] = useState<WebStory>(s);
  const [activePage, setActivePage] = useState(0);
  const setField = <K extends keyof WebStory>(key: K, value: WebStory[K]) =>
    setD((prev) => withField(prev, key, value));
  // JEDEN binder zamiast kopii domknięcia przy każdym polu tekstowym: klucz
  // pola jest jedynym, co je różni, a pomyłka w kopii (`title_en` wpięty pod
  // pole PL) nie daje żadnego błędu - tylko treść w złym języku.
  const text = (key: StoryTextKey) => ({
    value: d[key],
    onChange: (e: TextChange) => setField(key, e.target.value),
  });
  const setPageField: SetPageField = (key, value) =>
    setD((prev) => ({
      ...prev,
      pages: prev.pages.map((page, k) => (k === activePage ? withField(page, key, value) : page)),
    }));
  const movePage = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= d.pages.length) return;
    const next = [...d.pages];
    [next[i], next[j]] = [next[j], next[i]];
    setD({ ...d, pages: next });
    setActivePage(j);
  };
  const addPage = () => {
    setD({ ...d, pages: [...d.pages, newStoryPage()] });
    setActivePage(d.pages.length);
  };
  const delPage = (i: number) => {
    if (d.pages.length <= 1) return;
    const next = d.pages.filter((_, k) => k !== i);
    setD({ ...d, pages: next });
    setActivePage(Math.max(0, Math.min(i, next.length - 1)));
  };

  const cur = d.pages[activePage];

  return (
    <section className="bg-card border border-border rounded-lg p-5 space-y-5">
      <div className="grid sm:grid-cols-3 gap-3">
        <FloatingInput label="Slug" {...text("slug")} />
        <div>
          <Label htmlFor={statusId}>Status</Label>
          <select
            id={statusId}
            className="w-full px-3 py-2 rounded border border-input bg-background text-sm"
            value={d.status}
            onChange={(e) => setField("status", e.target.value as WebStoryStatus)}
          >
            <option value="draft">{t("adminMiscRoutes.webStories.statusDraft")}</option>
            <option value="published">{t("adminMiscRoutes.webStories.statusPublished")}</option>
            <option value="archived">{t("adminMiscRoutes.webStories.statusArchived")}</option>
          </select>
        </div>
        <FloatingInput
          label={t("adminMiscRoutes.webStories.cover")}
          value={d.cover_url ?? ""}
          onChange={(e) => setField("cover_url", e.target.value || null)}
        />
      </div>

      <Tabs defaultValue="pl">
        <TabsList>
          <TabsTrigger value="pl">🇵🇱 PL</TabsTrigger>
          <TabsTrigger value="en">🇬🇧 EN</TabsTrigger>
        </TabsList>
        <TabsContent value="pl" className="space-y-3 mt-4">
          <FloatingInput label={t("adminMiscRoutes.webStories.title")} {...text("title_pl")} />
          <FloatingTextarea
            label={t("adminMiscRoutes.webStories.description")}
            rows={2}
            {...text("description_pl")}
          />
        </TabsContent>
        <TabsContent value="en" className="space-y-3 mt-4">
          {/* TE SAME klucze co przy zakładce PL: etykieta opisuje POLE
              („tytuł"), a zakładka mówi o JĘZYKU TREŚCI. Wpisane tu na
              sztywno „Title" i „Description" dawały panel mówiący dwoma
              językami naraz, niezależnie od języka wybranego przez
              redaktora. */}
          <FloatingInput label={t("adminMiscRoutes.webStories.title")} {...text("title_en")} />
          <FloatingTextarea
            label={t("adminMiscRoutes.webStories.description")}
            rows={2}
            {...text("description_en")}
          />
        </TabsContent>
      </Tabs>

      <div className="border-t border-border pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg">
            {t("adminMiscRoutes.webStories.storyPages", { count: d.pages.length })}
          </h2>
          <Button size="sm" variant="outline" onClick={addPage}>
            <Plus className="w-4 h-4 mr-1" />
            {t("adminMiscRoutes.webStories.addPage")}
          </Button>
        </div>

        <div className="grid grid-cols-[200px_1fr] gap-4">
          <ul className="space-y-1 text-sm">
            {d.pages.map((p, i) => (
              <li
                key={p.id}
                className={`flex items-center gap-1 rounded border ${i === activePage ? "border-primary bg-primary/5" : "border-border"} p-1`}
              >
                <button
                  className="flex-1 text-left px-2 py-1 truncate"
                  onClick={() => setActivePage(i)}
                >
                  #{i + 1} {p.title_pl || p.title_en || t("adminMiscRoutes.webStories.noTitle")}
                </button>
                <button
                  aria-label="Up"
                  className="p-1 hover:bg-muted rounded"
                  onClick={() => movePage(i, -1)}
                >
                  <ChevronUp className="w-3 h-3" />
                </button>
                <button
                  aria-label="Down"
                  className="p-1 hover:bg-muted rounded"
                  onClick={() => movePage(i, 1)}
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
                <button
                  aria-label="Delete"
                  className="p-1 hover:bg-destructive/10 rounded text-destructive"
                  onClick={() => delPage(i)}
                  disabled={d.pages.length <= 1}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>

          {cur && <PageFields page={cur} setField={setPageField} />}
        </div>
      </div>

      <div className="flex gap-2 pt-2 border-t border-border">
        <Button onClick={() => onSave(d)} disabled={saving}>
          <Save className="w-4 h-4 mr-2" />
          {saving ? "…" : t("common.save")}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </section>
  );
}

/** Pola AKTYWNEJ planszy. `page` jest tu zawsze obecne - strażnik stoi u wołającego. */
function PageFields({ page, setField }: { page: StoryPage; setField: SetPageField }) {
  const { t } = useTranslation();
  const backgroundId = useId();
  const positionId = useId();
  const alignId = useId();
  const durationId = useId();
  const text = (key: PageTextKey) => ({
    value: page[key],
    onChange: (e: TextChange) => setField(key, e.target.value),
  });

  return (
    <div className="space-y-3 border border-border rounded-lg p-4">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label htmlFor={backgroundId}>{t("adminMiscRoutes.webStories.background")}</Label>
          <select
            id={backgroundId}
            className="w-full px-3 py-2 rounded border border-input bg-background text-sm"
            value={page.background}
            onChange={(e) => setField("background", e.target.value as StoryPage["background"])}
          >
            <option value="image">{t("adminMiscRoutes.webStories.bgImage")}</option>
            <option value="video">{t("adminMiscRoutes.webStories.bgVideo")}</option>
            <option value="color">{t("adminMiscRoutes.webStories.bgColor")}</option>
          </select>
        </div>
        <div>
          <Label htmlFor={positionId}>{t("adminMiscRoutes.webStories.textPosition")}</Label>
          <select
            id={positionId}
            className="w-full px-3 py-2 rounded border border-input bg-background text-sm"
            value={page.text_position}
            onChange={(e) =>
              setField("text_position", e.target.value as StoryPage["text_position"])
            }
          >
            <option value="top">{t("adminMiscRoutes.webStories.posTop")}</option>
            <option value="center">{t("adminMiscRoutes.webStories.posCenter")}</option>
            <option value="bottom">{t("adminMiscRoutes.webStories.posBottom")}</option>
          </select>
        </div>
        <div>
          <Label htmlFor={alignId}>{t("adminMiscRoutes.webStories.align")}</Label>
          <select
            id={alignId}
            className="w-full px-3 py-2 rounded border border-input bg-background text-sm"
            value={page.text_align}
            onChange={(e) => setField("text_align", e.target.value as StoryPage["text_align"])}
          >
            <option value="left">{t("adminMiscRoutes.webStories.alignLeft")}</option>
            <option value="center">{t("adminMiscRoutes.webStories.alignCenter")}</option>
            <option value="right">{t("adminMiscRoutes.webStories.alignRight")}</option>
          </select>
        </div>
      </div>

      {page.background === "color" ? (
        <div>
          <Label>{t("adminMiscRoutes.webStories.bgColorLabel")}</Label>
          <AdminColorPicker
            value={page.color}
            onChange={(v) => setField("color", v ?? "#000000")}
            allowTransparent={false}
            allowReset={false}
          />
        </div>
      ) : (
        <>
          <FloatingInput
            label={
              page.background === "video"
                ? t("adminMiscRoutes.webStories.mediaUrlVideo")
                : t("adminMiscRoutes.webStories.mediaUrlImage")
            }
            {...text("media_url")}
          />
          {page.background === "video" && (
            <FloatingInput label={t("adminMiscRoutes.webStories.poster")} {...text("poster_url")} />
          )}
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <FloatingInput label={t("adminMiscRoutes.webStories.titlePl")} {...text("title_pl")} />
        <FloatingInput label={t("adminMiscRoutes.webStories.titleEn")} {...text("title_en")} />
        <FloatingTextarea
          label={t("adminMiscRoutes.webStories.captionPl")}
          rows={2}
          {...text("caption_pl")}
        />
        <FloatingTextarea
          label={t("adminMiscRoutes.webStories.captionEn")}
          rows={2}
          {...text("caption_en")}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <FloatingInput label="CTA PL" {...text("cta_label_pl")} />
        <FloatingInput label="CTA EN" {...text("cta_label_en")} />
        <FloatingInput label={t("adminMiscRoutes.webStories.ctaLink")} {...text("cta_href")} />
      </div>

      <div className="w-40">
        <Label htmlFor={durationId}>{t("adminMiscRoutes.webStories.duration")}</Label>
        <Input
          id={durationId}
          type="number"
          min={2}
          max={30}
          step={1}
          value={page.duration_seconds}
          onChange={(e) => setField("duration_seconds", clampDuration(e.target.value))}
        />
      </div>
    </div>
  );
}
