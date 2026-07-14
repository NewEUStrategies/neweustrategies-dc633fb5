import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeBilingualReadingStats } from "@/lib/readingTime";
import { useReadingTimeSettings } from "@/hooks/useReadingTimeSettings";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useRequiredTenant } from "@/hooks/useAuth";
import { updatePost, deletePost } from "@/lib/content.functions";
import { slugifyTaxonomy } from "@/lib/content/taxonomySlug";
import { statusOptionsFor, type PostWorkflowStatus } from "@/lib/content/workflow";
import { RevisionsCard } from "@/components/admin/molecules/RevisionsCard";
import { EditPresenceBanner } from "@/components/admin/molecules/EditPresenceBanner";
import { migratePostToBlocks } from "@/lib/posts-migrate.functions";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useAutosave } from "@/hooks/useAutosave";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { AutosaveBar } from "@/components/admin/AutosaveBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { PostEditor } from "@/components/admin/PostEditor";
import { PageParentSelect } from "@/components/admin/PageParentSelect";
import { CoverImagePicker } from "@/components/admin/CoverImagePicker";
import { AudioPicker } from "@/components/admin/AudioPicker";
import { Builder } from "@/components/admin/builder/Builder";
import type { BuilderDocument } from "@/lib/builder/types";
import {
  ArrowLeft,
  Save,
  Trash2,
  ArrowRight,
  FileText,
  Settings as SettingsIcon,
  Layers,
  Search,
  Tags as TagIcon,
  Lock,
  Link as LinkIconLucide,
  Mic,
} from "@/lib/lucide-shim";
import { History, Database, ListChecks } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toastError } from "@/lib/toastError";
import { PostBlockEditor } from "@/components/admin/blocks/PostBlockEditor";
import type { LocalizedBlocks } from "@/lib/blocks/types";
import { EMPTY_BLOCKS_DOC } from "@/lib/blocks/types";
import { getLayoutSet, mergeOverrides, pickLayoutId } from "@/lib/postLayouts";
import { usePostLayoutSettings } from "@/hooks/usePostLayoutSettings";
import { LayoutOverridesCard } from "@/components/admin/post-editor/LayoutOverridesCard";
import { LayoutScaffold } from "@/components/admin/blocks/LayoutScaffold";
import { AccessSettingsPane } from "@/components/admin/AccessSettingsPane";
import { PostSettingsMetabox, TakeawaysTab } from "@/components/admin/PostSettingsMetabox";
import { CustomMetaValuesEditor } from "@/components/admin/CustomMetaValuesEditor";
import { RelatedOverrideEditor } from "@/components/admin/RelatedOverrideEditor";
import { CategoriesCard, TagsCard, BilingualPickerCard } from "@/components/admin/post-editor/TaxonomyCards";
import { SeoPanel } from "@/components/admin/seo/SeoPanel";
import { WorkflowStatusSection } from "@/components/admin/post-editor/WorkflowStatusSection";
import { PostGeneralOverview } from "@/components/admin/PostGeneralOverview";
import { SidebarSection, InfoHint } from "@/components/admin/post-editor/SidebarSection";
import { toast } from "sonner";
import {
  invalidateWidgetCaches,
  emitWidgetCacheInvalidate,
} from "@/lib/builder/widgetCacheInvalidation";
import { invalidateSeoCaches } from "@/lib/seo/invalidate";
import { hasBlockingSeoIssues, type SeoIssue } from "@/lib/seo/validation";

export const Route = createFileRoute("/admin/posts/$slug")({
  component: EditPost,
});

type EditorType = "blocks" | "richtext" | "markdown" | "builder";

import type { LayoutOverrides, PostFormat } from "@/lib/postLayouts";

import { confirmDialog, promptDialog } from "@/lib/appDialogs";
interface PostForm {
  id: string;
  slug: string;
  status: PostWorkflowStatus;
  editor: EditorType;
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  content_pl: string | null;
  content_en: string | null;
  cover_image_url: string | null;
  audio_url_pl: string | null;
  audio_url_en: string | null;
  read_minutes: number | null;
  published_at: string | null;
  publish_at: string | null;
  builder_data: BuilderDocument | null;
  blocks_data: LocalizedBlocks | null;
  parent_page_id: string;
  post_format: PostFormat;
  layout_overrides: LayoutOverrides | null;
  takeaways_pl: string[];
  takeaways_en: string[];
  takeaways_variant: "card" | "heading" | "ghost" | null;
  toc_override: import("@/lib/toc/settings").TocOverride | null;
  custom_meta: Record<string, string> | null;
  related_override: Record<string, unknown> | null;
  seo_title_pl: string | null;
  seo_title_en: string | null;
  seo_description_pl: string | null;
  seo_description_en: string | null;
  seo_canonical_url: string | null;
  seo_noindex: boolean;
  seo_og_image_url: string | null;
  og_image_generated_url: string | null;
}

interface CategoryOpt {
  id: string;
  name_pl: string;
  name_en: string;
}
interface TagOpt {
  id: string;
  name: string;
}

// SidebarSection + InfoHint moved to @/components/admin/post-editor/SidebarSection

