// Edytor treści maila kroku ścieżki (S8, SPEC §6.3) - temat i preheader PL/EN,
// dokument EmailDoc, warianty A/B, podgląd PL/EN i zapis treści.
//
// WZÓR: kreator kampanii newslettera (`CampaignContentBuilder`) - ta sama
// paleta bloków i TEN SAM panel właściwości bloku (`CampaignBlockProperties`),
// bez bloku „najnowsze wpisy”: ścieżka renderuje dokument bez wpisów
// (`postsByBlock: {}`), więc blok wyszedłby pusty. Kolejność zmienia się
// przyciskami „wyżej/niżej” - przeciąganie nigdy nie jest jedyną drogą.
//
// PODGLĄD = WYSYŁKA (Z-S5-08): `journeyEmailPreview` z S8.3a składa temat,
// preheader i HTML tym samym kodem co runner, na próbkach
// (`JOURNEY_VARIABLE_SAMPLES`), bez danych kontaktów i bez zapytań. Język:
// EN tylko z tematem EN - inaczej kontakt anglojęzyczny dostaje wersję polską
// (podgląd mówi to wprost).
//
// ZAPIS TREŚCI. `saveJourneyEmailContent` nie ma CAS, nie rusza tokenu ścieżki
// i szuka węzła `send_email` w ZAPISANYM szkicu (`node_not_email`). Dlatego:
//   * autozapis co 2 s jak szkic (`useAutosave`), każdy wariant osobno;
//   * przed pierwszym zapisem treści nowego kroku `ensureNodeSaved(nodeId)`
//     (sesja S8.3a robi flush szkicu, jeśli węzła jeszcze w nim nie ma);
//   * wartość spoza limitów (temat 1-200, EN i preheadery ≤ 200) nie idzie do
//     serwera - pole pokazuje błąd, nic nie jest przycinane;
//   * zamknięcie panelu z niezapisaną zmianą kończy zapis w tle, a ochrona
//     przed opuszczeniem strony (`useUnsavedChangesGuard`) pilnuje karty.
//
// WARIANTY: zakładki A/B pojawiają się, gdy przed krokiem stoi test A/B
// (`ab_split` wśród przodków) - ramię B wysyła wariant B, a pusty wariant B
// oznacza treść A (fallback silnika). Edytory obu wariantów zostają
// zamontowane (`forceMount`), więc przełączenie zakładki nie gubi zmian.
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { useTranslation } from "react-i18next";

import { CampaignBlockProperties } from "@/components/admin/newsletter/CampaignBlockProperties";
import * as blockRules from "@/components/admin/newsletter/campaignBlocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAutosave } from "@/hooks/useAutosave";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { isMfaRequiredError } from "@/lib/admin/journeys/access";
import { JOURNEY_AUTOSAVE_DELAY_MS } from "@/lib/admin/journeys/editorSession";
import {
  JOURNEY_PREVIEW_ERROR_KEY,
  JOURNEY_PREVIEW_NOTE_KEY,
  journeyEmailPreview,
  journeyEmailPreviewDocument,
  journeyEmailVariableIssues,
  type JourneyPreviewLang,
} from "@/lib/admin/journeys/emailPreview";
import { stableStringify } from "@/lib/admin/journeys/hash";
import type { JourneyEmailContentDto } from "@/lib/admin/journeys/journeyEditor.functions";
import { mutationErrorText, useSaveJourneyEmailContent } from "@/lib/admin/journeys/journeyMutations";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n as ensureEditorI18n } from "@/lib/i18n-admin-journeys-editor";
import { ensureI18n as ensureListI18n } from "@/lib/i18n-admin-journeys-list";
import { ensureI18n } from "@/lib/i18n-admin-journeys-steps";
import { ensureI18n as ensureNewsletterAdminI18n } from "@/lib/i18n-newsletter-admin";
import { ancestorsOf, type JourneyGraph } from "@/lib/journeys/graph";
import { journeyLabelKey } from "@/lib/journeys/labels";
import { JOURNEY_LIMITS } from "@/lib/journeys/limits";
import { journeyTrigger } from "@/lib/journeys/triggers";
import { JOURNEY_VARIABLES, JOURNEY_VARIABLE_SAMPLES } from "@/lib/journeys/variables";
import {
  DEFAULT_EMAIL_DOC_STYLE,
  createEmailBlock,
  parseEmailDoc,
  type EmailBlock,
  type EmailBlockType,
  type EmailDoc,
} from "@/lib/newsletter/emailDoc";
import { SheetField, describedBy, textFieldError, type JourneyFieldError } from "./PredicateRow";

