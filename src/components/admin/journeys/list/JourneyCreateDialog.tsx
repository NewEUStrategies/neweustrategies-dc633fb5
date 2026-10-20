// Tworzenie ścieżki (S8): instalacja szablonu z galerii albo pusta ścieżka.
//
// SZABLON: klucz techniczny, nazwa i - dla szablonu usługowego - język
// podstawy prawnej (szablon niesie ją w PL i EN). Instalacja zakłada SZKIC
// z grafem i treścią maili (`installJourneyTemplate`); nic nie jest wysyłane,
// dopóki admin nie przeczyta treści i nie opublikuje ścieżki.
//
// PUSTA ŚCIEŻKA WYMAGA WYZWALACZA. `admin_journey_create` zapisuje szkic
// `{graph:{nodes:[],edges:[]}, settings:{}}`, który nie przechodzi
// `JourneyDraftSchema` (brak `settings.triggerEventType`) - edytor dostałby
// szkic „niepoprawny” od pierwszej sekundy. Dlatego formularz pyta
// o wyzwalacz, a `useCreateJourney` od razu zapisuje pusty graf
// (`emptyJourneyGraph()`: wyzwalacz -> koniec) z tokenem z utworzenia.
// Gdyby ten drugi zapis się nie udał, ścieżka i tak istnieje - mówimy to
// i otwieramy edytor, gdzie wyzwalacz da się ustawić.
//
// LIMITY = LICZNIKI, ODRZUCENIE ZAMIAST PRZYCIĘCIA (AGENTS). Pola nie mają
// `maxLength` (przeglądarka ucinałaby wklejony tekst bez słowa) - licznik
// pokazuje limit bazy, a przekroczenie blokuje zapis z komunikatem. Zajęty
// klucz (`duplicate`/`key_taken`) wraca jako błąd pola, nie ogólny toast.
import { useId, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { MfaRequiredNotice } from "@/components/admin/revenue/molecules/MfaRequiredNotice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PlatformSelect } from "@/components/ui/platform-select";
import { Textarea } from "@/components/ui/textarea";
import { isMfaRequiredError } from "@/lib/admin/journeys/access";
import type { JourneyTemplateCatalogEntry } from "@/lib/admin/journeys/journeyEditor.functions";
import {
  mutationErrorText,
  useCreateJourney,
  useInstallJourneyTemplate,
  type JourneyMutationFailure,
} from "@/lib/admin/journeys/journeyMutations";
import { JOURNEY_CATEGORY_HINT_KEY, JOURNEY_CATEGORY_LABEL_KEY } from "@/lib/admin/journeys/summaries";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n } from "@/lib/i18n-admin-journeys-list";
import { journeyLabelKey, journeyTemplateLabelKeys, journeyTriggerLabelKey } from "@/lib/journeys/labels";
import { JOURNEY_CATEGORIES, JOURNEY_LIMITS, type JourneyCategory } from "@/lib/journeys/limits";
import { JOURNEY_TRIGGERS, journeyTrigger, type TriggerGroup } from "@/lib/journeys/triggers";

export type JourneyCreateMode =
  | { kind: "template"; entry: JourneyTemplateCatalogEntry }
  | { kind: "blank" };

export interface JourneyCreateDialogProps {
  mode: JourneyCreateMode | null;
  onOpenChange: (open: boolean) => void;
  tenantId: string | null;
  /** Klucze ścieżek najemcy - podpowiedź wolnego klucza i błąd przed zapisem. */
  existingKeys: ReadonlySet<string>;
  onCreated: (journeyId: string) => void;
}

/** Grupy wyzwalaczy w kolejności katalogu S5 (pierwsze wystąpienie). */
const TRIGGER_GROUPS: readonly TriggerGroup[] = [
  ...new Set(JOURNEY_TRIGGERS.map((trigger) => trigger.group)),
];

/** Klucz z nazwy: małe litery ASCII, cyfry i „-” (polskie znaki bez ogonków). */
function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

