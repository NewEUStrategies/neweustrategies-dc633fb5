// Controller hook for the Theme Design pane.
//
// Owns every draft slice (PL/EN theme design, carousel defaults, overlay
// typography), the editor UI state (edit/preview language, preview mode, active
// tab, live-sync), the live-preview mirroring into react-query, the persistence
// of all slices, and - crucially - the tenant-isolation guard.
//
// TENANT ISOLATION: reads are already scoped server-side by RLS
// (`tenant_id = current_tenant_id()`), so one workspace can never fetch
// another's rows. This hook adds the client-side half of that guarantee: if the
// active tenant changes within a session, every unsaved draft is dropped and
// the underlying queries are invalidated, so one company's in-progress edits or
// cached values can never bleed into another company's workspace.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useThemeDesign,
  useThemeDesignEn,
  useSaveThemeDesign,
  useThemeDesignLangMode,
  useSaveThemeDesignLangMode,
  useLiveThemeDesignPreview,
  THEME_DESIGN_DEFAULTS,
  type ThemeDesign,
  type ThemeDesignLang,
  type ThemeDesignLangMode,
} from "@/lib/theme/themeDesign";
import {
  useCarouselDefaults,
  useSaveCarouselDefaults,
  CAROUSEL_DEFAULTS,
  type CarouselDefaults,
} from "@/lib/theme/carouselDefaults";
import { usePostLayoutSettings, useSavePostLayoutSettings } from "@/hooks/usePostLayoutSettings";
import { useCurrentTenantId } from "@/lib/tenant";
import type { PostLayoutSettings } from "@/lib/postLayouts";
import { applyColor, applySectionPatch, diffChangedFields } from "../lib/mutations";
import type { PreviewMode, ThemeColorSetter, ThemeDesignSetter } from "../types";
import type { PreviewSection } from "../lib";

export interface ThemeDesignDraftsController {
  loading: boolean;
  /** Resolved tenant of the current workspace (null while loading). */
  tenantId: string | null;

  mode: ThemeDesignLangMode;
  onModeChange: (mode: ThemeDesignLangMode) => void;
  savingMode: boolean;

  editLang: ThemeDesignLang;
  setEditLang: (lang: ThemeDesignLang) => void;
  activeLang: ThemeDesignLang;

  /** The theme-design draft for the active language (null while loading). */
  draft: ThemeDesign | null;
  set: ThemeDesignSetter;
  setColor: ThemeColorSetter;

  carouselDraft: CarouselDefaults | null;
  setCarouselDraft: (next: CarouselDefaults) => void;

  overlayDraft: PostLayoutSettings | null;
  setOverlayDraft: (next: PostLayoutSettings) => void;

  liveSync: boolean;
  setLiveSync: (value: boolean) => void;
  previewLang: ThemeDesignLang;
  setPreviewLang: (lang: ThemeDesignLang) => void;
  previewMode: PreviewMode;
  setPreviewMode: (mode: PreviewMode) => void;
  activeTab: PreviewSection;
  setActiveTab: (tab: PreviewSection) => void;

  saveAll: () => void;
  restoreDefaults: () => void;
  saving: boolean;
}

const OVERLAY_QUERY_KEY = ["post-layout-settings"] as const;