/** Bloki dostępne w mailu ścieżki - paleta kampanii BEZ „najnowszych wpisów”. */
export const JOURNEY_EMAIL_BLOCK_TYPES: readonly EmailBlockType[] = [
  "heading",
  "paragraph",
  "image",
  "button",
  "quote",
  "divider",
  "spacer",
  "footer-note",
];

/** Opóźnienie podglądu - jak w kreatorze kampanii (ramka nie miga przy pisaniu). */
const PREVIEW_DEBOUNCE_MS = 300;

/** Treść jednego wariantu w edytorze (napisy surowe, dokument EmailDoc). */
export interface JourneyEmailDraft {
  subjectPl: string;
  subjectEn: string;
  preheaderPl: string;
  preheaderEn: string;
  doc: EmailDoc;
}

type DraftField = "subjectPl" | "subjectEn" | "preheaderPl" | "preheaderEn";

/** Limity pól = walidator `saveJourneyEmailContent` (`.trim().min/max`). */
const FIELD_LIMITS: Readonly<Record<DraftField, { min: number; max: number }>> = {
  subjectPl: { min: JOURNEY_LIMITS.subjectMin, max: JOURNEY_LIMITS.subjectMax },
  subjectEn: { min: 0, max: JOURNEY_LIMITS.subjectMax },
  preheaderPl: { min: 0, max: JOURNEY_LIMITS.preheaderMax },
  preheaderEn: { min: 0, max: JOURNEY_LIMITS.preheaderMax },
};

export function emailDraftErrors(draft: JourneyEmailDraft): Partial<Record<DraftField, JourneyFieldError>> {
  const errors: Partial<Record<DraftField, JourneyFieldError>> = {};
  for (const field of Object.keys(FIELD_LIMITS) as DraftField[]) {
    const error = textFieldError(draft[field], FIELD_LIMITS[field]);
    if (error) errors[field] = error;
  }
  return errors;
}

function emptyDoc(): EmailDoc {
  return { version: 1, blocks: [], style: { ...DEFAULT_EMAIL_DOC_STYLE } };
}

/** Treść z bazy -> edytor. Dokument nieczytelny = pusty (z ostrzeżeniem). */
export function emailDraftFrom(row: Pick<
  JourneyEmailContentDto,
  "subjectPl" | "subjectEn" | "preheaderPl" | "preheaderEn" | "doc"
> | null): { draft: JourneyEmailDraft; docInvalid: boolean } {
  if (!row) {
    return {
      draft: { subjectPl: "", subjectEn: "", preheaderPl: "", preheaderEn: "", doc: emptyDoc() },
      docInvalid: false,
    };
  }
  const doc = parseEmailDoc(row.doc);
  return {
    draft: {
      subjectPl: row.subjectPl,
      subjectEn: row.subjectEn ?? "",
      preheaderPl: row.preheaderPl ?? "",
      preheaderEn: row.preheaderEn ?? "",
      doc: doc ?? emptyDoc(),
    },
    docInvalid: doc === null,
  };
}

/** Wariant treści maila: A zawsze, B gdy przed krokiem jest test A/B (albo już ma treść). */
export function emailVariants(
  graph: JourneyGraph,
  nodeId: string,
  contents: readonly Pick<JourneyEmailContentDto, "nodeId" | "variant">[],
): { variants: ("A" | "B")[]; split: boolean } {
  const ancestors = ancestorsOf(graph, nodeId);
  const split = graph.nodes.some((node) => node.type === "ab_split" && ancestors.has(node.id));
  const hasB = contents.some((c) => c.nodeId === nodeId && c.variant === "B");
  return { variants: split || hasB ? ["A", "B"] : ["A"], split };
}

