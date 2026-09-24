// Jedno źródło prawdy o adresie profilu osoby.
//
// People (`/people/<slug>`) - każda zarejestrowana osoba.
// Author (`/author/<slug>`) - wyłącznie rola nadana przez admina/superadmina
// lub przyjęte zaproszenie z rolą autora. Powierzchnie społeczności (kluby,
// wzmianki, czat, wyszukiwarka, organizacje) nie znają roli, więc domyślnie
// kierują na People; profil członka sam podaje odnośnik do profilu autora.
export interface ProfileHrefInput {
  slug: string;
  isAuthor?: boolean;
}

export function profileHref({ slug, isAuthor = false }: ProfileHrefInput): string {
  const safe = encodeURIComponent(slug);
  return isAuthor ? `/author/${safe}` : `/people/${safe}`;
}
