// Okno wstawiania / edycji encji inline (firma albo osoba).
//
// Źródła danych:
//   * firma - wyszukiwarka kartoteki CRM (nazwa, kraj, branża, specjalizacja,
//     www, social media, logo), a potem dowolna korekta w materiale;
//   * osoba - wyszukiwarka autorów (profil autora) albo wpis ręczny (imię,
//     nazwisko, stanowisko, firma, strona zewnętrzna, social media).
// Zapis trafia WYŁĄCZNIE do rejestru materiału - CRM i profile autorów są tu
// tylko do odczytu („Odśwież ze źródła" pobiera je ponownie, świadomie).
//
// Edycja istniejącej encji zmienia jej wszystkie wystąpienia naraz - okno mówi
// to wprost licznikiem użyć.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Building2, Globe, Link2Off, Loader2, RefreshCw, Search, UserRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { uiLang } from "@/lib/i18n/format";
import { canAddInlineEntity } from "@/lib/blocks/inlineEntities/registry";
import {
  INLINE_ENTITY_LIMITS,
  createBlankInlineEntity,
  inlineEntityDisplayName,
  inlineEntityInitials,
  normalizeInlineEntity,
  SOCIAL_NETWORKS,
  type InlineEntity,
  type InlineEntityKind,
  type InlineEntityLang,
  type LocalizedText,
  type SocialNetwork,
} from "@/lib/blocks/inlineEntities/model";
import {
  authorRowLabel,
  companyEntityFromCrm,
  countryNameOptions,
  lookupAuthors,
  lookupCrmCompanies,
  personEntityFromAuthor,
  resolveCountry,
  type AuthorRow,
  type CrmCompanyRow,
} from "@/lib/blocks/inlineEntities/sources";
import { INLINE_ENTITY_CLASSES } from "@/lib/blocks/inlineEntities/expand";
import { InlineEntityCardView } from "@/components/blocks/inlineEntities/InlineEntityCardView";
import { entityProfileHref } from "@/components/blocks/inlineEntities/cardGeometry";
import { InlineEntityImageField } from "./InlineEntityImageField";
import type { InlineEntityEditorRequest } from "./InlineEntitiesContext";
import "@/lib/i18n-admin-blocks";

const SEARCH_DEBOUNCE_MS = 250;
const SOCIAL_LABELS: Record<SocialNetwork, string> = {
  linkedin: "LinkedIn",
  x: "X",
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
};

interface Props {
  request: InlineEntityEditorRequest | null;
  entities: Readonly<Record<string, InlineEntity>>;
  usage: ReadonlyMap<string, number>;
  /** Język treści (podgląd). */
  lang: InlineEntityLang;
  onClose: () => void;
  onSave: (entity: InlineEntity) => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function initialDraft(
  request: InlineEntityEditorRequest,
  entities: Readonly<Record<string, InlineEntity>>,
): InlineEntity {
  if (request.mode === "edit") {
    return (
      entities[request.id] ??
      createBlankInlineEntity(request.fallback?.kind ?? "company", {
        id: request.id,
        name: request.fallback?.label,
      })
    );
  }
  return createBlankInlineEntity(request.kind, { name: request.prefillName });
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(handle);
  }, [value, ms]);
  return debounced;
}

function Field({
  id,
  label,
  children,
  className,
}: {
  id?: string;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1", className)}>
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {children}
    </div>
  );
}

function LocalizedField({
  idPrefix,
  label,
  value,
  onChange,
}: {
  idPrefix: string;
  label: string;
  value: LocalizedText;
  onChange: (next: LocalizedText) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="m-0 grid gap-1 border-0 p-0 sm:col-span-2">
      <legend className="mb-1 text-xs font-medium">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {(["pl", "en"] as const).map((code) => (
          <div key={code} className="flex items-center gap-2">
            <Label
              htmlFor={`${idPrefix}-${code}`}
              className="w-6 shrink-0 text-[10px] font-semibold uppercase text-muted-foreground"
            >
              {t(
                code === "pl"
                  ? "blocks.inlineEntity.dialog.langPl"
                  : "blocks.inlineEntity.dialog.langEn",
              )}
            </Label>
            <Input
              id={`${idPrefix}-${code}`}
              value={value[code]}
              onChange={(e) => onChange({ ...value, [code]: e.target.value })}
            />
          </div>
        ))}
      </div>
    </fieldset>
  );
}