export interface EmailStepEditorProps {
  journeyId: string;
  tenantId: string | null;
  nodeId: string;
  /** Graf szkicu - przodkowie kroku (test A/B) i zakaz maili przy windykacji. */
  graph: JourneyGraph;
  triggerEventType: string | null;
  /** Treści szkicu (`detail.contents`, wszystkie kroki i warianty). */
  contents: readonly JourneyEmailContentDto[];
  /** `detail.templateMatches` - wariant A identyczny z szablonem (blokada publikacji). */
  templateMatches?: Readonly<Record<string, boolean>>;
  /** `capabilities.canEdit && session.editable`. */
  editable: boolean;
  /** `session.ensureNodeSaved` - węzeł w ZAPISANYM szkicu przed zapisem treści. */
  ensureNodeSaved: (nodeId: string) => Promise<boolean>;
}

export function EmailStepEditor(props: EmailStepEditorProps) {
  ensureJourneysI18n();
  ensureListI18n();
  ensureEditorI18n();
  ensureNewsletterAdminI18n();
  ensureI18n();
  const { t } = useTranslation();
  const { graph, nodeId, contents } = props;
  const { variants, split } = useMemo(
    () => emailVariants(graph, nodeId, contents),
    [graph, nodeId, contents],
  );
  const [variant, setVariant] = useState<"A" | "B">("A");
  const rowA = contents.find((c) => c.nodeId === nodeId && c.variant === "A") ?? null;
  const rowB = contents.find((c) => c.nodeId === nodeId && c.variant === "B") ?? null;
  const emailForbidden =
    props.triggerEventType !== null && journeyTrigger(props.triggerEventType)?.emailForbidden === true;

  const editor = (v: "A" | "B") => (
    <VariantEditor
      key={`${nodeId}:${v}`}
      {...props}
      variant={v}
      row={v === "A" ? rowA : rowB}
      // Wariant B bez własnej treści zaczyna od kopii A - wysyłka i tak
      // wyśle A, dopóki B nie zostanie zapisany.
      seed={v === "B" && rowB === null ? rowA : null}
      templateMatch={v === "A" && props.templateMatches?.[nodeId] === true}
    />
  );

  return (
    <section className="space-y-4" data-testid="journey-email-editor" data-node-id={nodeId}>
      <h3 className="text-sm font-medium">{t("adminJourneys.emailStep.title")}</h3>
      {emailForbidden ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t("adminJourneys.common.palette.emailForbidden")}
        </p>
      ) : null}
      {variants.length > 1 ? (
        <Tabs value={variant} onValueChange={(next) => setVariant(next === "B" ? "B" : "A")}>
          <TabsList aria-label={t("adminJourneys.emailStep.variants")}>
            {variants.map((v) => (
              <TabsTrigger key={v} value={v}>
                {t(journeyLabelKey("branch", v))}
              </TabsTrigger>
            ))}
          </TabsList>
          <p className="mt-2 text-xs text-muted-foreground">
            {split ? t("adminJourneys.emailStep.variantsHint") : t("adminJourneys.emailStep.variantUnused")}
          </p>
          {variants.map((v) => (
            <TabsContent key={v} value={v} forceMount className="mt-3 data-[state=inactive]:hidden">
              {editor(v)}
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        editor("A")
      )}
    </section>
  );
}

type SaveStatusText = { text: string; tone: "muted" | "error" } | null;

function VariantEditor(
  props: EmailStepEditorProps & {
    variant: "A" | "B";
    row: JourneyEmailContentDto | null;
    seed: JourneyEmailContentDto | null;
    templateMatch: boolean;
  },
) {
  const { t } = useTranslation();
  const { variant, nodeId, editable } = props;
  const id = useId();
  const [initial] = useState(() => emailDraftFrom(props.row ?? props.seed));
  const [draft, setDraft] = useState<JourneyEmailDraft>(initial.draft);
  const errors = emailDraftErrors(draft);
  const valid = Object.keys(errors).length === 0;
  const mutation = useSaveJourneyEmailContent(props.tenantId, props.journeyId);
  const ensureNodeSaved = props.ensureNodeSaved;

  const autosave = useAutosave<JourneyEmailDraft>({
    value: draft,
    delayMs: JOURNEY_AUTOSAVE_DELAY_MS,
    enabled: editable,
    equals: (a, b) => stableStringify(a) === stableStringify(b),
    save: async (value) => {
      if (Object.keys(emailDraftErrors(value)).length > 0) {
        throw new Error(t("adminJourneys.emailStep.invalid"));
      }
      if (!(await ensureNodeSaved(nodeId))) throw new Error(t("adminJourneys.emailStep.nodeNotSaved"));
      let result: Awaited<ReturnType<typeof mutation.mutateAsync>>;
      try {
        result = await mutation.mutateAsync({
          nodeId,
          variant,
          subjectPl: value.subjectPl.trim(),
          subjectEn: value.subjectEn.trim() || null,
          preheaderPl: value.preheaderPl.trim() || null,
          preheaderEn: value.preheaderEn.trim() || null,
          doc: value.doc,
        });
      } catch (error) {
        throw new Error(
          isMfaRequiredError(error)
            ? t("adminJourneys.editor.autosave.mfa")
            : t("adminJourneys.emailStep.failed"),
        );
      }
      if (!result.ok) throw new Error(mutationErrorText(t, result));
    },
  });
  useUnsavedChangesGuard(autosave.isDirty);

  // Zamknięcie panelu z niezapisaną treścią: dokończ zapis w tle (zapis jest
  // mutacją React Query - nie zależy od zamontowanego komponentu).
  const flushRef = useRef(autosave.flush);
  flushRef.current = autosave.flush;
  const dirtyRef = useRef(autosave.isDirty);
  dirtyRef.current = autosave.isDirty;
  useEffect(
    () => () => {
      if (dirtyRef.current) void flushRef.current().catch(() => undefined);
    },
    [],
  );

  const status: SaveStatusText =
    autosave.status === "error"
      ? { text: autosave.error ?? t("adminJourneys.emailStep.failed"), tone: "error" }
      : autosave.status === "saving"
        ? { text: t("adminJourneys.emailStep.saving"), tone: "muted" }
        : autosave.status === "dirty"
          ? { text: t("adminJourneys.emailStep.dirty"), tone: "muted" }
          : autosave.status === "saved"
            ? { text: t("adminJourneys.emailStep.saved"), tone: "muted" }
            : null;

  const field = (name: DraftField, labelKey: string, hintKey?: string) => {
    const fieldId = `${id}-${name}`;
    const error = errors[name];
    const errorText = error ? t(error.key, error.values) : null;
    const hint = hintKey ? t(hintKey) : undefined;
    return (
      <SheetField
        id={fieldId}
        label={t(labelKey)}
        hint={hint}
        error={errorText}
        counter={t("adminJourneys.common.counter", {
          count: draft[name].trim().length,
          max: FIELD_LIMITS[name].max,
        })}
      >
        <Input
          id={fieldId}
          value={draft[name]}
          disabled={!editable}
          required={FIELD_LIMITS[name].min > 0}
          aria-invalid={errorText ? true : undefined}
          aria-describedby={describedBy(
            hint && `${fieldId}-hint`,
            errorText && `${fieldId}-error`,
            `${fieldId}-counter`,
          )}
          onChange={(event) => setDraft({ ...draft, [name]: event.target.value })}
        />
      </SheetField>
    );
  };

  return (
    <div className="space-y-4" data-testid="journey-email-variant" data-variant={variant}>
      {props.templateMatch ? (
        <p role="note" className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t("adminJourneys.common.issue.content_from_template")}
        </p>
      ) : null}
      {variant === "B" && props.row === null ? (
        <p role="note" className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t("adminJourneys.emailStep.variantFallback")}
        </p>
      ) : null}
      {initial.docInvalid ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t("adminJourneys.emailStep.docInvalid")}
        </p>
      ) : null}

      {field("subjectPl", "adminJourneys.emailStep.subjectPl")}
      {field("subjectEn", "adminJourneys.emailStep.subjectEn", "adminJourneys.emailStep.subjectEnHint")}
      {field("preheaderPl", "adminJourneys.emailStep.preheaderPl", "adminJourneys.emailStep.preheaderHint")}
      {field("preheaderEn", "adminJourneys.emailStep.preheaderEn")}

      <fieldset disabled={!editable} className="min-w-0 space-y-3">
        <legend className="text-sm font-medium">{t("adminJourneys.emailStep.content")}</legend>
        <DocBlocks doc={draft.doc} onChange={(doc) => setDraft({ ...draft, doc })} />
      </fieldset>

      <VariablesHelp />
      <EmailPreview draft={draft} />

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p
          role="status"
          aria-live="polite"
          className={status?.tone === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
          data-testid="journey-email-status"
        >
          {status?.text ?? ""}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!editable || !valid || !autosave.isDirty || autosave.status === "saving"}
          onClick={() => void autosave.flush().catch(() => undefined)}
        >
          {t("adminJourneys.emailStep.saveNow")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Lista bloków + właściwości zaznaczonego. Kolejność zmieniają przyciski
 * (bez przeciągania), a reguły (kopia głęboka z nowym id, przestawienie)
 * są wspólne z kreatorem kampanii.
 */
function DocBlocks({ doc, onChange }: { doc: EmailDoc; onChange: (doc: EmailDoc) => void }) {
  const { t } = useTranslation();
  const listId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(doc.blocks[0]?.id ?? null);
  const blockLabel = (type: EmailBlockType) => {
    const key = blockRules.blockLabelKey(type);
    return key === null ? type : t(key);
  };
  const setBlocks = (blocks: EmailBlock[]) => onChange({ ...doc, blocks });
  const selectedIndex = doc.blocks.findIndex((block) => block.id === selectedId);
  const selected = selectedIndex >= 0 ? doc.blocks[selectedIndex] : null;
  const move = (offset: -1 | 1) => {
    const target = doc.blocks[selectedIndex + offset];
    if (!selected || !target) return;
    const next = blockRules.reorderBlocks(doc.blocks, selected.id, target.id);
    if (next) setBlocks(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("adminJourneys.emailStep.addBlock")}>
        {JOURNEY_EMAIL_BLOCK_TYPES.map((type) => (
          <Button
            key={type}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const block = createEmailBlock(type);
              setBlocks(blockRules.appendBlock(doc.blocks, block));
              setSelectedId(block.id);
            }}
          >
            {t("adminJourneys.emailStep.addBlockType", { type: blockLabel(type) })}
          </Button>
        ))}
      </div>
      {doc.blocks.length === 0 ? (
        <p className="rounded-[6px] border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          {t("adminNewsletter.blocks.emptyDocument")}
        </p>
      ) : (
        <ol id={listId} className="space-y-1" aria-label={t("adminJourneys.emailStep.blocks")}>
          {doc.blocks.map((block, index) => (
            <li key={block.id}>
              <Button
                type="button"
                variant={block.id === selectedId ? "secondary" : "ghost"}
                size="sm"
                className="w-full justify-start"
                aria-pressed={block.id === selectedId}
                onClick={() => setSelectedId(block.id)}
              >
                {t("adminJourneys.emailStep.blockItem", { position: index + 1, label: blockLabel(block.type) })}
              </Button>
            </li>
          ))}
        </ol>
      )}
      {selected ? (
        <div className="space-y-3 rounded-[6px] border border-border p-3" data-testid="journey-email-block">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-auto text-xs font-medium">
              {t("adminNewsletter.blocks.properties")}: {blockLabel(selected.type)}
            </span>
            <Button type="button" variant="ghost" size="sm" disabled={selectedIndex === 0} onClick={() => move(-1)}>
              {t("adminJourneys.emailStep.moveUp")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={selectedIndex === doc.blocks.length - 1}
              onClick={() => move(1)}
            >
              {t("adminJourneys.emailStep.moveDown")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                const result = blockRules.duplicateBlock(doc.blocks, selected.id);
                if (!result) return;
                setBlocks(result.blocks);
                setSelectedId(result.copyId);
              }}
            >
              {t("adminNewsletter.blocks.duplicate")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => {
                setBlocks(blockRules.removeBlock(doc.blocks, selected.id));
                setSelectedId(doc.blocks[selectedIndex + 1]?.id ?? doc.blocks[selectedIndex - 1]?.id ?? null);
              }}
            >
              {t("adminNewsletter.blocks.remove")}
            </Button>
          </div>
          <CampaignBlockProperties
            block={selected}
            onChange={(block) => setBlocks(blockRules.updateBlock(doc.blocks, block))}
          />
        </div>
      ) : null}
    </div>
  );
}

