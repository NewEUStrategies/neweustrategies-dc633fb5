// Atom: pole „jedna pozycja na linię" dla list napisów w treści widgetu
// (rotujące teksty, słowa nagłówka animowanego).
//
// Dokument trzyma listę JUŻ znormalizowaną: przycięte pozycje, bez pustych
// linii. Pole, które pokazywało `lista.join("\n")`, połykało więc każdy Enter
// i każdą spację na końcu tekstu - zapis po naciśnięciu dawał tę samą listę,
// a kontrolowany `<textarea>` wracał do niej, zanim redaktor zdążył napisać
// następny znak. Drugiej pozycji ani tekstu z dwóch słów nie dało się wpisać
// z klawiatury, tylko wkleić.
//
// Tu pole trzyma SZKIC (surowy tekst redaktora) tak długo, jak znaczy on TO
// SAMO co dokument. Gdy dokument zmieni się spoza pola (cofnięcie, przełączenie
// wersji językowej, import), szkic przestaje się zgadzać i pole pokazuje
// dokument. Bez efektu synchronizującego - wartość jest wyliczana w renderze.
import { useState, type ComponentProps } from "react";
import { Textarea } from "@/components/ui/textarea";
import { splitLineList } from "./lineList";

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((item, i) => item === b[i]);

type Props = Omit<ComponentProps<typeof Textarea>, "value" | "onChange"> & {
  value: readonly string[];
  onChange: (next: string[]) => void;
};

export function LineListTextarea({ value, onChange, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft !== null && sameList(splitLineList(draft), value) ? draft : value.join("\n");
  return (
    <Textarea
      {...rest}
      value={shown}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const next = splitLineList(raw);
        // Enter albo spacja na końcu nie zmieniają listy - bez zapisu, żeby
        // samo pisanie nie produkowało kroków cofania bez treści.
        if (!sameList(next, value)) onChange(next);
      }}
    />
  );
}
