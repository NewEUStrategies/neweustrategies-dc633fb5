// MOLEKUŁA: para pól PL/EN dla jednej wartości tekstowej.
//
// Wyprowadzona z `admin.login-settings.tsx` (lokalny `BiField`, 12 wywołań,
// zero asercji). Jedna odpowiedzialność: pokazać dwie wersje językowe TEJ SAMEJ
// wartości obok siebie, żeby brak tłumaczenia był widoczny bez przełączania
// języka panelu. Etykieta przychodzi z zewnątrz - molekuła nie zna słownika.
//
// SPRAWDZONE PRZED NAPISANIEM: `admin/post-editor/molecules/BilingualPickerCard`
// jest listą wyboru opcji dwujęzycznych, nie parą pól tekstowych; w repo nie ma
// dziś pary PL/EN do wielokrotnego użycia, stąd ta molekuła.
//
// ETYKIETA JEST POWIĄZANA Z POLEM przez `htmlFor`/`id` z `useId`. Bez tego
// czytnik ekranu ogłasza „pole edycji", a w tej zakładce jest ich dwadzieścia
// cztery - operator korzystający z czytnika musiałby zgadywać, które to.
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface BilingualTextFieldProps {
  label: string;
  valuePl: string;
  valueEn: string;
  onChangePl: (value: string) => void;
  onChangeEn: (value: string) => void;
  /** Wartości wielolinijkowe (opisy, podtytuły) dostają `Textarea`. */
  multiline?: boolean;
}

export function BilingualTextField({
  label,
  valuePl,
  valueEn,
  onChangePl,
  onChangeEn,
  multiline,
}: BilingualTextFieldProps) {
  const plId = useId();
  const enId = useId();
  const Control = multiline ? Textarea : Input;
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <Label htmlFor={plId}>{label} (PL)</Label>
        <Control
          id={plId}
          value={valuePl}
          onChange={(event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            onChangePl(event.target.value)
          }
        />
      </div>
      <div>
        <Label htmlFor={enId}>{label} (EN)</Label>
        <Control
          id={enId}
          value={valueEn}
          onChange={(event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            onChangeEn(event.target.value)
          }
        />
      </div>
    </div>
  );
}