type SearchResult =
  { kind: "company"; rows: CrmCompanyRow[] } | { kind: "person"; rows: AuthorRow[] };

function SearchPanel({
  kind,
  onPickCompany,
  onPickAuthor,
}: {
  kind: InlineEntityKind;
  onPickCompany: (row: CrmCompanyRow) => void;
  onPickAuthor: (row: AuthorRow) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim(), SEARCH_DEBOUNCE_MS);
  const enabled = query.length >= 2;
  const results = useQuery({
    queryKey: ["admin", "inline-entity-search", kind, query],
    enabled,
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<SearchResult> =>
      kind === "company"
        ? { kind: "company", rows: await lookupCrmCompanies({ q: query }, signal) }
        : { kind: "person", rows: await lookupAuthors({ q: query }, signal) },
  });
  const data = results.data;
  const rowCount = data?.rows.length ?? 0;
  const label = t(
    kind === "company"
      ? "blocks.inlineEntity.dialog.searchCrm"
      : "blocks.inlineEntity.dialog.searchAuthors",
  );
  return (
    <div className="grid gap-2 rounded-[6px] border border-border bg-muted/30 p-3">
      <Label htmlFor="inline-entity-search" className="flex items-center gap-1.5 text-xs">
        <Search className="size-3.5" aria-hidden />
        {label}
      </Label>
      <Input
        id="inline-entity-search"
        type="search"
        autoComplete="off"
        value={q}
        placeholder={t(
          kind === "company"
            ? "blocks.inlineEntity.dialog.searchCrmPlaceholder"
            : "blocks.inlineEntity.dialog.searchAuthorsPlaceholder",
        )}
        onChange={(e) => setQ(e.target.value)}
      />
      {enabled ? (
        <div aria-live="polite" className="text-xs">
          {results.isFetching && rowCount === 0 ? (
            <p className="m-0 flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {t("blocks.inlineEntity.dialog.searching")}
            </p>
          ) : results.isError ? (
            <p className="m-0 text-destructive">{t("blocks.inlineEntity.dialog.searchFailed")}</p>
          ) : !data || rowCount === 0 ? (
            <p className="m-0 text-muted-foreground">{t("blocks.inlineEntity.dialog.noResults")}</p>
          ) : (
            <ul className="m-0 grid max-h-48 list-none gap-1 overflow-y-auto p-0">
              {data.kind === "company"
                ? data.rows.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => onPickCompany(row)}
                        className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {row.logo_url ? (
                          <img
                            alt=""
                            src={row.logo_url}
                            className="size-6 rounded-[6px] object-cover"
                          />
                        ) : (
                          <Building2 className="size-4 text-muted-foreground" aria-hidden />
                        )}
                        <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
                        <span className="truncate text-muted-foreground">
                          {[row.branch, row.country].filter(Boolean).join(" · ")}
                        </span>
                      </button>
                    </li>
                  ))
                : data.rows.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => onPickAuthor(row)}
                        className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {row.avatar_url ? (
                          <img
                            alt=""
                            src={row.avatar_url}
                            className="size-6 rounded-[6px] object-cover"
                          />
                        ) : (
                          <UserRound className="size-4 text-muted-foreground" aria-hidden />
                        )}
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {authorRowLabel(row)}
                        </span>
                        <span className="truncate text-muted-foreground">
                          {[row.job_title, row.company].filter(Boolean).join(" · ")}
                        </span>
                      </button>
                    </li>
                  ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Statyczny podgląd znacznika w zdaniu - te same klasy co publikacja. */
function InlinePreview({ entity }: { entity: InlineEntity }) {
  const src = entity.image?.src;
  return (
    <span className={INLINE_ENTITY_CLASSES.root}>
      <span className={INLINE_ENTITY_CLASSES.static}>
        {src ? (
          <img alt="" src={src} width={24} height={24} className={INLINE_ENTITY_CLASSES.avatar} />
        ) : (
          <span aria-hidden="true" className={INLINE_ENTITY_CLASSES.initials}>
            {inlineEntityInitials(entity)}
          </span>
        )}
        <span className={INLINE_ENTITY_CLASSES.name}>{inlineEntityDisplayName(entity) || "…"}</span>
      </span>
    </span>
  );
}

export function InlineEntityDialog({ request, entities, usage, lang, onClose, onSave }: Props) {
  const { t, i18n } = useTranslation();
  const ui = uiLang(i18n.language);
  const [draft, setDraft] = useState<InlineEntity | null>(null);
  const [countryText, setCountryText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Nowe żądanie = świeży szkic (klucz: tryb + id / rodzaj).
  const requestKey = request
    ? request.mode === "edit"
      ? `edit:${request.id}`
      : `create:${request.kind}:${request.prefillName ?? ""}`
    : null;
  useEffect(() => {
    if (!request) {
      setDraft(null);
      return;
    }
    const next = initialDraft(request, entities);
    setDraft(next);
    setCountryText(next.kind === "company" ? (next.country?.[ui] ?? "") : "");
    setError(null);
    // Rejestr zmienia się przy każdym zapisie - szkic ma powstać raz na żądanie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const countryOptions = useMemo(() => countryNameOptions(ui), [ui]);
  const existingOfKind = useMemo(() => {
    if (!request || request.mode !== "create") return [];
    return Object.values(entities).filter((e) => e.kind === request.kind);
  }, [request, entities]);

  if (!request || !draft) return null;
  const isCreate = request.mode === "create";
  const uses = usage.get(draft.id) ?? 0;

  const patch = (next: Partial<InlineEntity>) =>
    setDraft((current) => (current ? ({ ...current, ...next } as InlineEntity) : current));
  const setSocial = (network: SocialNetwork, url: string) =>
    setDraft((current) =>
      current ? { ...current, socials: { ...current.socials, [network]: url } } : current,
    );

  const switchKind = (kind: InlineEntityKind) => {
    if (!isCreate || draft.kind === kind) return;
    const next = createBlankInlineEntity(kind, {
      id: draft.id,
      name: inlineEntityDisplayName(draft) || request.prefillName,
    });
    setDraft({ ...next, image: draft.image, website: draft.website, socials: draft.socials });
    setCountryText("");
  };

  const applyCompany = (row: CrmCompanyRow, keepImage: boolean) => {
    // Bez `keepImage` bierzemy logo z CRM (a gdy CRM go nie ma - zostaje
    // bieżący obraz); przy odświeżeniu zostaje własny kadr redakcji.
    const next = companyEntityFromCrm(row, nowIso(), {
      id: draft.id,
      image: keepImage ? draft.image : undefined,
    });
    if (!next.image) next.image = draft.image;
    setDraft(next);
    setCountryText(next.country?.[ui] ?? "");
  };
  const applyAuthor = (row: AuthorRow, keepImage: boolean) => {
    const next = personEntityFromAuthor(row, nowIso(), {
      id: draft.id,
      image: keepImage ? draft.image : undefined,
    });
    if (!next.image) next.image = draft.image;
    setDraft(next);
  };

  const refreshFromSource = async () => {
    const source = draft.source;
    if (source.type === "manual") return;
    setRefreshing(true);
    try {
      if (source.type === "crm") {
        const [row] = await lookupCrmCompanies({ id: source.id });
        if (!row) throw new Error("not_found");
        applyCompany(row, Boolean(draft.image));
      } else {
        const [row] = await lookupAuthors({ id: source.id });
        if (!row) throw new Error("not_found");
        applyAuthor(row, Boolean(draft.image));
      }
      toast.success(t("blocks.inlineEntity.dialog.refreshed"));
    } catch {
      toast.error(t("blocks.inlineEntity.dialog.refreshFailed"));
    } finally {
      setRefreshing(false);
    }
  };

  const submit = () => {
    const candidate =
      draft.kind === "company"
        ? {
            ...draft,
            country:
              countryText.trim() === (draft.country?.[ui] ?? "") && draft.country
                ? draft.country
                : resolveCountry(countryText),
            updatedAt: nowIso(),
          }
        : { ...draft, updatedAt: nowIso() };
    const entity = normalizeInlineEntity(candidate);
    if (entity && !canAddInlineEntity(entities, entity.id)) {
      setError(
        t("blocks.inlineEntity.dialog.limitReached", { max: INLINE_ENTITY_LIMITS.perDocument }),
      );
      return;
    }
    if (!entity) {
      setError(
        t(
          draft.kind === "company"
            ? "blocks.inlineEntity.dialog.invalidCompany"
            : "blocks.inlineEntity.dialog.invalidPerson",
        ),
      );
      return;
    }
    // KOLEJNOŚĆ MA ZNACZENIE: najpierw wstawienie odwołania (kanwa zapisuje
    // dokument policzony ze swojego propsa), potem rejestr - jako aktualizacja
    // funkcyjna na najświeższym stanie, więc nie zostanie nadpisany.
    if (request.mode === "create") request.onSaved(entity);
    onSave(entity);
    if (request.mode === "edit") toast.success(t("blocks.inlineEntity.dialog.saved"));
    onClose();
  };

  const title = t(
    isCreate
      ? draft.kind === "company"
        ? "blocks.inlineEntity.dialog.titleCreateCompany"
        : "blocks.inlineEntity.dialog.titleCreatePerson"
      : draft.kind === "company"
        ? "blocks.inlineEntity.dialog.titleEditCompany"
        : "blocks.inlineEntity.dialog.titleEditPerson",
  );
  const sourceLabel = t(
    draft.source.type === "crm"
      ? "blocks.inlineEntity.dialog.sourceCrm"
      : draft.source.type === "author"
        ? "blocks.inlineEntity.dialog.sourceAuthor"
        : "blocks.inlineEntity.dialog.sourceManual",
  );
  const previewEntity = normalizeInlineEntity(draft);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-[6px] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("blocks.inlineEntity.dialog.description")}</DialogDescription>
        </DialogHeader>

        {isCreate ? (
          <div
            role="radiogroup"
            aria-label={title}
            className="inline-flex w-fit gap-1 rounded-[6px] border border-border p-1"
          >
            {(["company", "person"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={draft.kind === kind}
                onClick={() => switchKind(kind)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-[4px] px-3 py-1 text-xs font-medium transition-colors",
                  draft.kind === kind ? "bg-foreground text-background" : "hover:bg-accent",
                )}
              >
                {kind === "company" ? (
                  <Building2 className="size-3.5" aria-hidden />
                ) : (
                  <UserRound className="size-3.5" aria-hidden />
                )}
                {t(
                  kind === "company"
                    ? "blocks.inlineEntity.dialog.kindCompany"
                    : "blocks.inlineEntity.dialog.kindPerson",
                )}
              </button>
            ))}
          </div>
        ) : (
          <p className="m-0 rounded-[6px] border border-border bg-muted/40 px-3 py-2 text-xs">
            {t("blocks.inlineEntity.dialog.usage", { count: Math.max(uses, 1) })}
          </p>
        )}

        {existingOfKind.length > 0 ? (
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("blocks.inlineEntity.dialog.existing")}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {existingOfKind.map((entity) => (
                <Button
                  key={entity.id}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (request.mode === "create") request.onSaved(entity);
                    onClose();
                  }}
                >
                  {t("blocks.inlineEntity.dialog.useExisting", {
                    name: inlineEntityDisplayName(entity),
                  })}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        <SearchPanel
          key={draft.kind}
          kind={draft.kind}
          onPickCompany={(row) => applyCompany(row, false)}
          onPickAuthor={(row) => applyAuthor(row, false)}
        />

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-[6px] border border-border px-2 py-0.5">{sourceLabel}</span>
          {draft.source.type !== "manual" ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5"
                disabled={refreshing}
                onClick={() => void refreshFromSource()}
              >
                <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} aria-hidden />
                {t(
                  draft.source.type === "crm"
                    ? "blocks.inlineEntity.dialog.refreshCrm"
                    : "blocks.inlineEntity.dialog.refreshAuthor",
                )}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5"
                onClick={() => patch({ source: { type: "manual" } })}
              >
                <Link2Off className="size-3.5" aria-hidden />
                {t("blocks.inlineEntity.dialog.detach")}
              </Button>
            </>
          ) : null}
        </div>

        <div className="grid gap-5 md:grid-cols-[1fr_300px]">
          <div className="grid content-start gap-3 sm:grid-cols-2">
            {draft.kind === "company" ? (
              <>
                <Field
                  id="ie-name"
                  label={t("blocks.inlineEntity.dialog.name")}
                  className="sm:col-span-2"
                >
                  <Input
                    id="ie-name"
                    value={draft.name}
                    onChange={(e) => patch({ name: e.target.value })}
                    aria-invalid={error ? true : undefined}
                  />
                </Field>
                <Field id="ie-country" label={t("blocks.inlineEntity.dialog.country")}>
                  <Input
                    id="ie-country"
                    list="ie-country-options"
                    value={countryText}
                    placeholder={t("blocks.inlineEntity.dialog.countryPlaceholder")}
                    onChange={(e) => setCountryText(e.target.value)}
                  />
                  <datalist id="ie-country-options">
                    {countryOptions.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </Field>
                <Field id="ie-website" label={t("blocks.inlineEntity.dialog.website")}>
                  <Input
                    id="ie-website"
                    type="url"
                    inputMode="url"
                    placeholder="https://"
                    value={draft.website}
                    onChange={(e) => patch({ website: e.target.value })}
                  />
                </Field>
                <LocalizedField
                  idPrefix="ie-industry"
                  label={t("blocks.inlineEntity.dialog.industry")}
                  value={draft.industry}
                  onChange={(industry) => patch({ industry })}
                />
                <LocalizedField
                  idPrefix="ie-specialization"
                  label={t("blocks.inlineEntity.dialog.specialization")}
                  value={draft.specialization}
                  onChange={(specialization) => patch({ specialization })}
                />
              </>
            ) : (
              <>
                <Field id="ie-first" label={t("blocks.inlineEntity.dialog.firstName")}>
                  <Input
                    id="ie-first"
                    value={draft.firstName}
                    onChange={(e) => patch({ firstName: e.target.value })}
                    aria-invalid={error ? true : undefined}
                  />
                </Field>
                <Field id="ie-last" label={t("blocks.inlineEntity.dialog.lastName")}>
                  <Input
                    id="ie-last"
                    value={draft.lastName}
                    onChange={(e) => patch({ lastName: e.target.value })}
                    aria-invalid={error ? true : undefined}
                  />
                </Field>
                <LocalizedField
                  idPrefix="ie-position"
                  label={t("blocks.inlineEntity.dialog.position")}
                  value={draft.position}
                  onChange={(position) => patch({ position })}
                />
                <Field id="ie-company" label={t("blocks.inlineEntity.dialog.company")}>
                  <Input
                    id="ie-company"
                    value={draft.company}
                    onChange={(e) => patch({ company: e.target.value })}
                  />
                </Field>
                <Field id="ie-website" label={t("blocks.inlineEntity.dialog.externalPage")}>
                  <Input
                    id="ie-website"
                    type="url"
                    inputMode="url"
                    placeholder="https://"
                    value={draft.website}
                    onChange={(e) => patch({ website: e.target.value })}
                  />
                </Field>
              </>
            )}

            <fieldset className="m-0 grid gap-2 border-0 p-0 sm:col-span-2 sm:grid-cols-2">
              <legend className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                <Globe className="size-3.5" aria-hidden />
                {t("blocks.inlineEntity.dialog.socials")}
              </legend>
              {SOCIAL_NETWORKS.map((network) => (
                <Field key={network} id={`ie-social-${network}`} label={SOCIAL_LABELS[network]}>
                  <Input
                    id={`ie-social-${network}`}
                    type="url"
                    inputMode="url"
                    placeholder="https://"
                    value={draft.socials[network] ?? ""}
                    onChange={(e) => setSocial(network, e.target.value)}
                  />
                </Field>
              ))}
            </fieldset>

            <div className="sm:col-span-2">
              <InlineEntityImageField
                label={t(
                  draft.kind === "company"
                    ? "blocks.inlineEntity.dialog.logo"
                    : "blocks.inlineEntity.dialog.photo",
                )}
                value={draft.image}
                initials={inlineEntityInitials(draft)}
                onChange={(image) => patch({ image })}
              />
            </div>
          </div>

          <aside
            className="grid content-start gap-3"
            aria-label={t("blocks.inlineEntity.dialog.preview")}
          >
            <span className="text-xs font-medium text-muted-foreground">
              {t("blocks.inlineEntity.dialog.previewInline")}
            </span>
            <p className="m-0 rounded-[6px] border border-border p-3 text-[15px] leading-relaxed">
              … <InlinePreview entity={draft} /> …
            </p>
            <span className="text-xs font-medium text-muted-foreground">
              {t("blocks.inlineEntity.dialog.preview")}
            </span>
            {previewEntity ? (
              <InlineEntityCardView
                entity={previewEntity}
                lang={lang}
                profileHref={entityProfileHref(previewEntity)}
              />
            ) : null}
          </aside>
        </div>

        {error ? (
          <p role="alert" className="m-0 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("blocks.inlineEntity.dialog.cancel")}
          </Button>
          <Button type="button" onClick={submit}>
            {t(isCreate ? "blocks.inlineEntity.dialog.insert" : "blocks.inlineEntity.dialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
