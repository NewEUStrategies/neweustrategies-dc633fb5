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
import { registerMediaUpload } from "@/lib/media.functions";
import { uploadAndRegisterMedia, IMAGE_MIME } from "@/lib/media/upload";
import { persistDataUrlImages, type DecodedDataUrl } from "@/lib/blocks/persistImages";
import {
  applyPersistedImages,
  historyShortcut,
  missingRequiredKeys,
  replaceFormImageUrls,
} from "../lib";
import { useHistory } from "@/hooks/useHistory";
import { useAutosave } from "@/hooks/useAutosave";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { buildPublishChecklist, isPublishTransition } from "@/lib/content/publishChecklist";
import { disclosureGaps } from "@/lib/content/sponsored";
// Nakładka rejestruje klucze EFEKTEM UBOCZNYM importu, a ten hook woła
// `adminPostPanes.sponsored.*` w obsłudze odrzuconej publikacji. Bez tej linijki
// redaktor zobaczyłby w toaście goły klucz zamiast komunikatu - i to dokładnie
// w momencie, w którym potrzebuje wiedzieć, czego brakuje.
import "@/lib/i18n-admin-post-panes";
import { statusOptionsFor, type PostWorkflowStatus } from "@/lib/content/workflow";
import { useAuth } from "@/hooks/useAuth";
import { confirmDialog } from "@/lib/appDialogs";
import {
  invalidateWidgetCaches,
  emitWidgetCacheInvalidate,
} from "@/lib/builder/widgetCacheInvalidation";
import { invalidateSeoCaches } from "@/lib/seo/invalidate";
import { type SeoIssue } from "@/lib/seo/validation";
import {
  buildPostPatch,
  isScheduledInPast,
  nextBaseUpdatedAt,
  resolveSlugOutcome,
  saveErrorDescriptor,
  seoSaveGate,
} from "../lib/postPatch";
import type { PostForm } from "../types";
import type { PostEditorData } from "./usePostEditorData";