export function useThemeDesignDrafts(): ThemeDesignDraftsController {
  const queryClient = useQueryClient();
  const tenantId = useCurrentTenantId();

  const { data: tdPl, isLoading: tdPlLoading } = useThemeDesign();
  const { data: tdEn, isLoading: tdEnLoading } = useThemeDesignEn();
  const { data: langMode } = useThemeDesignLangMode();
  const { data: carouselData, isLoading: carouselLoading } = useCarouselDefaults();
  const { data: overlayData, isLoading: overlayLoading } = usePostLayoutSettings();

  const saveTd = useSaveThemeDesign();
  const saveLangMode = useSaveThemeDesignLangMode();
  const saveCarousel = useSaveCarouselDefaults();
  const saveOverlay = useSavePostLayoutSettings();

  const mode: ThemeDesignLangMode = langMode?.mode ?? "shared";

  // Language slot currently being edited. In "shared" mode PL is the single
  // source of truth for both languages.
  const [editLang, setEditLang] = useState<ThemeDesignLang>("pl");
  const activeLang: ThemeDesignLang = mode === "split" ? editLang : "pl";

  const [draftPl, setDraftPl] = useState<ThemeDesign | null>(null);
  const [draftEn, setDraftEn] = useState<ThemeDesign | null>(null);
  const [carouselDraft, setCarouselDraft] = useState<CarouselDefaults | null>(null);
  const [overlayDraft, setOverlayDraft] = useState<PostLayoutSettings | null>(null);

  const [liveSync, setLiveSync] = useState<boolean>(false);
  const [previewLang, setPreviewLang] = useState<ThemeDesignLang>("pl");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("light");
  const [activeTab, setActiveTab] = useState<PreviewSection>("block-heading");

  // Tenant-isolation guard: drop unsaved drafts + invalidate reads when the
  // active tenant changes, so no cross-tenant data survives a workspace switch.
  const previousTenant = useRef<string | null>(tenantId);
  useEffect(() => {
    const prev = previousTenant.current;
    previousTenant.current = tenantId;
    if (prev !== null && tenantId !== null && prev !== tenantId) {
      setDraftPl(null);
      setDraftEn(null);
      setCarouselDraft(null);
      setOverlayDraft(null);
      queryClient.invalidateQueries({ queryKey: ["site_settings"] });
      queryClient.invalidateQueries({ queryKey: ["site_settings_public", "all"] });
      queryClient.invalidateQueries({ queryKey: OVERLAY_QUERY_KEY });
    }
  }, [tenantId, queryClient]);

  // Hydrate each draft once from the (tenant-scoped) server data.
  useEffect(() => {
    if (tdPl && !draftPl) setDraftPl(tdPl);
  }, [tdPl, draftPl]);
  useEffect(() => {
    if (tdEn && !draftEn) setDraftEn(tdEn);
  }, [tdEn, draftEn]);
  useEffect(() => {
    if (carouselData && !carouselDraft) setCarouselDraft(carouselData);
  }, [carouselData, carouselDraft]);
  useEffect(() => {
    if (overlayData && !overlayDraft) setOverlayDraft(overlayData);
  }, [overlayData, overlayDraft]);

  const draft: ThemeDesign | null = activeLang === "en" ? draftEn : draftPl;

  const setDraft = useCallback(
    (next: ThemeDesign) => {
      if (activeLang === "en") setDraftEn(next);
      else setDraftPl(next);
    },
    [activeLang],
  );

  // Live-mirror the effective draft into react-query so every consumer (CMS
  // canvases, public preview) reflects it instantly - restored on unmount.
  const livePreviewDraft = mode === "split" ? draft : draftPl;
  useLiveThemeDesignPreview(livePreviewDraft, liveSync, activeLang);

  // Live-mirror the overlay-typography draft into its cache without persisting.
  useEffect(() => {
    if (!overlayDraft) return;
    const prev = queryClient.getQueryData(OVERLAY_QUERY_KEY);
    queryClient.setQueryData(OVERLAY_QUERY_KEY, overlayDraft);
    return () => {
      if (prev) queryClient.setQueryData(OVERLAY_QUERY_KEY, prev);
      else queryClient.invalidateQueries({ queryKey: OVERLAY_QUERY_KEY });
    };
  }, [overlayDraft, queryClient]);

  const set = useCallback<ThemeDesignSetter>(
    (key, patch) => {
      if (!draft) return;
      setDraft(applySectionPatch(draft, key, patch));
    },
    [draft, setDraft],
  );

  const setColor = useCallback<ThemeColorSetter>(
    (section, field, value) => {
      if (!draft) return;
      setDraft(applyColor(draft, previewMode, section, field, value));
    },
    [draft, previewMode, setDraft],
  );

  const onModeChange = useCallback(
    (next: ThemeDesignLangMode) => saveLangMode.mutate({ mode: next }),
    [saveLangMode],
  );

  const saveAll = useCallback(() => {
    if (mode === "split") {
      if (draftPl) saveTd.mutate({ next: draftPl, lang: "pl" });
      if (draftEn) saveTd.mutate({ next: draftEn, lang: "en" });
    } else if (draftPl) {
      saveTd.mutate({ next: draftPl, lang: "pl" });
    }
    if (carouselDraft) saveCarousel.mutate(carouselDraft);
    // Overlay typography: push only the fields that changed vs. the server
    // snapshot so unrelated columns are never overwritten.
    if (overlayData && overlayDraft) {
      const patch = diffChangedFields(overlayDraft, overlayData);
      if (patch) saveOverlay.mutate(patch);
    }
  }, [
    mode,
    draftPl,
    draftEn,
    carouselDraft,
    overlayData,
    overlayDraft,
    saveTd,
    saveCarousel,
    saveOverlay,
  ]);

  const restoreDefaults = useCallback(() => {
    setDraft(THEME_DESIGN_DEFAULTS);
    setCarouselDraft(CAROUSEL_DEFAULTS);
  }, [setDraft]);

  const loading =
    tdPlLoading ||
    tdEnLoading ||
    carouselLoading ||
    overlayLoading ||
    !draft ||
    !carouselDraft ||
    !draftPl ||
    !overlayDraft;

  const saving = saveTd.isPending || saveCarousel.isPending || saveOverlay.isPending;
  const savingMode = saveLangMode.isPending;

  return useMemo<ThemeDesignDraftsController>(
    () => ({
      loading,
      tenantId,
      mode,
      onModeChange,
      savingMode,
      editLang,
      setEditLang,
      activeLang,
      draft,
      set,
      setColor,
      carouselDraft,
      setCarouselDraft,
      overlayDraft,
      setOverlayDraft,
      liveSync,
      setLiveSync,
      previewLang,
      setPreviewLang,
      previewMode,
      setPreviewMode,
      activeTab,
      setActiveTab,
      saveAll,
      restoreDefaults,
      saving,
    }),
    [
      loading,
      tenantId,
      mode,
      onModeChange,
      savingMode,
      editLang,
      activeLang,
      draft,
      set,
      setColor,
      carouselDraft,
      overlayDraft,
      liveSync,
      previewLang,
      previewMode,
      activeTab,
      saveAll,
      restoreDefaults,
      saving,
    ],
  );
}
