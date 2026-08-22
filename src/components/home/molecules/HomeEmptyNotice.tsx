// Strona główna BEZ TREŚCI: tryb strony statycznej, a dokument buildera jest
// pusty albo go nie ma. Osobna powierzchnia, bo to NIE jest błąd - baza
// odpowiedziała poprawnie, tylko redakcja nie zbudowała jeszcze kanwy.
// Odpowiedź ma status 200 i pełną powłokę serwisu.
//
// DŁUG I18N (świadomie ZACHOWANY): zdanie jest dwujęzycznym literałem w kodzie,
// tak jak stało w `routes/index.tsx`. Patrz nagłówek `HomeSrHeading` -
// defekt niesie test `it.fails` w `src/routes/__tests__/homeRoute.test.tsx`.
export function HomeEmptyNotice({ lang }: { lang: "pl" | "en" }) {
  return (
    <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-24 text-center text-muted-foreground">
      <p className="text-sm">
        {lang === "en"
          ? "There's nothing here yet - please check back soon."
          : "Nie ma tu jeszcze treści - zajrzyj wkrótce."}
      </p>
    </div>
  );
}