function EditPost() {
  const { slug: routeSlug } = Route.useParams();
  const { t, i18n } = useTranslation();
  const uiLang = i18n.language ?? "pl";
  const navigate = useNavigate();
  const router = useRouter();
  const qc = useQueryClient();
  const tenantId = useRequiredTenant();
  // Editorial workflow: only admin / super_admin publish or schedule directly;
  // authors and editors submit for review (mirrored server-side + DB trigger).
  const { isAdmin: canPublish } = useAuth();
  const update$ = useServerFn(updatePost);
  const delete$ = useServerFn(deletePost);
  const migrate$ = useServerFn(migratePostToBlocks);
  const { data: globalLayout } = usePostLayoutSettings();

  const { data: post, isLoading } = useQuery({
    queryKey: ["post-by-slug", tenantId, routeSlug],
    enabled: !!tenantId,
    // Never background-refetch the row being edited: a refetch (e.g. on network
    // reconnect) replaces `post`, which history.reset()s the form and silently
    // discards unsaved edits + undo history. Explicit invalidations (revision
    // restore, slug change) still refetch and reset intentionally.
    refetchOnReconnect: false,
    queryFn: async (): Promise<PostForm> => {
      // Body columns are revoked from the authenticated role, so `select("*")`
      // would be denied. Staff load the full row (incl. body) through the
      // SECURITY DEFINER get_post_for_edit RPC (is_staff + own tenant enforced
      // server-side; slug is unique per tenant).
      const { data, error } = await supabase
        .rpc("get_post_for_edit", { _slug: routeSlug })
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Post not found or access denied");
      return data as unknown as PostForm;
    },
  });

  const id = post?.id ?? "";

  const { data: allCats } = useQuery({
    queryKey: ["categories", tenantId],
    queryFn: async (): Promise<CategoryOpt[]> =>
      (
        await supabase
          .from("categories")
          .select("id, name_pl, name_en")
          .eq("tenant_id", tenantId)
          .order("name_pl")
      ).data ?? [],
  });
  const { data: allTags } = useQuery({
    queryKey: ["tags", tenantId],
    queryFn: async (): Promise<TagOpt[]> =>
      (await supabase.from("tags").select("id, name").eq("tenant_id", tenantId).order("name"))
        .data ?? [],
  });
  const { data: allPrograms } = useQuery({
    queryKey: ["programs", tenantId],
    queryFn: async () =>
      (
        await supabase
          .from("programs")
          .select("id, name_pl, name_en")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .order("sort_order", { ascending: true })
          .order("name_pl", { ascending: true })
      ).data ?? [],
  });
  const { data: allRegions } = useQuery({
    queryKey: ["regions", tenantId],
    queryFn: async () =>
      (
        await supabase
          .from("regions")
          .select("id, name_pl, name_en")
          .eq("tenant_id", tenantId)
          .order("sort_order", { ascending: true })
          .order("name_pl", { ascending: true })
      ).data ?? [],
  });

  const { data: postCats } = useQuery({
    queryKey: ["post-cats", id],
    enabled: !!id,
    queryFn: async () =>
      (await supabase.from("post_categories").select("category_id").eq("post_id", id)).data ?? [],
  });
  const { data: postTags } = useQuery({
    queryKey: ["post-tags", id],
    enabled: !!id,
    queryFn: async () =>
      (await supabase.from("post_tags").select("tag_id").eq("post_id", id)).data ?? [],
  });
  const { data: postPrograms } = useQuery({
    queryKey: ["post-programs", id],
    enabled: !!id,
    queryFn: async () =>
      (await supabase.from("post_programs").select("program_id").eq("post_id", id)).data ?? [],
  });
  const { data: postRegions } = useQuery({
    queryKey: ["post-regions", id],
    enabled: !!id,
    queryFn: async () =>
      (await supabase.from("post_regions").select("region_id").eq("post_id", id)).data ?? [],
  });

  const history = useUndoRedo<PostForm | null>(null);
  const form = history.state;
  // Stabilna referencja do history.set dla saveFn (obiekt `history` zmienia
  // tozsamość co render, sam setter jest useCallback-owo stały).
  const setSlug = history.set;
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedPrograms, setSelectedPrograms] = useState<string[]>([]);
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [seoIssues, setSeoIssues] = useState<SeoIssue[]>([]);
  // Two-step flow: "details" shows metadata + titles + descriptions in both
  // languages; "content" opens the actual editor (builder / rich text).
  const [step, setStep] = useState<"details" | "content">("details");
  // Content-first: an established post (already titled) opens straight in the
  // editor so writing — not the dense metadata — is the landing view. Brand-new
  // / untitled posts stay on "details" so the author sets a title first. Runs
  // exactly once after the post loads and never fights later manual navigation.
  const autoStepRef = useRef(false);
  useEffect(() => {
    if (autoStepRef.current || !form) return;
    autoStepRef.current = true;
    if (form.title_pl?.trim() || form.title_en?.trim()) {
      setStep("content");
    }
  }, [form]);
  type DetailsTab =
    | "general"
    | "takeaways"
    | "settings"
    | "seo"
    | "meta"
    | "related"
    | "publish"
    | "layout"
    | "taxonomy"
    | "access"
    | "audio"
    | "revisions";
  const [detailsTab, setDetailsTab] = useState<DetailsTab>("general");

  // Inline creation of categories / tags
  const [newCatPl, setNewCatPl] = useState("");
  const [newCatEn, setNewCatEn] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [taxonomyBusy, setTaxonomyBusy] = useState<"cat" | "tag" | null>(null);
  const addCategory = async () => {
    const pl = newCatPl.trim();
    const en = newCatEn.trim() || pl;
    if (!pl) {
      toast.error("Podaj nazwę PL kategorii");
      return;
    }
    setTaxonomyBusy("cat");
    try {
      const slug = slugifyTaxonomy(pl) || slugifyTaxonomy(en) || `cat-${Date.now()}`;
      const { data, error } = await supabase
        .from("categories")
        .insert({ tenant_id: tenantId, name_pl: pl, name_en: en, slug })
        .select("id, name_pl, name_en")
        .single();
      if (error) throw error;
      if (data) {
        setSelectedCats((s) => [...s, data.id]);
        setNewCatPl("");
        setNewCatEn("");
        await qc.invalidateQueries({ queryKey: ["categories", tenantId] });
        toast.success(`Dodano kategorię: ${data.name_pl}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setTaxonomyBusy(null);
    }
  };
  const addTag = async () => {
    const name = newTagName.trim();
    if (!name) {
      toast.error("Podaj nazwę tagu");
      return;
    }
    setTaxonomyBusy("tag");
    try {
      const slug = slugifyTaxonomy(name) || `tag-${Date.now()}`;
      const { data, error } = await supabase
        .from("tags")
        .insert({ tenant_id: tenantId, name, slug })
        .select("id, name")
        .single();
      if (error) throw error;
      if (data) {
        setSelectedTags((s) => [...s, data.id]);
        setNewTagName("");
        await qc.invalidateQueries({ queryKey: ["tags", tenantId] });
        toast.success(`Dodano tag: ${data.name}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setTaxonomyBusy(null);
    }
  };

  useEffect(() => {
    if (post) history.reset(post);
  }, [post, history.reset]);
  useEffect(() => {
    if (postCats) setSelectedCats(postCats.map((c) => c.category_id));
  }, [postCats]);
  useEffect(() => {
    if (postTags) setSelectedTags(postTags.map((c) => c.tag_id));
  }, [postTags]);
  useEffect(() => {
    if (postPrograms) setSelectedPrograms(postPrograms.map((p) => p.program_id));
  }, [postPrograms]);
  useEffect(() => {
    if (postRegions) setSelectedRegions(postRegions.map((r) => r.region_id));
  }, [postRegions]);

  // Keyboard shortcuts: Ctrl/Cmd+Z = undo, Shift+Ctrl/Cmd+Z (or Ctrl+Y) = redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        history.undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        history.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history.undo, history.redo]);

  const saveFn = useCallback(
    async (snapshot: PostForm | null) => {
      if (!snapshot) return;
      const result = await update$({
        data: {
          id,
          fields: {
            slug: snapshot.slug,
            status: snapshot.status,
            publish_at: snapshot.publish_at,
            editor: snapshot.editor,
            title_pl: snapshot.title_pl,
            title_en: snapshot.title_en,
            excerpt_pl: snapshot.excerpt_pl,
            excerpt_en: snapshot.excerpt_en,
            content_pl: snapshot.content_pl,
            content_en: snapshot.content_en,
            cover_image_url: snapshot.cover_image_url,
            audio_url_pl: snapshot.audio_url_pl,
            audio_url_en: snapshot.audio_url_en,
            read_minutes: snapshot.read_minutes,
            builder_data: snapshot.builder_data,
            blocks_data: snapshot.blocks_data as unknown as Record<string, unknown> | null,
            parent_page_id: snapshot.parent_page_id,
            post_format: snapshot.post_format,
            layout_overrides: snapshot.layout_overrides,
            takeaways_pl: snapshot.takeaways_pl ?? [],
            takeaways_en: snapshot.takeaways_en ?? [],
            takeaways_variant: snapshot.takeaways_variant ?? null,
            toc_override: snapshot.toc_override ?? null,
            custom_meta: snapshot.custom_meta ?? null,
            related_override: snapshot.related_override ?? null,
            seo_title_pl: snapshot.seo_title_pl,
            seo_title_en: snapshot.seo_title_en,
            seo_description_pl: snapshot.seo_description_pl,
            seo_description_en: snapshot.seo_description_en,
            seo_canonical_url: snapshot.seo_canonical_url,
            seo_noindex: snapshot.seo_noindex ?? false,
            seo_og_image_url: snapshot.seo_og_image_url,
            og_image_generated_url: snapshot.og_image_generated_url,
          },
          categories: selectedCats,
          tags: selectedTags,
          programs: selectedPrograms,
          regions: selectedRegions,
        },
      });
      // Serwer mógł znormalizować slug (uniqueSlug dopisuje sufiks przy
      // kolizji). Nawigujemy WYŁĄCZNIE na slug faktycznie zapisany -
      // przejście na slug wpisany w formularzu załadowałoby CUDZY wpis,
      // który go posiada ("podmiana" edytowanego posta).
      const canonicalSlug = result?.slug ?? snapshot.slug;
      // WAZNE: autosave nie moze przebudowywac calego swiata przy kazdym
      // debounced zapisie - to powodowalo "auto-refresh" edytora (loadery
      // route'a znow pobieraly wiersz posta, cache widgetow leciał, a
      // router.invalidate() re-renderowal cala trase). Tutaj robimy WYLACZNIE
      // to co niezbedne dla poprawnosci UI: uaktualnienie listy w tle
      // (nastepna wizyta /admin/posts) i sygnal statusu. Cieze inwalidacje
      // (widget cache, SEO cache, router.invalidate) sa uruchamiane dopiero
      // przez explicit "Publikuj/Zapisz i wyjdz" lub przy odmontowaniu edytora.
      void qc.invalidateQueries({ queryKey: ["admin-posts"], refetchType: "none" });

      if (canonicalSlug !== snapshot.slug) {
        // Kolizja nie może być cicha: pokaz stan błędu/ostrzeżenia i zsynchronizuj
        // pole formularza z tym, co realnie trafiło do bazy.
        toast.warning(
          t("admin.slugTaken", {
            defaultValue: 'Slug był zajęty - zapisano jako "{{slug}}"',
            slug: canonicalSlug,
          }),
        );
        setSlug((f) => (f && f.slug === snapshot.slug ? { ...f, slug: canonicalSlug } : f));
      }
      if (canonicalSlug !== routeSlug) {
        navigate({ to: "/admin/posts/$slug", params: { slug: canonicalSlug }, replace: true });
      }
    },
    [
      id,
      update$,
      selectedCats,
      selectedTags,
      selectedPrograms,
      selectedRegions,
      qc,
      navigate,
      routeSlug,
      tenantId,
      router,
      setSlug,
      t,
    ],
  );

  // Symultaniczny podgląd czasu czytania PL/EN dla hinta przy read_minutes -
  // ten sam rdzeń i ustawienia (/admin/reading-time) co strona publiczna.
  const readingTimeSettings = useReadingTimeSettings();
  const autoReadMinutes = useMemo(
    () =>
      computeBilingualReadingStats(
        {
          pl: {
            html: form?.content_pl ?? "",
            docs: [form?.builder_data, form?.blocks_data?.pl],
            extraText: form?.excerpt_pl ?? undefined,
          },
          en: {
            html: form?.content_en ?? "",
            docs: [form?.builder_data, form?.blocks_data?.en],
            extraText: form?.excerpt_en ?? undefined,
          },
        },
        readingTimeSettings,
      ),
    [
      form?.content_pl,
      form?.content_en,
      form?.builder_data,
      form?.blocks_data,
      form?.excerpt_pl,
      form?.excerpt_en,
      readingTimeSettings,
    ],
  );

  // Track tuple [form, cats, tags] for autosave so taxonomies persist too.
  const autoValue = useMemo(
    () => ({ form, cats: selectedCats, tags: selectedTags }),
    [form, selectedCats, selectedTags],
  );
  const autosave = useAutosave({
    value: autoValue,
    enabled: !!form,
    save: async (v) => {
      await saveFn(v.form);
    },
  });
  // Tab close / route change with unsaved edits -> confirmation prompt.
  useUnsavedChangesGuard(autosave.isDirty || autosave.status === "saving");

  // Ciezkie inwalidacje (widget cache, SEO cache, router.invalidate) NIE
  // odpalaja sie przy kazdym autozapisie (patrz saveFn) - to powodowaloby
  // ciagle "auto-refresh" edytora. Zamiast tego uruchamiamy je raz przy
  // opuszczeniu edytora, tak zeby publiczne widoki i dashboard SEO zaladowaly
  // swiezy stan przy nastepnej wizycie uzytkownika.
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (autosave.status === "saved") dirtyRef.current = true;
  }, [autosave.status]);
  useEffect(() => {
    return () => {
      if (!dirtyRef.current) return;
      void qc.invalidateQueries({ queryKey: ["admin-posts"] });
      invalidateWidgetCaches(qc);
      emitWidgetCacheInvalidate();
      invalidateSeoCaches(qc, router);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading || !form) return <div className="text-sm text-muted-foreground">...</div>;

  const set = <K extends keyof PostForm>(k: K, v: PostForm[K]) =>
    history.set((f) => (f ? { ...f, [k]: v } : f), { coalesceKey: String(k) });

  const pickImage = async (): Promise<string | null> =>
    promptDialog({
      title: t("admin.imageUrlTitle", { defaultValue: "Adres URL obrazka" }),
      placeholder: "https://…",
      confirmLabel: t("admin.insert", { defaultValue: "Wstaw" }),
    });

  const save = async () => {
    if (hasBlockingSeoIssues(seoIssues)) {
      toast.error(
        t("admin.seo.validation.blockToast", {
          defaultValue: "Zapis wstrzymany: pola SEO przekraczają twardy limit znaków.",
        }),
      );
      return;
    }
    const pixelWarnings = seoIssues.filter((i) => i.severity === "warning");
    if (pixelWarnings.length > 0) {
      toast.warning(
        t("admin.seo.validation.warnToast", {
          defaultValue: "Zapisano, ale {{count}} pól SEO zostanie uciętych w Google.",
          count: pixelWarnings.length,
        }),
      );
    }
    setBusy(true);
    try {
      await autosave.flush();
      toast.success(t("admin.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Discard unsaved edits by reverting to the last SAVED snapshot - not the
  // stale mount-time row (autosave would then persist that stale content over
  // newer already-saved work).
  const discardToSaved = () => {
    const saved = autosave.lastSaved;
    if (saved.form) history.reset(saved.form);
    setSelectedCats(saved.cats);
    setSelectedTags(saved.tags);
  };

  const del = async () => {
    if (
      !(await confirmDialog({
        title: t("admin.confirmDelete"),
        destructive: true,
        confirmLabel: t("admin.delete", { defaultValue: "Usuń" }),
      }))
    )
      return;
    try {
      await delete$({ data: { id } });
      toast.success(t("admin.deleted"));
      navigate({ to: "/admin/posts" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  // Save with an explicit status transition (submit / approve / reject) in a
  // single snapshot, so autosave races cannot split the change in two.
  const applyStatus = async (status: PostWorkflowStatus) => {
    const next: PostForm = { ...form, status };
    history.set(() => next);
    setBusy(true);
    try {
      await saveFn(next);
      toast.success(t("admin.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onRevisionRestored = () => {
    void qc.invalidateQueries({ queryKey: ["post-by-slug", tenantId, routeSlug] });
    invalidateWidgetCaches(qc);
    emitWidgetCacheInvalidate();
  };

  const statusOptions = statusOptionsFor({ canPublish });
  const scheduledInPast =
    form.status === "scheduled" &&
    !!form.publish_at &&
    new Date(form.publish_at).getTime() <= Date.now();

  const workflowSection = (
    <WorkflowStatusSection
      status={form.status}
      publishAt={form.publish_at}
      publishedAt={form.published_at}
      canPublish={canPublish}
      busy={busy}
      statusOptions={statusOptions}
      scheduledInPast={scheduledInPast}
      uiLang={uiLang}
      onStatusChange={(v) => set("status", v)}
      onPublishAtChange={(v) => set("publish_at", v)}
      onApplyStatus={applyStatus}
    />
  );

  const metaCard = (
    <SidebarSection
      title={t("admin.posts.settingsCard", { defaultValue: "Ustawienia wpisu" })}
      icon={SettingsIcon}
    >
      {workflowSection}
      <SidebarSection
        title={t("admin.posts.editorAdvanced", { defaultValue: "Zaawansowane: typ edytora" })}
        icon={Layers}
        defaultOpen={false}
      >
        <p className="text-[11px] text-muted-foreground -mt-1">
          {t("admin.posts.editorAdvancedHint", {
            defaultValue:
              "Domyślnie używany jest edytor blokowy. Zmień tylko jeśli wiesz, czego potrzebujesz.",
          })}
        </p>
        <div>
          <Label className="inline-flex items-center gap-1">
            {t("admin.posts.editor")}
            <InfoHint
              text={t("admin.posts.editorHint", {
                defaultValue:
                  "Bloki = zalecany edytor. Visual Builder = układ przeciągnij-i-upuść. Rich text / Markdown = starsze tryby tekstowe.",
              })}
            />
          </Label>
          <Select value={form.editor} onValueChange={(v) => set("editor", v as EditorType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="blocks">
                {t("admin.posts.editorBlocks", { defaultValue: "Block editor (zalecane)" })}
              </SelectItem>
              <SelectItem value="builder">
                {t("admin.posts.editorBuilder", { defaultValue: "Visual Builder (Elementor)" })}
              </SelectItem>
              <SelectItem value="richtext">
                {t("admin.posts.editorRichtext", { defaultValue: "Rich text (legacy)" })}
              </SelectItem>
              <SelectItem value="markdown">
                {t("admin.posts.editorMarkdown", { defaultValue: "Markdown (legacy)" })}
              </SelectItem>
            </SelectContent>
          </Select>
          {form.editor !== "blocks" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              onClick={async () => {
                try {
                  const res = await migrate$({ data: { id: form.id } });
                  toast.success(
                    t("admin.posts.migrateOk", {
                      defaultValue: "Skonwertowano na bloki (źródło: {{src}})",
                      src: res.source,
                    }),
                  );
                  await qc.invalidateQueries({ queryKey: ["post-by-slug", tenantId, routeSlug] });
                } catch (e) {
                  toastError(e, "generic");
                }
              }}
            >
              {t("admin.posts.migrateToBlocks", { defaultValue: "Konwertuj na bloki" })}
            </Button>
          )}
        </div>
      </SidebarSection>
      <div>
        <Label className="inline-flex items-center gap-1">
          Slug
          <InfoHint
            text={t("admin.posts.slugHint", {
              defaultValue:
                "Część adresu URL wpisu. Zmiana slug zmienia link; przy kolizji serwer dopisze sufiks.",
            })}
          />
        </Label>
        <Input value={form.slug} onChange={(e) => set("slug", e.target.value)} />
      </div>
      <div>
        <Label className="inline-flex items-center gap-1">
          {t("admin.posts.parentLabel", { defaultValue: "Strona nadrzędna" })}
          <InfoHint
            text={t("admin.posts.parentHint", {
              defaultValue:
                "Umieszcza wpis w ścieżce URL wybranej strony i wpływa na nawigację/breadcrumbs.",
            })}
          />
        </Label>
        <PageParentSelect
          tenantId={tenantId}
          value={form.parent_page_id}
          onChange={(v) => v && set("parent_page_id", v)}
          label=""
          noneLabel={t("admin.posts.parentNone", { defaultValue: "- wybierz stronę -" })}
        />
      </div>
      <div>
        <Label>{t("admin.posts.readMinutes")}</Label>
        <Input
          type="number"
          value={form.read_minutes ?? ""}
          onChange={(e) => set("read_minutes", e.target.value ? Number(e.target.value) : null)}
          placeholder={t("admin.posts.readMinutesAuto", { defaultValue: "auto" })}
        />
        {/* Symultaniczny podgląd automatu dla OBU wersji językowych, liczony
            tym samym rdzeniem i ustawieniami co strona publiczna
            (/admin/reading-time). Puste pole = czytelnik dostaje automat. */}
        <p className="mt-1 text-xs text-muted-foreground">
          {t("admin.posts.readMinutesHint", {
            defaultValue: "Auto: PL {{pl}} min · EN {{en}} min. Puste pole = automat.",
            pl: autoReadMinutes.pl.minutes,
            en: autoReadMinutes.en.minutes,
          })}
        </p>
      </div>
      <div>
        <CoverImagePicker
          label={t("admin.posts.cover")}
          value={form.cover_image_url ?? ""}
          onChange={(v: string) => set("cover_image_url", v || null)}
        />
      </div>
    </SidebarSection>
  );

  const ov: LayoutOverrides = (form.layout_overrides ?? {}) as LayoutOverrides;
  const setOv = (patch: Partial<LayoutOverrides>) => {
    const next = { ...ov, ...patch };
    // Drop empty object to null for cleanliness
    const hasAny = Object.values(next).some((v) => v !== undefined && v !== null && v !== "");
    set("layout_overrides", hasAny ? next : null);
  };
  const currentFormat: PostFormat = (ov.format ?? form.post_format ?? "standard") as PostFormat;
  const layoutSet = getLayoutSet(currentFormat);

  const layoutCard = (
    <LayoutOverridesCard
      postFormat={form.post_format}
      onPostFormatChange={(v) => set("post_format", v)}
      ov={ov}
      onOverridesChange={setOv}
      currentFormat={currentFormat}
      layoutSet={layoutSet}
      globalLayout={globalLayout}
    />
  );

  const catsCard = (
    <CategoriesCard
      allCats={allCats}
      selectedCats={selectedCats}
      onSelectedCatsChange={setSelectedCats}
      newCatPl={newCatPl}
      onNewCatPlChange={setNewCatPl}
      newCatEn={newCatEn}
      onNewCatEnChange={setNewCatEn}
      taxonomyBusy={taxonomyBusy}
      onAddCategory={() => void addCategory()}
    />
  );

  const tagsCard = (
    <TagsCard
      allTags={allTags}
      selectedTags={selectedTags}
      onSelectedTagsChange={setSelectedTags}
      newTagName={newTagName}
      onNewTagNameChange={setNewTagName}
      taxonomyBusy={taxonomyBusy}
      onAddTag={() => void addTag()}
    />
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {step === "details" ? (
            <Link
              to="/admin/posts"
              className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-4 h-4" /> {t("admin.back")}
            </Link>
          ) : (
            <button
              onClick={() => setStep("details")}
              className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              <ArrowLeft className="w-4 h-4" /> Szczegóły wpisu
            </button>
          )}
          <div className="flex items-center gap-2">
            {/* Step indicator */}
            <div className="hidden md:flex items-center gap-1 mr-2 text-xs">
              <button
                onClick={() => setStep("details")}
                className={`px-2 py-1 rounded inline-flex items-center gap-1 ${step === "details" ? "bg-brand text-brand-foreground" : "bg-muted hover:bg-muted/70"}`}
              >
                <SettingsIcon className="w-3.5 h-3.5" /> 1. Szczegóły
              </button>
              <span className="text-muted-foreground">→</span>
              <button
                onClick={() => setStep("content")}
                className={`px-2 py-1 rounded inline-flex items-center gap-1 ${step === "content" ? "bg-brand text-brand-foreground" : "bg-muted hover:bg-muted/70"}`}
              >
                <FileText className="w-3.5 h-3.5" /> 2. Treść
              </button>
            </div>
            <AutosaveBar
              status={autosave.status}
              error={autosave.error}
              canUndo={history.canUndo}
              canRedo={history.canRedo}
              onUndo={history.undo}
              onRedo={history.redo}
              onDiscard={discardToSaved}
            />

            <Button variant="ghost" size="sm" onClick={del}>
              <Trash2 className="w-4 h-4 mr-1 text-destructive" /> {t("admin.delete")}
            </Button>
            <Button onClick={save} disabled={busy}>
              <Save className="w-4 h-4 mr-2" /> {busy ? "..." : t("admin.save")}
            </Button>
          </div>
        </div>

        <EditPresenceBanner entityType="post" entityId={id} />

        {step === "details" ? (
          (() => {
            type TabDef = {
              id: DetailsTab;
              label: string;
              icon: typeof SettingsIcon;
              hint?: string;
            };
            const groups: { id: string; label: string; tabs: TabDef[] }[] = [
              {
                id: "content",
                label: "Treść",
                tabs: [
                  { id: "general", label: "Ogólne", icon: FileText, hint: "Tytuły i zajawki" },
                  {
                    id: "takeaways",
                    label: "Dowiesz się…",
                    icon: ListChecks,
                    hint: "Kluczowe punkty PL/EN + wariant",
                  },
                  {
                    id: "audio",
                    label: "Audio (MP3)",
                    icon: Mic,
                    hint: "PL/EN · fallback do lektora AI",
                  },
                ],
              },
              {
                id: "structure",
                label: "Struktura",
                tabs: [
                  {
                    id: "settings",
                    label: "Ustawienia strony",
                    icon: SettingsIcon,
                    hint: "Spis treści · Ochrona treści",
                  },
                  { id: "layout", label: "Layout", icon: Layers, hint: "Format i wygląd" },
                  { id: "taxonomy", label: "Kategorie i tagi", icon: TagIcon },
                  {
                    id: "related",
                    label: "Powiązane wpisy",
                    icon: LinkIconLucide,
                    hint: "Override",
                  },
                ],
              },
              {
                id: "seo",
                label: "SEO i meta",
                tabs: [
                  {
                    id: "seo",
                    label: "SEO i podgląd",
                    icon: Search,
                    hint: "Meta title/description, OG",
                  },
                  { id: "meta", label: "Custom meta", icon: Database, hint: "Własne pola" },
                ],
              },
              {
                id: "publication",
                label: "Publikacja",
                tabs: [
                  {
                    id: "publish",
                    label: "Publikacja",
                    icon: SettingsIcon,
                    hint: "Status, slug, cover",
                  },
                  { id: "access", label: "Dostęp", icon: Lock, hint: "Paywall / role" },
                ],
              },
              {
                id: "history",
                label: "Historia",
                tabs: [{ id: "revisions", label: "Historia zmian", icon: History }],
              },
            ];
            return (
              <div className="flex flex-col md:flex-row gap-6">
                <aside className="md:w-64 shrink-0">
                  <nav className="bg-card border border-border rounded-lg p-2 space-y-3 sticky top-4">
                    {groups.map((group, gi) => (
                      <div key={group.id} className={gi > 0 ? "pt-2 border-t border-border" : ""}>
                        <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                          {group.label}
                        </div>
                        <div className="space-y-0.5">
                          {group.tabs.map((tab) => {
                            const Icon = tab.icon;
                            const active = detailsTab === tab.id;
                            return (
                              <button
                                key={tab.id}
                                type="button"
                                onClick={() => setDetailsTab(tab.id)}
                                aria-current={active ? "page" : undefined}
                                className={`w-full text-left px-3 py-2 rounded-md text-sm transition flex items-start gap-2.5 ${
                                  active
                                    ? "bg-brand text-brand-foreground"
                                    : "text-foreground hover:bg-muted"
                                }`}
                              >
                                <Icon
                                  className={`w-4 h-4 mt-0.5 shrink-0 ${active ? "" : "text-muted-foreground"}`}
                                />
                                <span className="flex-1 min-w-0">
                                  <span className="block font-medium leading-tight">
                                    {tab.label}
                                  </span>
                                  {tab.hint && (
                                    <span
                                      className={`block text-[11px] leading-tight mt-0.5 ${
                                        active
                                          ? "text-brand-foreground/80"
                                          : "text-muted-foreground"
                                      }`}
                                    >
                                      {tab.hint}
                                    </span>
                                  )}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </nav>
                </aside>
                <section className="flex-1 min-w-0">
                  <div className="bg-card border border-border rounded-lg p-5 md:p-6 space-y-5">
                    {detailsTab === "general" && (
                      <PostGeneralOverview
                        entityId={id}
                        titlePl={form.title_pl}
                        titleEn={form.title_en}
                        onTitlePlChange={(v) => set("title_pl", v)}
                        onTitleEnChange={(v) => set("title_en", v)}
                        excerptPl={form.excerpt_pl ?? ""}
                        excerptEn={form.excerpt_en ?? ""}
                        onExcerptPlChange={(v) => set("excerpt_pl", v)}
                        onExcerptEnChange={(v) => set("excerpt_en", v)}
                        status={form.status}
                        slug={form.slug}
                        coverImageUrl={form.cover_image_url}
                        publishedAt={form.published_at}
                        publishAt={form.publish_at}
                        seoTitlePl={form.seo_title_pl}
                        seoTitleEn={form.seo_title_en}
                        seoDescriptionPl={form.seo_description_pl}
                        seoDescriptionEn={form.seo_description_en}
                        seoNoindex={form.seo_noindex}
                        seoIssues={seoIssues}
                        tocOverride={form.toc_override ?? null}
                        takeawaysPl={form.takeaways_pl ?? []}
                        takeawaysEn={form.takeaways_en ?? []}
                        customMeta={form.custom_meta}
                        relatedOverride={form.related_override}
                        postFormat={(form.post_format ?? "standard") as PostFormat}
                        layoutOverrides={form.layout_overrides}
                        selectedCatNames={(allCats ?? [])
                          .filter((c) => selectedCats.includes(c.id))
                          .map((c) =>
                            uiLang === "en" ? c.name_en || c.name_pl : c.name_pl || c.name_en,
                          )}
                        selectedTagNames={(allTags ?? [])
                          .filter((tg) => selectedTags.includes(tg.id))
                          .map((tg) => tg.name)}
                        onNavigate={(tab) => setDetailsTab(tab)}
                      />
                    )}

                    {detailsTab === "settings" && (
                      <PostSettingsMetabox
                        entityType="post"
                        entityId={id}
                        tocOverride={form.toc_override ?? null}
                        onTocOverrideChange={(next) => set("toc_override", next)}
                        postBlocks={form.blocks_data ?? null}
                        hideTakeawaysTab
                      />
                    )}

                    {detailsTab === "takeaways" && (
                      <section className="rounded-xl border border-border bg-card overflow-hidden">
                        <header className="px-4 py-3 border-b border-border bg-muted/30">
                          <h3 className="text-sm font-semibold">Dowiesz się…</h3>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Kluczowe punkty wpisu w PL i EN. Wybierz wariant wizualny lub zostaw
                            globalny.
                          </p>
                        </header>
                        <div className="p-4">
                          <TakeawaysTab
                            pl={form.takeaways_pl ?? []}
                            en={form.takeaways_en ?? []}
                            onChange={(lang, next) =>
                              set(lang === "pl" ? "takeaways_pl" : "takeaways_en", next)
                            }
                            variantOverride={form.takeaways_variant ?? null}
                            onVariantChange={(next) => set("takeaways_variant", next)}
                          />
                        </div>
                      </section>
                    )}

                    {detailsTab === "seo" && (
                      <SeoPanel
                        value={{
                          seo_title_pl: form.seo_title_pl,
                          seo_title_en: form.seo_title_en,
                          seo_description_pl: form.seo_description_pl,
                          seo_description_en: form.seo_description_en,
                          seo_canonical_url: form.seo_canonical_url,
                          seo_noindex: form.seo_noindex ?? false,
                          seo_og_image_url: form.seo_og_image_url,
                          og_image_generated_url: form.og_image_generated_url,
                        }}
                        onChange={(patch) =>
                          history.set((f) => (f ? { ...f, ...patch } : f), {
                            coalesceKey: Object.keys(patch).sort().join("|"),
                          })
                        }
                        entity={{ kind: "post", id }}
                        slug={form.slug}
                        pathSourcePageId={form.parent_page_id}
                        fallbackTitle={{ pl: form.title_pl, en: form.title_en }}
                        fallbackDescription={{ pl: form.excerpt_pl, en: form.excerpt_en }}
                        coverImageUrl={form.cover_image_url}
                        ogKicker={
                          allCats?.find((c) => selectedCats.includes(c.id))?.name_pl ?? null
                        }
                        onIssuesChange={setSeoIssues}
                      />
                    )}

                    {detailsTab === "meta" && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <h2 className="text-lg font-display font-semibold">Custom meta</h2>
                            <p className="text-xs text-muted-foreground">
                              Wartości własnych pól dla tego wpisu.
                            </p>
                          </div>
                          <Link to="/admin/custom-meta" className="text-xs text-brand underline">
                            Edytuj definicje
                          </Link>
                        </div>
                        <CustomMetaValuesEditor
                          tenantId={tenantId}
                          lang="pl"
                          values={form.custom_meta}
                          onChange={(next) => set("custom_meta", next)}
                        />
                      </div>
                    )}

                    {detailsTab === "related" && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <h2 className="text-lg font-display font-semibold">
                              Powiązane wpisy - override
                            </h2>
                            <p className="text-xs text-muted-foreground">
                              Nadpisuje globalną konfigurację dla tego wpisu.
                            </p>
                          </div>
                          <Link to="/admin/related-posts" className="text-xs text-brand underline">
                            Konfiguracja globalna
                          </Link>
                        </div>
                        <RelatedOverrideEditor
                          value={form.related_override}
                          onChange={(next: Record<string, unknown> | null) =>
                            set("related_override", next)
                          }
                        />
                      </div>
                    )}

                    {detailsTab === "publish" && <div className="space-y-4">{metaCard}</div>}

                    {detailsTab === "layout" && <div className="space-y-4">{layoutCard}</div>}

                    {detailsTab === "taxonomy" && (
                      <div className="grid md:grid-cols-2 gap-4">
                        {catsCard}
                        {tagsCard}
                      </div>
                    )}

                    {detailsTab === "access" && (
                      <AccessSettingsPane entityType="post" entityId={id} />
                    )}

                    {detailsTab === "audio" && (
                      <section className="rounded-xl border border-border bg-card overflow-hidden">
                        <header className="px-4 py-3 border-b border-border bg-muted/30">
                          <h3 className="text-sm font-semibold inline-flex items-center gap-2">
                            <Mic className="w-4 h-4 text-brand" />
                            Audio wpisu (MP3)
                          </h3>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Wgraj własny plik audio dla PL i/lub EN. Dla języka bez wgranego pliku
                            użyty zostanie automatyczny lektor AI (ElevenLabs). Max 50 MB · MP3,
                            M4A, AAC, OGG, WAV.
                          </p>
                        </header>
                        <div className="p-4 grid md:grid-cols-2 gap-4">
                          <AudioPicker
                            label="Plik audio - polski (PL)"
                            value={form.audio_url_pl ?? ""}
                            onChange={(v: string) => set("audio_url_pl", v || null)}
                            hint="Wgrany plik zastępuje ElevenLabs dla PL. Usuń, aby wrócić do lektora AI."
                          />
                          <AudioPicker
                            label="Plik audio - angielski (EN)"
                            value={form.audio_url_en ?? ""}
                            onChange={(v: string) => set("audio_url_en", v || null)}
                            hint="Wgrany plik zastępuje ElevenLabs dla EN. Usuń, aby wrócić do lektora AI."
                          />
                        </div>
                      </section>
                    )}

                    {detailsTab === "revisions" && (
                      <RevisionsCard
                        entityType="post"
                        entityId={id}
                        onRestored={onRevisionRestored}
                      />
                    )}

                    <div className="flex justify-end pt-2 border-t border-border">
                      <Button
                        onClick={() => setStep("content")}
                        disabled={!form.title_pl.trim() && !form.title_en.trim()}
                      >
                        Przejdź do edycji treści <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </div>
                  </div>
                </section>
              </div>
            );
          })()
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3 bg-card border border-border rounded-lg p-2 pl-4">
              <div className="text-xs text-muted-foreground">
                {t("admin.posts.editorMode", { defaultValue: "Tryb edytora" })}
              </div>
              <div className="inline-flex rounded-md border border-border bg-background p-0.5">
                <button
                  type="button"
                  onClick={() => set("editor", "blocks")}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${form.editor === "blocks" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  aria-pressed={form.editor === "blocks"}
                >
                  Gutenberg
                </button>
                <button
                  type="button"
                  onClick={() => set("editor", "builder")}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${form.editor === "builder" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  aria-pressed={form.editor === "builder"}
                >
                  Elementor
                </button>
              </div>
            </div>
            {form.editor === "blocks" ? (
              <PostBlockEditor
                value={form.blocks_data ?? { pl: EMPTY_BLOCKS_DOC, en: EMPTY_BLOCKS_DOC }}
                onChange={(v) => set("blocks_data", v)}
                canvasWrap={(canvas, lang) => {
                  if (!globalLayout) return canvas;
                  const effective = mergeOverrides(globalLayout, ov);
                  const layoutId = pickLayoutId(globalLayout, currentFormat, ov.layout);
                  const title =
                    lang === "en" ? form.title_en || form.title_pl : form.title_pl || form.title_en;
                  const excerpt = lang === "en" ? form.excerpt_en : form.excerpt_pl;
                  return (
                    <LayoutScaffold
                      format={currentFormat}
                      layoutId={layoutId}
                      settings={effective}
                      title={title}
                      excerpt={excerpt}
                      coverImageUrl={form.cover_image_url}
                    >
                      {canvas}
                    </LayoutScaffold>
                  );
                }}
                documentPane={
                  <div className="space-y-4">
                    {metaCard}
                    {layoutCard}
                    {catsCard}
                    {tagsCard}
                    <AccessSettingsPane entityType="post" entityId={id} />
                    <RevisionsCard
                      entityType="post"
                      entityId={id}
                      onRestored={onRevisionRestored}
                    />
                  </div>
                }
              />
            ) : form.editor === "builder" ? (
              <BuilderPane form={form} set={set} />
            ) : (
              <Tabs defaultValue="pl">
                <TabsList>
                  <TabsTrigger value="pl">🇵🇱 Polski</TabsTrigger>
                  <TabsTrigger value="en">🇬🇧 English</TabsTrigger>
                </TabsList>
                <TabsContent value="pl" className="space-y-4 mt-4">
                  <div>
                    <Label>{t("admin.posts.content")} (PL)</Label>
                    <PostEditor
                      mode={form.editor === "markdown" ? "markdown" : "richtext"}
                      value={form.content_pl ?? ""}
                      onChange={(v) => set("content_pl", v)}
                      onPickImage={pickImage}
                    />
                  </div>
                </TabsContent>
                <TabsContent value="en" className="space-y-4 mt-4">
                  <div>
                    <Label>{t("admin.posts.content")} (EN)</Label>
                    <PostEditor
                      mode={form.editor === "markdown" ? "markdown" : "richtext"}
                      value={form.content_en ?? ""}
                      onChange={(v) => set("content_en", v)}
                      onPickImage={pickImage}
                    />
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

function BuilderPane({
  form,
  set,
}: {
  form: { builder_data: BuilderDocument | null };
  set: (k: "builder_data", v: BuilderDocument) => void;
}) {
  const [lang, setLang] = useState<"pl" | "en">("pl");
  return (
    <Builder
      value={form.builder_data}
      onChange={(v) => set("builder_data", v)}
      lang={lang}
      onLangChange={setLang}
    />
  );
}
