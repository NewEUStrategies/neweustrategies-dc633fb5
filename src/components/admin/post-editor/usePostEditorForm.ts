// Maszyna stanu formularza edytora wpisu: undo/redo + autosave + zapisy ze
// zmianą statusu + miękka bramka checklisty publikacji + inwalidacje przy
// wyjściu. Wyodrębnione 1:1 z trasy admin.posts.$slug (rozbicie monolitu;
// zachowanie bez zmian - komentarze wyjaśniające przeniesione razem z kodem).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { updatePost, deletePost } from "@/lib/content.functions";
import { useUndoRedo } from "@/hooks/useUndoRedo";
import { useAutosave } from "@/hooks/useAutosave";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { buildPublishChecklist, isPublishTransition } from "@/lib/content/publishChecklist";
import { statusOptionsFor, type PostWorkflowStatus } from "@/lib/content/workflow";
import { useAuth } from "@/hooks/useAuth";
import { confirmDialog } from "@/lib/appDialogs";
import {
  invalidateWidgetCaches,
  emitWidgetCacheInvalidate,
} from "@/lib/builder/widgetCacheInvalidation";
import { invalidateSeoCaches } from "@/lib/seo/invalidate";
import { hasBlockingSeoIssues, type SeoIssue } from "@/lib/seo/validation";
import type { PostForm } from "./postForm";
import type { PostEditorData } from "./usePostEditorData";

export function usePostEditorForm(routeSlug: string, data: PostEditorData) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const router = useRouter();
  const qc = useQueryClient();
  const { tenantId, post, id } = data;
  // Editorial workflow: only admin / super_admin publish or schedule directly;
  // authors and editors submit for review (mirrored server-side + DB trigger).
  const { isAdmin: canPublish } = useAuth();
  const update$ = useServerFn(updatePost);
  const delete$ = useServerFn(deletePost);

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

  useEffect(() => {
    if (post) history.reset(post);
  }, [post, history.reset]);
  useEffect(() => {
    if (data.postCats) setSelectedCats(data.postCats.map((c) => c.category_id));
  }, [data.postCats]);
  useEffect(() => {
    if (data.postTags) setSelectedTags(data.postTags.map((c) => c.tag_id));
  }, [data.postTags]);
  useEffect(() => {
    if (data.postPrograms) setSelectedPrograms(data.postPrograms.map((p) => p.program_id));
  }, [data.postPrograms]);
  useEffect(() => {
    if (data.postRegions) setSelectedRegions(data.postRegions.map((r) => r.region_id));
  }, [data.postRegions]);

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

  // Track tuple [form, cats, tags] for autosave so taxonomies persist too.
  const autoValue = useMemo(
    () => ({
      form,
      cats: selectedCats,
      tags: selectedTags,
      programs: selectedPrograms,
      regions: selectedRegions,
    }),
    [form, selectedCats, selectedTags, selectedPrograms, selectedRegions],
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

  const set = useCallback(
    <K extends keyof PostForm>(k: K, v: PostForm[K]) =>
      history.set((f) => (f ? { ...f, [k]: v } : f), { coalesceKey: String(k) }),
    [history.set],
  );

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
    setSelectedPrograms(saved.programs);
    setSelectedRegions(saved.regions);
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

  // Checklista publikacji: jedna ocena zasila kartę w sidebarze i miękką
  // bramkę przy wejściu w published/scheduled. Autosave i zwykłe zapisy już
  // opublikowanych wpisów nie przechodzą przez bramkę (isPublishTransition).
  const publishChecklist = form
    ? buildPublishChecklist({
        title_pl: form.title_pl,
        title_en: form.title_en,
        excerpt_pl: form.excerpt_pl,
        excerpt_en: form.excerpt_en,
        cover_image_url: form.cover_image_url,
        seo_description_pl: form.seo_description_pl,
        seo_description_en: form.seo_description_en,
        seo_noindex: form.seo_noindex,
        takeaways_pl: form.takeaways_pl,
        categoriesCount: selectedCats.length,
        tagsCount: selectedTags.length,
      })
    : null;

  // Miękka bramka: przy brakach w pozycjach wymaganych pytamy, nie blokujemy.
  const confirmPublishGaps = async (nextStatus: PostWorkflowStatus): Promise<boolean> => {
    if (!form || !publishChecklist) return true;
    if (!isPublishTransition(form.status, nextStatus)) return true;
    if (publishChecklist.requiredOk) return true;
    const missing = publishChecklist.missingRequired
      .map((i) => t(`adminPostPanes.publishChecklist.items.${i.id}`))
      .join(", ");
    return confirmDialog({
      title: t("adminPostPanes.publishChecklist.gateTitle"),
      description: t("adminPostPanes.publishChecklist.gateBody", { missing }),
      confirmLabel: t("adminPostPanes.publishChecklist.publishAnyway"),
      cancelLabel: t("adminPostPanes.publishChecklist.backToEditing"),
    });
  };

  // Save with an explicit status transition (submit / approve / reject) in a
  // single snapshot, so autosave races cannot split the change in two.
  const applyStatus = async (status: PostWorkflowStatus) => {
    if (!form) return;
    if (!(await confirmPublishGaps(status))) return;
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
    !!form &&
    form.status === "scheduled" &&
    !!form.publish_at &&
    new Date(form.publish_at).getTime() <= Date.now();

  return {
    form,
    history,
    set,
    canPublish,
    busy,
    seoIssues,
    setSeoIssues,
    selectedCats,
    setSelectedCats,
    selectedTags,
    setSelectedTags,
    selectedPrograms,
    setSelectedPrograms,
    selectedRegions,
    setSelectedRegions,
    autosave,
    save,
    discardToSaved,
    del,
    applyStatus,
    confirmPublishGaps,
    publishChecklist,
    onRevisionRestored,
    statusOptions,
    scheduledInPast,
  };
}

export type PostEditorFormApi = ReturnType<typeof usePostEditorForm>;