/** Pierwszy wolny klucz: `baza`, `baza-2`, `baza-3`… */
function freeKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base.slice(0, 60)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function JourneyCreateDialog({
  mode,
  onOpenChange,
  tenantId,
  existingKeys,
  onCreated,
}: JourneyCreateDialogProps) {
  ensureJourneysI18n();
  ensureI18n();
  const { t } = useTranslation();
  const templateName =
    mode?.kind === "template" ? t(journeyTemplateLabelKeys(mode.entry.key).name) : "";
  return (
    <Dialog open={mode !== null} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="journey-create-dialog"
        className="max-h-[90vh] max-w-xl overflow-y-auto rounded-[6px]"
      >
        <DialogHeader>
          <DialogTitle>
            {mode?.kind === "template"
              ? t("adminJourneys.create.templateTitle", { name: templateName })
              : t("adminJourneys.create.blankTitle")}
          </DialogTitle>
          <DialogDescription>
            {mode?.kind === "template"
              ? t("adminJourneys.create.templateDescription")
              : t("adminJourneys.create.blankDescription")}
          </DialogDescription>
        </DialogHeader>
        {mode !== null ? (
          <CreateForm
            key={mode.kind === "template" ? mode.entry.key : "blank"}
            mode={mode}
            defaultName={templateName}
            tenantId={tenantId}
            existingKeys={existingKeys}
            onCancel={() => onOpenChange(false)}
            onCreated={onCreated}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

type FieldKey = "key" | "name" | "legalBasis" | "description" | "trigger";

function CreateForm({
  mode,
  defaultName,
  tenantId,
  existingKeys,
  onCancel,
  onCreated,
}: {
  mode: JourneyCreateMode;
  defaultName: string;
  tenantId: string | null;
  existingKeys: ReadonlySet<string>;
  onCancel: () => void;
  onCreated: (journeyId: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const template = mode.kind === "template" ? mode.entry : null;
  const [name, setName] = useState(defaultName);
  const [key, setKey] = useState(() =>
    template ? freeKey(template.key, existingKeys) : "",
  );
  const [keyEdited, setKeyEdited] = useState(template !== null);
  const [category, setCategory] = useState<JourneyCategory>("marketing");
  const [legalBasis, setLegalBasis] = useState("");
  const [description, setDescription] = useState("");
  const [trigger, setTrigger] = useState("");
  const [locale, setLocale] = useState<"pl" | "en">("pl");
  const [touched, setTouched] = useState(false);
  const [serverKeyTaken, setServerKeyTaken] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const install = useInstallJourneyTemplate(tenantId);
  const create = useCreateJourney(tenantId);
  const pending = install.isPending || create.isPending;

  const effectiveKey = keyEdited ? key : slugify(name);
  const errors = useMemo(() => {
    const out: Partial<Record<FieldKey, string>> = {};
    if (!JOURNEY_LIMITS.keyPattern.test(effectiveKey)) out.key = "adminJourneys.create.keyInvalid";
    else if (existingKeys.has(effectiveKey) || serverKeyTaken === effectiveKey) {
      out.key = "adminJourneys.create.keyTaken";
    }
    const trimmed = name.trim();
    if (trimmed.length < JOURNEY_LIMITS.nameMin || trimmed.length > JOURNEY_LIMITS.nameMax) {
      out.name = "adminJourneys.create.nameInvalid";
    }
    if (template === null) {
      if (category === "service") {
        const basis = legalBasis.trim();
        if (basis.length === 0 || basis.length > JOURNEY_LIMITS.legalBasisMax) {
          out.legalBasis = "adminJourneys.create.legalBasisRequired";
        }
      }
      if (description.trim().length > JOURNEY_LIMITS.descriptionMax) {
        out.description = "adminJourneys.create.descriptionTooLong";
      }
      if (trigger === "") out.trigger = "adminJourneys.create.triggerRequired";
    }
    return out;
  }, [effectiveKey, existingKeys, serverKeyTaken, name, template, category, legalBasis, description, trigger]);
  const valid = Object.keys(errors).length === 0;
  // Błąd pola widać po pierwszej próbie zapisu; wcześniej tylko te, które
  // pomagają w trakcie pisania (klucz zajęty/zły, za długi opis) - pusty
  // formularz nie zaczyna od czerwieni.
  const show = (field: FieldKey) =>
    errors[field] &&
    (touched || (field === "key" && effectiveKey !== "") || field === "description")
      ? t(errors[field] as string)
      : undefined;

  const handleFailure = (result: JourneyMutationFailure) => {
    if (result.error === "duplicate" || result.reason === "key_taken") {
      setServerKeyTaken(effectiveKey);
      return;
    }
    if (result.error === "template_unavailable") {
      setFailure(t("adminJourneys.create.templateUnavailable"));
      return;
    }
    setFailure(mutationErrorText(t, result));
  };

  const submit = async () => {
    setTouched(true);
    setFailure(null);
    if (!valid || pending) return;
    try {
      if (template !== null) {
        const result = await install.mutateAsync({
          templateKey: template.key,
          key: effectiveKey,
          name: name.trim(),
          locale,
        });
        if (!result.ok) return handleFailure(result);
        toast.success(t("adminJourneys.create.installed"));
        onCreated(result.data.id);
        return;
      }
      const result = await create.mutateAsync({
        key: effectiveKey,
        name: name.trim(),
        category,
        legalBasis: category === "service" ? legalBasis.trim() : null,
        description: description.trim() || null,
        triggerEventType: trigger,
      });
      if (!result.ok) return handleFailure(result);
      if (result.draftSaved) toast.success(t("adminJourneys.create.created"));
      else toast.warning(t("adminJourneys.create.draftNotSaved"));
      onCreated(result.data.id);
    } catch (error) {
      if (isMfaRequiredError(error)) setMfaRequired(true);
      else setFailure(t("adminJourneys.create.error"));
    }
  };

  if (mfaRequired) return <MfaRequiredNotice />;

  const describedBy = (...parts: (string | false | undefined)[]) =>
    parts.filter(Boolean).join(" ") || undefined;
  const nameLength = name.trim().length;
  const selectedTrigger = trigger ? journeyTrigger(trigger) : null;

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FormField
        id={`${id}-name`}
        label={t("adminJourneys.create.name")}
        counter={t("adminJourneys.common.counter", { count: nameLength, max: JOURNEY_LIMITS.nameMax })}
        error={show("name")}
      >
        <Input
          id={`${id}-name`}
          value={name}
          required
          aria-invalid={show("name") ? true : undefined}
          aria-describedby={describedBy(`${id}-name-counter`, show("name") && `${id}-name-error`)}
          onChange={(event) => setName(event.target.value)}
        />
      </FormField>

      <FormField
        id={`${id}-key`}
        label={t("adminJourneys.create.key")}
        hint={t("adminJourneys.create.keyHint")}
        error={show("key")}
      >
        <Input
          id={`${id}-key`}
          value={effectiveKey}
          required
          spellCheck={false}
          autoCapitalize="off"
          className="font-mono"
          aria-invalid={show("key") ? true : undefined}
          aria-describedby={describedBy(`${id}-key-hint`, show("key") && `${id}-key-error`)}
          onChange={(event) => {
            setKeyEdited(true);
            setKey(event.target.value);
          }}
        />
      </FormField>

      {template !== null ? (
        template.hasLegalBasis ? (
          <FormField
            id={`${id}-locale`}
            label={t("adminJourneys.create.language")}
            hint={t("adminJourneys.create.languageHint")}
          >
            <PlatformSelect
              id={`${id}-locale`}
              value={locale}
              aria-describedby={`${id}-locale-hint`}
              onChange={(event) => setLocale(event.target.value === "en" ? "en" : "pl")}
            >
              <option value="pl">{t("adminJourneys.create.languagePl")}</option>
              <option value="en">{t("adminJourneys.create.languageEn")}</option>
            </PlatformSelect>
          </FormField>
        ) : null
      ) : (
        <>
          <FormField
            id={`${id}-trigger`}
            label={t("adminJourneys.create.trigger")}
            hint={
              selectedTrigger?.emailForbidden
                ? t("adminJourneys.create.triggerEmailForbidden")
                : t("adminJourneys.create.triggerHint")
            }
            error={show("trigger")}
          >
            <PlatformSelect
              id={`${id}-trigger`}
              value={trigger}
              required
              placeholder={t("adminJourneys.create.triggerPlaceholder")}
              aria-invalid={show("trigger") ? true : undefined}
              aria-describedby={describedBy(`${id}-trigger-hint`, show("trigger") && `${id}-trigger-error`)}
              onChange={(event) => setTrigger(event.target.value)}
            >
              {TRIGGER_GROUPS.map((group) => (
                <optgroup key={group} label={t(journeyLabelKey("triggerGroup", group))}>
                  {JOURNEY_TRIGGERS.filter((def) => def.group === group).map((def) => (
                    <option key={def.eventType} value={def.eventType}>
                      {t(journeyTriggerLabelKey(def.eventType))}
                    </option>
                  ))}
                </optgroup>
              ))}
            </PlatformSelect>
          </FormField>

          <FormField
            id={`${id}-category`}
            label={t("adminJourneys.create.category")}
            hint={t(JOURNEY_CATEGORY_HINT_KEY[category])}
          >
            <PlatformSelect
              id={`${id}-category`}
              value={category}
              aria-describedby={`${id}-category-hint`}
              onChange={(event) =>
                setCategory(event.target.value === "service" ? "service" : "marketing")
              }
            >
              {JOURNEY_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {t(JOURNEY_CATEGORY_LABEL_KEY[value])}
                </option>
              ))}
            </PlatformSelect>
          </FormField>

          {category === "service" ? (
            <FormField
              id={`${id}-legal`}
              label={t("adminJourneys.create.legalBasis")}
              hint={t("adminJourneys.create.legalBasisHint")}
              counter={t("adminJourneys.common.counter", {
                count: legalBasis.trim().length,
                max: JOURNEY_LIMITS.legalBasisMax,
              })}
              error={show("legalBasis")}
            >
              <Textarea
                id={`${id}-legal`}
                value={legalBasis}
                required
                rows={2}
                aria-invalid={show("legalBasis") ? true : undefined}
                aria-describedby={describedBy(
                  `${id}-legal-hint`,
                  `${id}-legal-counter`,
                  show("legalBasis") && `${id}-legal-error`,
                )}
                onChange={(event) => setLegalBasis(event.target.value)}
              />
            </FormField>
          ) : null}

          <FormField
            id={`${id}-description`}
            label={t("adminJourneys.create.description")}
            counter={t("adminJourneys.common.counter", {
              count: description.trim().length,
              max: JOURNEY_LIMITS.descriptionMax,
            })}
            error={show("description")}
          >
            <Textarea
              id={`${id}-description`}
              value={description}
              rows={2}
              aria-invalid={show("description") ? true : undefined}
              aria-describedby={describedBy(
                `${id}-description-counter`,
                show("description") && `${id}-description-error`,
              )}
              onChange={(event) => setDescription(event.target.value)}
            />
          </FormField>
        </>
      )}

      {failure !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      ) : null}

      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("adminJourneys.common.cancel")}
        </Button>
        <Button type="submit" disabled={pending || (touched && !valid)}>
          {pending
            ? t("adminJourneys.create.submitting")
            : template !== null
              ? t("adminJourneys.create.submitTemplate")
              : t("adminJourneys.create.submitBlank")}
        </Button>
      </DialogFooter>
    </form>
  );
}

function FormField({
  id,
  label,
  hint,
  counter,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  counter?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs font-medium">
        {label}
      </Label>
      {children}
      <div className="flex flex-wrap items-start justify-between gap-2 text-xs">
        <div className="min-w-0 space-y-0.5">
          {hint ? (
            <p id={`${id}-hint`} className="text-muted-foreground">
              {hint}
            </p>
          ) : null}
          {error ? (
            <p id={`${id}-error`} className="text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        {counter ? (
          <span id={`${id}-counter`} className="shrink-0 tabular-nums text-muted-foreground">
            {counter}
          </span>
        ) : null}
      </div>
    </div>
  );
}
