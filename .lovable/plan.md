## Cel

Klik / hover na element w preview (bulletpoint, etykieta, placeholder, przycisk, zgoda, tytuł, opis) → mini toolbar tuż nad elementem z szybkim regulatorem rozmiaru + przycisk „Otwórz w panelu" który przewija właściwą kontrolkę w panelu Styl i podświetla ją.

Zakres: builder canvas (edycja), NIE na opublikowanej stronie. Granularność grupowa — edycja jednej kontrolki (np. `perkSize`) wpływa na wszystkie bullety.

## Warstwy zmian

### 1. Oznaczenie elementów edytowalnych (widgety)

W `src/components/interests/JoinUsForm.tsx` i `src/components/blocks/ContactFormView.tsx` dodaję atrybut `data-edit-target="<klucz>"` na elementach:

| Element | data-edit-target (join-us) | (contact-form) |
|---|---|---|
| Tytuł | `titleSize` | `titleSize` |
| Opis | `descriptionSize` | `descriptionSize` |
| Bullet | `perkSize` | - |
| Label pola | `labelSize` | `labelSize` |
| Input/placeholder | `placeholderSize` | `placeholderSize` |
| Przycisk submit | `buttonSize` | `buttonFontSize` |
| Zgody / newsletter | `consentSize` | `consentSize` |

Atrybuty są zawsze w DOM (nieinwazyjne — bez wpływu na produkcję), toolbar aktywuje się tylko wewnątrz `[data-visual-canvas]`.

### 2. Nowy komponent `InlineEditToolbar`

Ścieżka: `src/components/admin/builder/ui/organisms/InlineEditToolbar.tsx`

- Mountowany raz w `VisualCanvas`.
- Listener `pointerover` / `click` na canvas → wykrywa `[data-edit-target]` wewnątrz `[data-widget-id]` należącego do aktualnie zaznaczonego widgetu.
- Portal `position:fixed` nad elementem (getBoundingClientRect + scroll listener).
- Zawartość: nazwa grupy · stepper `–` / wartość px / `+` · przycisk „Otwórz w panelu".
- Zmiany wywołują `onSetContent(key, n)` przekazane przez context / prop drilling z Buildera (używa tego samego `setContent` co panel — pełna spójność, undo/redo działa automatycznie).

### 3. Auto-scroll + podświetlenie w panelu

- Toolbar dispatch `CustomEvent('lovable:focus-field', { detail: { key } })`.
- `WidgetProperties` listenuje event → przełącza tab `Styl` → `element.scrollIntoView({block:'center'})` → dodaje klasę `.is-focused` na 1.5s (ring-2 ring-brand animate-pulse).
- Do każdego `PropField` w sekcji Rozmiary dodaję `data-field-key={f.key}` żeby móc go znaleźć.

### 4. Guardy

- Toolbar renderuje się TYLKO gdy: element ma `data-edit-target`, jest wewnątrz aktualnie zaznaczonego widgetu, widget to `join-us` lub `contact-form`.
- Domyślne wartości (gdy klucz pusty) czytane z tego samego mapowania fallbacków co widgety (14px inputy, 12px labels, 11px consent itd.).
- Klawiatura: `Esc` chowa toolbar, `↑`/`↓` +/- 1px, `Shift+↑`/`↓` +/- 4px.

## Pliki

- edit: `src/components/interests/JoinUsForm.tsx` (dodanie `data-edit-target`)
- edit: `src/components/blocks/ContactFormView.tsx` (dodanie `data-edit-target`)
- new: `src/components/admin/builder/ui/organisms/InlineEditToolbar.tsx`
- edit: `src/components/admin/builder/ui/organisms/builder/VisualCanvas.tsx` (mount toolbara)
- edit: `src/components/admin/builder/WidgetProperties.tsx` (listener eventu + `data-field-key` + animacja focus)

## Poza zakresem (do potwierdzenia)

- Per-element overrides (np. inny rozmiar dla pojedynczego bulleta) — pomijam zgodnie z odpowiedzią „grupy".
- Zmiana koloru / wagi / dekoracji z toolbara — MVP tylko rozmiar. Mogę dodać w kolejnej iteracji.
- Rozszerzenie na inne widgety (newsletter, login-form) — analogicznie, po zatwierdzeniu wzorca.

Potwierdź plan albo powiedz co zmienić, wtedy wdrażam.
