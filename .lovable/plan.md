## Ujednolicenie trzech wyszukiwarek

Dziś mamy trzy różne UI wyszukiwania:

1. **Widget nagłówkowy** (`SearchButtonWidget.tsx`, 862 linie) - „mega-box" z zakładkami (Wszystko/Osoby...), sekcją operatorów, listą ostatnich fraz.
2. **Inline autosuggest na `/search`** (`SearchAutosuggest.tsx`, 86 linii) - kompaktowa lista z ikoną per bucket, bez tabów, bez avatarów, bez „ostatnich".
3. **Fullscreen overlay** (`SearchOverlay.tsx`, 427 linii) - jeszcze inny wygląd modala.

Każdy używa innego kaftanu (kolory, border-radius, spacing), innego groupowania, innej stopki.

### Cel

Jeden komponent `UnifiedSearchCombobox` w duchu wzorca Preline z briefu:
- pole `input` z ikoną lupy po lewej i (opcjonalnie) mikrofonem po prawej,
- popover `role="listbox"` z pogrupowanymi opcjami,
- każdy wiersz: ikona/avatar 16-20 px + label + prawa mikroetykieta (rola / bucket / „Autor", „Online"),
- wspólne 6px rounding, tokeny `bg-popover`, `border-border`, `text-muted-foreground`, hover `bg-accent`, active `bg-brand/10 text-brand-ink`,
- typografia Red Hat Display, rozmiary jak reszta aplikacji (`text-sm` label, `text-[10px] uppercase tracking-wider` nagłówek grupy, `text-[11px]` prawy meta),
- pełen combobox ARIA (`aria-expanded`, `aria-activedescendant`, `aria-selected`, `aria-controls`), strzałki/Enter/Esc/Home/End, mousedown zamiast click.

### Struktura

```text
src/components/search/
  UnifiedSearchCombobox.tsx    ← nowy, jedyny „widok" popovera
  useSearchAutosuggest.ts      ← wspólna logika: fetch (RPC search_autosuggest),
                                 debounce, bucketowanie, recent, keyboard nav
```

Oba pliki eksportują też typy dla dodatkowych sekcji (np. „Ostatnie", „Skróty"), żeby overlay / widget / strona mogły dorzucić własne grupy.

### Refaktor konsumentów

- **`SearchButtonWidget.tsx`** - usuwa własny popover + tabs + operator-bar; zostaje inputem + `<UnifiedSearchCombobox />`. Zachowuje swój URL-sync (`SearchUrlQSync`) i tryb liveResults - to logika, nie UI.
- **`SearchAutosuggest.tsx`** - staje się cienką reeksportacją `UnifiedSearchCombobox` z odpowiednim wariantem (bez „ostatnich", w kontekście strony `/search`), utrzymuje istniejący kontrakt propsów. Dzięki temu `routes/search.tsx` bez zmian.
- **`SearchOverlay.tsx`** - dostosowuje wewnętrzną listę do tej samej struktury wierszy (ikona + label + prawy meta) i tokenów, żeby modal wyglądał identycznie jak popover.

### Zachowania i18n / a11y / dark mode

- Wszystkie stringi przez `i18n.t('search.widget.*')` (istniejący namespace).
- Kolory tylko przez tokeny (`--popover`, `--border`, `--brand`, `--brand-ink`) - działa w light/dark.
- Testy: rozszerzyć `SearchAutosuggest.test.tsx` o warianty (recent visible / hidden, grupy, klawiatura); dołożyć test jednostkowy dla wspólnego hooka.

### Zakres testów

- `SearchAutosuggest.test.tsx` - przechodzi (reexport).
- `SearchOverlay.a11y.test.tsx` - przechodzi (ta sama semantyka listbox).
- `searchButtonWidgetRouterSync.test.tsx` + pokrewne - przechodzą, bo URL-sync i navigate zostają.
- Nowy `UnifiedSearchCombobox.test.tsx` - keyboard, grupy, mousedown-picking.

### Poza zakresem

- Nie ruszam RPC `search_autosuggest`, `facetModel`, `recentSearches`, ani routingu na `/search`.
- Nie zmieniam logiki gate'ów w widgetcie (voice, liveResults, limit, height, radius, fontSize).
- Ceny/limity/RBAC bez zmian.
