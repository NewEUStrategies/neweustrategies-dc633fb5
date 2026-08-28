// Molekuła: CENNIK FAZOWY jednego biletu (early bird -> regular -> last minute).
//
// KOLEJNOŚĆ JEST CZĘŚCIĄ UMOWY, NIE KOSMETYKĄ. Baza bierze PIERWSZY próg,
// którego okno obejmuje „teraz" (`_event_ticket_phase`), więc przesunięcie
// wiersza zmienia kwotę pobieraną w kasie. Dlatego wiersze mają widoczny numer
// i przyciski przenoszenia, zamiast sortowania ukrytego w polu liczbowym.
//
// PUSTE OKNO ZNACZY „BEZ GRANICY", NIE „DZIŚ". Brak daty początku znaczy „od
// zawsze", brak końca - „bezterminowo"; podstawienie bieżącej chwili zamieniłoby
// próg zaplanowany na przyszłość w próg obowiązujący od razu.
//
// GROSZE, NIE ZŁOTÓWKI - tak jak w pozostałych polach cenowych biletu. Jedna
// jednostka w całym module to brak pomyłki o dwa rzędy wielkości.
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TICKET_MAX_PHASES,
  emptyTicketPhase,
  type TicketPhaseDraft,
} from "@/lib/events/ticketDraft";

export interface EventTicketPhasesEditorProps {
  phases: TicketPhaseDraft[];
  onChange: (phases: TicketPhaseDraft[]) => void;
  /** Komunikat walidacji dla CAŁEJ listy - baza też odrzuca ją w całości. */
  error: string | null;
}

export function EventTicketPhasesEditor({ phases, onChange, error }: EventTicketPhasesEditorProps) {
  const { t } = useTranslation();

  const patch = (index: number, part: Partial<TicketPhaseDraft>) =>
    onChange(phases.map((phase, i) => (i === index ? { ...phase, ...part } : phase)));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= phases.length) return;
    const next = [...phases];
    const [row] = next.splice(index, 1);
    next.splice(target, 0, row);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {t("adminEventRegistration.tickets.editor.phasesHint")}
      </p>

      {phases.length === 0 ? (
        <p className="rounded-[6px] border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t("adminEventRegistration.tickets.editor.phasesEmpty")}
        </p>
      ) : null}

      <ol className="space-y-3">
        {phases.map((phase, index) => (
          <li
            key={index}
            className="space-y-3 rounded-[6px] border border-border bg-card p-3"
            data-testid="ticket-phase-row"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">
                {t("adminEventRegistration.tickets.editor.phaseNumber", { index: index + 1 })}
              </span>
              <span className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("adminEventRegistration.tickets.editor.phaseMoveUp")}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("adminEventRegistration.tickets.editor.phaseMoveDown")}
                  disabled={index === phases.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("adminEventRegistration.tickets.editor.phaseRemove")}
                  onClick={() => onChange(phases.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={`phase-label-pl-${index}`}>
                  {t("adminEventRegistration.tickets.editor.phaseLabelPl")}
                </Label>
                <Input
                  id={`phase-label-pl-${index}`}
                  value={phase.labelPl}
                  maxLength={80}
                  onChange={(event) => patch(index, { labelPl: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`phase-label-en-${index}`}>
                  {t("adminEventRegistration.tickets.editor.phaseLabelEn")}
                </Label>
                <Input
                  id={`phase-label-en-${index}`}
                  value={phase.labelEn}
                  maxLength={80}
                  onChange={(event) => patch(index, { labelEn: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`phase-from-${index}`}>
                  {t("adminEventRegistration.tickets.editor.phaseFrom")}
                </Label>
                <Input
                  id={`phase-from-${index}`}
                  type="datetime-local"
                  value={phase.from}
                  onChange={(event) => patch(index, { from: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`phase-to-${index}`}>
                  {t("adminEventRegistration.tickets.editor.phaseTo")}
                </Label>
                <Input
                  id={`phase-to-${index}`}
                  type="datetime-local"
                  value={phase.to}
                  onChange={(event) => patch(index, { to: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`phase-price-${index}`}>
                  {t("adminEventRegistration.tickets.editor.phasePrice")}
                </Label>
                <Input
                  id={`phase-price-${index}`}
                  inputMode="numeric"
                  value={phase.priceCents}
                  onChange={(event) => patch(index, { priceCents: event.target.value })}
                />
              </div>
            </div>
          </li>
        ))}
      </ol>

      {error !== null ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={phases.length >= TICKET_MAX_PHASES}
        onClick={() => onChange([...phases, emptyTicketPhase()])}
      >
        <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
        {t("adminEventRegistration.tickets.editor.phaseAdd")}
      </Button>
    </div>
  );
}
