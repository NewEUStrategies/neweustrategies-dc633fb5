// Molekuła: JEDEN kod odmowy - surowy kod nad zdaniem, które go wyjaśnia.
//
// CO BYŁO W ORGANIZMIE. Lokalna `CodeCard` w `ClubElementsCatalog`, używana
// w trzech miejscach (powody odmowy dostępu, błędy zaproszeń, błędy zapisu).
//
// DLACZEGO KOD JEST NAD ZDANIEM, A NIE POD. Operator przychodzi tu z KODEM
// w ręku - widzi go w logu albo w komunikacie od użytkownika - i szuka
// wyjaśnienia. Kod monospacem u góry karty jest tym, po czym skanuje wzrokiem;
// zdanie jest odpowiedzią, nie nagłówkiem.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać parę kod-zdanie. Molekuła nie wie, z którego
// słownika pochodzi kod, i nie filtruje - to robi `catalogCodeRows`.
export function ClubInboxCatalogCodeCard({ code, sentence }: { code: string; sentence: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-card/50 p-3">
      <p className="font-mono text-xs text-muted-foreground">{code}</p>
      <p className="mt-1 text-sm">{sentence}</p>
    </div>
  );
}
