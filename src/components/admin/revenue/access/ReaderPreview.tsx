// Organizm: symulator czytelnika na zakładce Dostęp (SPEC §2.2 `access`,
// §6.1 `ReaderPreview`) - pięć person, ta sama ściana co w artykule.
//
// TEN SAM MODUŁ `Paywall`. Symulator NIE ma własnej kopii ściany: renderuje
// import `Paywall` z `src/components/Paywall.tsx` z propem `preview`
// (persona zamiast sesji, AD-16). Tryb podglądu jest w komponencie ściany
// wyłączony z efektów - bez `record_paywall_hit`, bez `track()`, linki
// `aria-disabled`, kasa nie startuje - więc oglądanie ściany w hubie nie
// zawyża pomiaru paywalla i nie zakłada zamówień. Test tożsamości importu:
// `ReaderPreview.test.tsx`.
//
// SCENARIUSZE Z INWENTARZA. Lista „rodzaj treści" to pary (tryb, próg) z
// reguł najemcy; serwis bez bramek dostaje przykładową treść płatną, żeby
// admin zobaczył ofertę, zanim założy pierwszą regułę.
//
// Persona, która przeszłaby przez bramkę, nie widzi ściany - symulator mówi
// to zdaniem zamiast pokazywać ścianę komuś, kto by jej nie zobaczył.
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Paywall } from "@/components/Paywall";
import { FormSelect } from "@/components/atoms/FormSelect";
import { Button } from "@/components/ui/button";
import { ensureI18n as ensureFunnelI18n } from "@/lib/i18n-admin-revenue-funnel";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import type { AccessInventoryDto } from "@/lib/revenue/access/dto";
import { ACCESS_MODE_KEY } from "./accessKeys";
import {
  READER_PERSONAS,
  SAMPLE_SCENARIO,
  personaHasAccess,
  personaViewer,
  previewRule,
  readerScenarios,
  type ReaderPersona,
} from "./readerPersonas";

const PERSONA_KEY: Readonly<Record<ReaderPersona, string>> = {
  guest: "adminRevenue.accessTab.preview.persona.guest",
  signedIn: "adminRevenue.accessTab.preview.persona.signedIn",
  lowerRank: "adminRevenue.accessTab.preview.persona.lowerRank",
  subscriber: "adminRevenue.accessTab.preview.persona.subscriber",
  orgMember: "adminRevenue.accessTab.preview.persona.orgMember",
};

export interface ReaderPreviewProps {
  inventory: AccessInventoryDto;
}

export function ReaderPreview({ inventory }: ReaderPreviewProps) {
  ensureFunnelI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const headingId = useId();
  const scenarioId = useId();
  const personaLabelId = useId();
  const scenarios = useMemo(() => readerScenarios(inventory), [inventory]);
  const [chosen, setChosen] = useState<string>(() => scenarios[0]?.id ?? SAMPLE_SCENARIO.id);
  const [persona, setPersona] = useState<ReaderPersona>("guest");
  const scenario = scenarios.find((s) => s.id === chosen) ?? scenarios[0] ?? SAMPLE_SCENARIO;
  const viewer = personaViewer(
    persona,
    scenario,
    inventory.tiers,
    t("adminRevenue.accessTab.preview.orgSample"),
  );

  const options =
    scenarios.length === 0
      ? [{ value: SAMPLE_SCENARIO.id, label: t("adminRevenue.accessTab.preview.sampleRule") }]
      : scenarios.map((s) => ({
          value: s.id,
          label: t("adminRevenue.accessTab.preview.scenarioOption", {
            mode: t(ACCESS_MODE_KEY[s.mode]),
            threshold:
              s.minTierRank > 0
                ? t("adminRevenue.access.rankThreshold", { rank: s.minTierRank })
                : t("adminRevenue.access.noThreshold"),
          }),
        }));

  let frame;
  if (viewer === null) {
    frame = (
      <p role="status" className="m-0 text-sm text-muted-foreground">
        {t("adminRevenue.accessTab.preview.noLowerTier")}
      </p>
    );
  } else if (personaHasAccess(viewer, scenario)) {
    frame = (
      <p
        role="status"
        data-testid="preview-has-access"
        className="m-0 text-sm text-muted-foreground"
      >
        {t("adminRevenue.accessTab.preview.hasAccess")}
      </p>
    );
  } else {
    frame = (
      <Paywall
        key={`${scenario.id}|${persona}`}
        rule={previewRule(scenario, t("adminRevenue.accessTab.preview.sampleTeaser"))}
        lang={lang}
        fallbackText={null}
        preview={{ viewer }}
      />
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="reader-preview"
      className="min-w-0 space-y-3 rounded-[6px] border border-border p-3"
    >
      <div className="min-w-0 space-y-0.5">
        <h3 id={headingId} className="text-sm font-semibold">
          {t("adminRevenue.accessTab.preview.title")}
        </h3>
        <p className="m-0 text-xs text-muted-foreground">
          {t("adminRevenue.accessTab.preview.description")}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] space-y-1">
          <label htmlFor={scenarioId} className="block text-xs font-medium">
            {t("adminRevenue.accessTab.preview.scenario")}
          </label>
          <FormSelect
            id={scenarioId}
            value={scenario.id}
            onValueChange={setChosen}
            options={options}
          />
        </div>
        <div className="space-y-1">
          <span id={personaLabelId} className="block text-xs font-medium">
            {t("adminRevenue.accessTab.preview.personaLabel")}
          </span>
          <div role="group" aria-labelledby={personaLabelId} className="flex flex-wrap gap-1">
            {READER_PERSONAS.map((id) => (
              <Button
                key={id}
                type="button"
                size="sm"
                variant={id === persona ? "default" : "outline"}
                className="h-7"
                aria-pressed={id === persona}
                onClick={() => setPersona(id)}
              >
                {t(PERSONA_KEY[id])}
              </Button>
            ))}
          </div>
        </div>
      </div>
      <div
        role="region"
        aria-label={t("adminRevenue.accessTab.preview.frameLabel", {
          persona: t(PERSONA_KEY[persona]),
        })}
        data-persona={persona}
        className="rounded-[6px] border border-dashed border-border p-3"
      >
        {frame}
      </div>
    </section>
  );
}