function VariablesHelp() {
  const { t } = useTranslation();
  return (
    <details className="rounded-[6px] border border-border p-3 text-xs">
      <summary className="cursor-pointer text-sm font-medium">
        {t("adminJourneys.emailStep.variablesTitle")}
      </summary>
      <p className="mt-2 text-muted-foreground">{t("adminJourneys.emailStep.variablesHint")}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {JOURNEY_VARIABLES.map((variable) => (
          <Fragment key={variable.key}>
            <dt>
              <code className="font-mono">{`{{${variable.key}}}`}</code>
            </dt>
            <dd className="text-muted-foreground">{t(journeyLabelKey("variable", variable.key))}</dd>
          </Fragment>
        ))}
      </dl>
    </details>
  );
}

/** Wartość opóźniona o `delay` ms (wzór `CampaignContentBuilder`). */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);
  return debounced;
}

function EmailPreview({ draft }: { draft: JourneyEmailDraft }) {
  const { t } = useTranslation();
  const [lang, setLang] = useState<JourneyPreviewLang>("pl");
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);
  const debounced = useDebouncedValue(draft, PREVIEW_DEBOUNCE_MS);
  const content = useMemo(
    () => ({
      subjectPl: debounced.subjectPl,
      subjectEn: debounced.subjectEn,
      preheaderPl: debounced.preheaderPl,
      preheaderEn: debounced.preheaderEn,
      doc: debounced.doc,
    }),
    [debounced],
  );
  const preview = useMemo(() => journeyEmailPreview(content, { lang, origin }), [content, lang, origin]);
  const issues = useMemo(() => journeyEmailVariableIssues(content), [content]);
  const sample = JOURNEY_VARIABLE_SAMPLES[preview.locale];
  const titleId = useId();

  return (
    <section className="space-y-2" aria-labelledby={titleId} data-testid="journey-email-preview">
      <div className="flex items-center gap-2">
        <h4 id={titleId} className="text-sm font-medium">
          {t("adminNewsletter.blocks.preview")}
        </h4>
        <div className="ml-auto flex items-center gap-1" role="group" aria-label={t("adminJourneys.emailStep.previewLang")}>
          {(["pl", "en"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={lang === value ? "default" : "outline"}
              aria-pressed={lang === value}
              onClick={() => setLang(value)}
            >
              {t(`adminJourneys.emailStep.lang.${value}`)}
            </Button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(JOURNEY_PREVIEW_NOTE_KEY.samples, { name: `${sample.first_name} ${sample.last_name}` })}
      </p>
      {preview.fallbackLocale ? (
        <p role="note" className="text-xs text-muted-foreground">
          {t(JOURNEY_PREVIEW_NOTE_KEY.fallbackLocale)}
        </p>
      ) : null}
      {issues.unknown.length > 0 ? (
        <p role="note" className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t(JOURNEY_PREVIEW_NOTE_KEY.unknownVariables, {
            list: issues.unknown.map((key) => `{{${key}}}`).join(", "),
          })}
        </p>
      ) : null}
      {issues.blankInUrls.length > 0 ? (
        <p role="note" className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t(JOURNEY_PREVIEW_NOTE_KEY.blankInUrls, {
            list: issues.blankInUrls.map((key) => `{{${key}}}`).join(", "),
          })}
        </p>
      ) : null}
      {preview.ok ? (
        <div className="space-y-2">
          <dl className="space-y-0.5 text-xs">
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">{t("adminJourneys.emailStep.previewSubject")}</dt>
              <dd className="font-medium" data-testid="journey-email-preview-subject">
                {preview.subject}
              </dd>
            </div>
            {preview.preheader ? (
              <div className="flex gap-1.5">
                <dt className="text-muted-foreground">{t("adminJourneys.emailStep.previewPreheader")}</dt>
                <dd>{preview.preheader}</dd>
              </div>
            ) : null}
          </dl>
          {/* Ramka pokazuje mail tak, jak zobaczy go klient poczty (białe tło
              niezależnie od motywu panelu) - jak podgląd kreatora kampanii. */}
          <iframe
            title={t("adminNewsletter.blocks.previewFrameTitle")}
            srcDoc={journeyEmailPreviewDocument(preview.html)}
            sandbox=""
            className="h-[480px] w-full rounded-[6px] border border-border bg-white"
          />
        </div>
      ) : (
        <p role="note" className="rounded-[6px] border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          {t(JOURNEY_PREVIEW_ERROR_KEY[preview.error])}
        </p>
      )}
    </section>
  );
}
