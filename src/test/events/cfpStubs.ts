// Atrapy kontrolek dla testów ekranów NABORU PRELEGENTÓW.
//
// Te same kontrakty, co atrapy w testach pozostałych ekranów modułu: natywna
// droplista w miejsce `FormSelect` (Radix nie otwiera popupu pod happy-dom),
// natywne pole ISO w miejsce `DateTimePicker` (kalendarz to popover) oraz
// wyszukiwarka członków zastąpiona przyciskiem, który „wybiera" konto.
//
// Bez JSX - moduł jest wciągany z wnętrza fabryk `vi.mock` (wzorzec
// `@/test/reactStubs`).
import type * as React from "react";

type ReactModule = typeof React;

/** Moduł-atrapa `@/components/atoms/FormSelect`. */
export function formSelectStubModule(react: ReactModule): Record<string, unknown> {
  const FormSelect = ({
    id,
    value,
    options,
    onValueChange,
    disabled,
    "aria-label": ariaLabel,
  }: {
    id?: string;
    value: string;
    options: readonly { value: string; label: unknown }[];
    onValueChange: (value: string) => void;
    disabled?: boolean;
    "aria-label"?: string;
  }) =>
    react.createElement(
      "select",
      {
        id,
        "aria-label": ariaLabel,
        value,
        disabled,
        onChange: (event: { target: { value: string } }) => onValueChange(event.target.value),
      },
      options.map((option) =>
        react.createElement("option", { key: option.value, value: option.value }, option.label as never),
      ),
    );
  return { FormSelect, default: FormSelect };
}

/** Moduł-atrapa `@/components/ui/datetime-picker`: napis ISO albo `""` = brak. */
export function dateTimePickerStubModule(react: ReactModule): Record<string, unknown> {
  return {
    DateTimePicker: ({
      id,
      value,
      onChange,
    }: {
      id?: string;
      value: string | null;
      onChange: (iso: string | null) => void;
    }) =>
      react.createElement("input", {
        id,
        value: value ?? "",
        onChange: (event: { target: { value: string } }) =>
          onChange(event.target.value === "" ? null : event.target.value),
      }),
  };
}

/** Moduł-atrapa `@/components/admin/community/MemberPicker`: przycisk wybiera `u-picked`. */
export function memberPickerStubModule(react: ReactModule): Record<string, unknown> {
  return {
    MemberPicker: ({
      value,
      onChange,
      labels,
    }: {
      value: string;
      onChange: (userId: string) => void;
      labels: { placeholder: string };
    }) =>
      react.createElement(
        "button",
        { type: "button", "data-value": value, onClick: () => onChange("u-picked") },
        labels.placeholder,
      ),
  };
}

/**
 * `Link` routera jako zwykłe `<a>` Z PARAMETRAMI ZAPYTANIA - testy naboru
 * sprawdzają cel `?id=` (edycja szkicu, ocena), którego `RouterLinkStub`
 * nie przenosi.
 */
export function routerLinkWithSearchStub(react: ReactModule) {
  return function LinkStub({
    to,
    params,
    search,
    children,
    activeProps: _activeProps,
    inactiveProps: _inactiveProps,
    replace: _replace,
    ...rest
  }: {
    to?: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
    children?: unknown;
    activeProps?: unknown;
    inactiveProps?: unknown;
    replace?: unknown;
    [key: string]: unknown;
  }) {
    let href = to ?? "#";
    for (const [key, value] of Object.entries(params ?? {})) href = href.replace(`$${key}`, value);
    const query = new URLSearchParams(search ?? {}).toString();
    return react.createElement("a", { ...rest, href: query === "" ? href : `${href}?${query}` }, children as never);
  };
}