export function usePostEditorForm(routeSlug: string, data: PostEditorData) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const router = useRouter();
  const qc = useQueryClient();
  const { tenantId, post, id } = data;
  // Editorial workflow: only admin / super_admin publish or schedule directly;
  // authors and editors submit for review (mirrored server-side + DB trigger).
  const { isAdmin: canPublish, user } = useAuth();
  const update$ = useServerFn(updatePost);
  const delete$ = useServerFn(deletePost);
  const registerUpload$ = useServerFn(registerMediaUpload);
  // Wklejone grafiki: dataUrl -> publiczny URL. Cache chroni przed ponownym
  // uploadem tej samej grafiki przy kolejnych autosave'ach tej sesji edycji.
  const imageUploadCacheRef = useRef(new Map<string, string>());

  const history = useHistory<PostForm | null>(null);
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
  // Baza optimistic-locka: updated_at ostatnio załadowanego/zapisanego wiersza.
  // Aktualizowana z odpowiedzi serwera po każdym zapisie, by kolejny zapis nie
  // zgłaszał fałszywego konfliktu.
  const baseUpdatedAtRef = useRef<string | null>(null);

  // Reset TYLKO przy pierwszym załadowaniu wpisu (post.id się zmienia).
  // Kolejne refetche `post-by-slug` przynoszą starszy updated_at (cache nie
  // jest bumpowany po autosave); zastąpienie baseUpdatedAtRef stalą wartością
  // powodowało EDIT_CONFLICT przy następnym zapisie.
  const loadedPostIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!post) return;
    if (loadedPostIdRef.current === post.id) return;
    loadedPostIdRef.current = post.id;
    history.reset(post);
    baseUpdatedAtRef.current = post.updated_at ?? null;
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
      const action = historyShortcut(e);
      if (!action) return;
      e.preventDefault();
      if (action === "undo") history.undo();
      else history.redo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history.undo, history.redo]);

  // Wklejone grafiki (data-URL z Worda / zrzutów ekranu) muszą przy zapisie
  // trafić do biblioteki mediów, a dokument dostać publiczne adresy storage -
  // baza nie przechowuje base64, a grafika jest widoczna w /admin/media.
  const persistPastedImages = useCallback(
    // Generyk przenosi typ dokumentu wołającego na wylot (LocalizedBlocks,
    // BuilderDocument) - bez niego każde wejście i wyjście wymagało pary
    // rzutowań, bo interfejs nie jest przypisywalny do `Json` (brak sygnatury
    // indeksu). Uzasadnienie przy `replaceDataUrlImages`.
    async <T>(doc: T | null | undefined): Promise<{ doc: T | null; changed: boolean }> => {
      if (!doc || !user?.id || !tenantId) return { doc: doc ?? null, changed: false };
      const upload = async (decoded: DecodedDataUrl): Promise<string> => {
        const file = new File([decoded.bytes as BlobPart], decoded.filename, {
          type: decoded.mime,
        });
        const uploaded = await uploadAndRegisterMedia({
          file,
          tenantId,
          userId: user.id,
          registerMedia: registerUpload$,
          allowedMime: IMAGE_MIME,
          subfolder: "posts",
        });
        return uploaded.publicUrl;
      };
      const result = await persistDataUrlImages(doc, upload, imageUploadCacheRef.current);
      if (result.failed > 0) {
        toast.warning(
          t("blocks.clipboard.imagePersistFailed", {
            count: result.failed,
          }),
          { id: "blocks-image-persist" },
        );
      }
      if (result.changed) {
        // Ten sam mapping nakładamy na BIEŻĄCY stan formularza (mógł już
        // zawierać nowsze zmiany tekstu) - edytor od razu pokazuje URL-e
        // storage i kolejny autosave nie wgrywa grafik ponownie.
        // `replaceDataUrlImages` zachowuje referencję przy braku trafień,
        // więc niezmieniony formularz nie generuje dodatkowego autosave'u.
        setSlug((f) => replaceFormImageUrls(f, result.replacements));
      }
      return { doc: result.doc, changed: result.changed };
    },
    [user?.id, tenantId, registerUpload$, setSlug, t],
  );

  const saveFn = useCallback(
    async (input: PostForm | null) => {
      if (!input) return;
      const persistedBlocks = await persistPastedImages(input.blocks_data);
      const persistedBuilder = await persistPastedImages(input.builder_data);
      // Osobna, niemutowalna referencja: parametr po podmianie gubi zawężenie
      // typu (`PostForm | null`), a dalej korzystamy z niego po `await`.
      const snapshot: PostForm = applyPersistedImages(input, persistedBlocks, persistedBuilder);
      const result = await update$({
        data: {
          id,
          fields: buildPostPatch(snapshot),
          categories: selectedCats,
          tags: selectedTags,
          programs: selectedPrograms,
          regions: selectedRegions,
          // Optimistic-lock: updated_at, który klient ostatnio widział.
          baseUpdatedAt: baseUpdatedAtRef.current ?? undefined,
        },
      }).catch((err: unknown) => {
        // Klasyfikacja jest regułą (`saveErrorDescriptor`), tekst powstaje tutaj
        // - tylko klient zna język panelu. Nierozpoznany błąd leci dalej surowy,
        // zamiast zostać przykryty ogólnikiem.
        const descriptor = saveErrorDescriptor(err);
        if (descriptor?.kind === "conflict") {
          toast.error(t("admin.editConflict"), { id: "edit-conflict" });
        }
        if (descriptor?.kind === "disclosureGaps") {
          toast.error(
            t("adminPostPanes.sponsored.gapToast", {
              fields: descriptor.gaps
                .map((gap) => t(`adminPostPanes.sponsored.gap.${gap}`))
                .join(", "),
            }),
            { id: "sponsored-disclosure-gap" },
          );
        }
        throw err;
      });
      // Przesuń bazę optimistic-locka na updated_at faktycznie zapisany, by
      // kolejny zapis nie zgłaszał fałszywego konfliktu.
      baseUpdatedAtRef.current = nextBaseUpdatedAt(baseUpdatedAtRef.current, result);
      // Serwer mógł znormalizować slug (uniqueSlug dopisuje sufiks przy
      // kolizji). Nawigujemy WYŁĄCZNIE na slug faktycznie zapisany -
      // przejście na slug wpisany w formularzu załadowałoby CUDZY wpis,
      // który go posiada ("podmiana" edytowanego posta).
      const slugOutcome = resolveSlugOutcome(snapshot.slug, result?.slug, routeSlug);
      const canonicalSlug = slugOutcome.slug;
      // WAZNE: autosave nie moze przebudowywac calego swiata przy kazdym
      // debounced zapisie - to powodowalo "auto-refresh" edytora (loadery
      // route'a znow pobieraly wiersz posta, cache widgetow leciał, a
      // router.invalidate() re-renderowal cala trase). Tutaj robimy WYLACZNIE
      // to co niezbedne dla poprawnosci UI: uaktualnienie listy w tle
      // (nastepna wizyta /admin/posts) i sygnal statusu. Cieze inwalidacje
      // (widget cache, SEO cache, router.invalidate) sa uruchamiane dopiero
      // przez explicit "Publikuj/Zapisz i wyjdz" lub przy odmontowaniu edytora.
      void qc.invalidateQueries({ queryKey: ["admin-posts"], refetchType: "none" });

      if (slugOutcome.collided) {
        // Kolizja nie może być cicha: pokaz stan błędu/ostrzeżenia i zsynchronizuj
        // pole formularza z tym, co realnie trafiło do bazy.
        toast.warning(
          t("admin.slugTaken", {
            slug: canonicalSlug,
          }),
        );
        setSlug((f) => (f && f.slug === snapshot.slug ? { ...f, slug: canonicalSlug } : f));
      }
      if (slugOutcome.mustNavigate) {
        navigate({ to: "/admin/posts/$slug", params: { slug: canonicalSlug }, replace: true });
      }
    },
    [
      id,
      update$,
      persistPastedImages,
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
    const gate = seoSaveGate(seoIssues);
    if (gate.kind === "blocked") {
      toast.error(t("admin.seo.validation.blockToast"));
      return;
    }
    if (gate.kind === "warn") {
      toast.warning(t("admin.seo.validation.warnToast", { count: gate.count }));
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
        confirmLabel: t("admin.delete"),
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
        // Jedno źródło prawdy z bramką serwerową (updatePost) - checklista nie
        // liczy tej reguły po swojemu, tylko woła tę samą funkcję domenową.
        sponsoredGaps: disclosureGaps(form),
      })
    : null;

  // Miękka bramka: przy brakach w pozycjach wymaganych pytamy, nie blokujemy.
  const confirmPublishGaps = async (nextStatus: PostWorkflowStatus): Promise<boolean> => {
    if (!form || !publishChecklist) return true;
    if (!isPublishTransition(form.status, nextStatus)) return true;
    if (publishChecklist.requiredOk) return true;
    const missing = missingRequiredKeys(publishChecklist)
      .map((key) => t(key))
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
  const scheduledInPast = isScheduledInPast(form, Date.now());

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
