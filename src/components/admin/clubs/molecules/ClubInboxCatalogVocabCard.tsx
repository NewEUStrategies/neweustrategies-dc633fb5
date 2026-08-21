// Molekuła: KARTA słownika - ramka wokół wierszy osi.
//
// CO BYŁO W ORGANIZMIE. Lokalna `VocabCard` w `ClubElementsCatalog`. Wyszła
// tutaj W POSTACI NIEZMIENIONEJ (żaden warunek nie został przepisany), bo to
// jedyne miejsce w tym katalogu, gdzie o widoczności decyduje NIE reguła
// filtra, a to, czy dzieci w ogóle coś wyrenderowały.
//
// UWAGA DLA KOGOŚ, KTO TU TRAFI Z BŁĘDEM „pusta ramka pod filtrem”. Warunek
// niżej porównuje dzieci z `null`, ale `children` w Reakcie to ELEMENTY (obiekty
// zawsze prawdziwe), a nie ich wynik - `<ClubInboxCatalogVocabRow />`, które
// zwróci `null`, jest tu wciąż obiektem elementu. W praktyce znaczy to, że
// karta użyta z JSX-a NIE znika i pod filtrem bez trafień zostaje pusta ramka.
// Zachowanie jest tu zostawione ŚWIADOMIE 1:1 z organizmem (przeniesienie logiki
// nie jest miejscem na zmianę zachowania), a dowód na nie stoi jako `it.fails`
// w `ClubElementsCatalog.test.tsx`. Poprawka - gdy przyjdzie - ma JEDNO miejsce:
// ten plik i decyzję, żeby karta dostawała DANE wierszy, nie gotowe elementy.
import { Card, CardContent } from "@/components/ui/card";

export function ClubInboxCatalogVocabCard({ children }: { children: React.ReactNode }) {
  const rendered = Array.isArray(children) ? children.filter(Boolean) : children;
  if (Array.isArray(rendered) && rendered.every((child) => child === null)) return null;
  return (
    <Card>
      <CardContent className="p-4 sm:p-5">{children}</CardContent>
    </Card>
  );
}
