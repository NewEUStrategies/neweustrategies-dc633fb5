// Ikony przepustki Apple Wallet (`icon.png`, `@2x`, `@3x`: 29, 58 i 87 px).
//
// POCHODNE IKONY SKANERA (`public/scanner/icon-512.png`): ta sama rama kodu
// z pomarańczową linią na tle #141414, zmniejszona uśrednianiem pól (pngjs,
// jednorazowo, poza repozytorium). Wallet wymaga `icon.png` w paczce - bez
// niej odrzuca przepustkę - a pokazuje ją na ekranie blokady i w powiadomieniu.
//
// DLACZEGO STAŁE BASE64, A NIE PLIKI W `public/`. Trasa serwerowa nie
// pobiera zasobów statycznych przez sieć (dodatkowe żądanie z Workera do
// samego siebie), a pliki w `public/` konkurowałyby z trasami
// (`check:public-assets`). Trzy PNG razem to ~1,5 kB.
//
// GRANICA WARSTW: zero Reacta, zero i18next, zero sieci. Liść.

const ICON_29 =
  "iVBORw0KGgoAAAANSUhEUgAAAB0AAAAdCAIAAADZ8fBYAAABj0lEQVR4AbXBsYriQBwH4F8mwcUQEhb+cDbnxip5" +
  "BWEg9fVCinkJ8QHEt8i1gp0PYC9aDFxhoRzayCIIEUGEiKyFLqSakNyRZr7PICJowKAHgx4MejDoYaHIcZwwDKFI" +
  "0/RwOEDh+z4RQbHZbO73OxQWisIwnM1mUCRJMhwOoej3+0IIKDjn2+0WCgtVxuOxlBK53W6HoslkslwukYuiKI5j" +
  "lFioIqWcTqf4hz855FzXjeMYJQx6MOhh2rYNhWmaz+dzsVikaYoaGo3G9Xqdz+e32w0Kg4iggYUqH87r/Q11XL7w" +
  "mRkosVDl188n//FCDYvU+P3XRIlBRCj5cF7vb6jj8oXPzECJQUTQwLRtGwrf90ej0fl8Ph6PqIFzPhgMVqtVlmVQ" +
  "MBQRkRCi0+mgniAIhBCe56GIQQ8GPSxUiaLIdV3k1uu1lBIKznkQBMh1u11UsVAlziGXJImUEoperyeEwH8ZRARF" +
  "s9lst9tQXC6X0+kERavV8jwPiv1+/3g8oDCICBow6MGgB4MeDHp8A6HIfkW43s+OAAAAAElFTkSuQmCC";

const ICON_58 =
  "iVBORw0KGgoAAAANSUhEUgAAADoAAAA6CAIAAABu2d1/AAAB8UlEQVR4AdXBsYoaURSA4f+e3GKYLURyWSGLIAjT" +
  "KNhZCNuF9CvME+ybzFvY+gZaagobO9NYClNqIXEFwTXTZBKbQECvl8TmfJ9xzqGHoIqgiqCKoIqgiqCKoIqgiqCK" +
  "oIrllk6n0+v18BoOh8fjketqtVq/38drMpnkeY6X5ZZer5dlGV6j0eh4PHJdvV7Psgyv9Xqd5zlegiqWYG9vb8vl" +
  "kkuKosDrcDjMZjMu6Xa7cRwTxhJsuVymaco/Wa1WaZpyyXw+T5KEMIIqgiqCKoIqgiqCKoIqxjmH18PDQ6VSAYqi" +
  "2O123Nvj46O1Ftjv96fTCS/jnEMPQRVBFUuwT3H55ank3iZrs3k3hLEE+xjx+ekn9/bt+4fNO4EEVSzBdj/4uhH+" +
  "KMHwlxIMZyVnBkrODJRgOCvBQAkGSn7bFYQzzjn0EFQRVLHcUqvV6vU6cDgcVqsV99Zut6MoAvI83+/3eFlu6ff7" +
  "WZYBs9ksTVPubTAYJEkCvL6+jsdjvARVBFUEVQRVBFUEVQRVLMG63e58PueSl5eX7XbLde12ezAYcEmj0SCYJVgc" +
  "x0mScIm1Fq8oipIk4b8JqhjnHF7NZrPVauE1nU5PpxPXVavV5+dnvBaLxWazwcs459BDUEVQRVBFUEVQRVBFUEVQ" +
  "RVBFUOUXpbOGJigAYsQAAAAASUVORK5CYII=";

const ICON_87 =
  "iVBORw0KGgoAAAANSUhEUgAAAFcAAABXCAIAAAD+qk47AAAB2UlEQVR4Ae3BMW4aaRgA0MfHJJGQopWWqbjAVK6g" +
  "oHHBBTiFGx8iFSegc8UdxndwhVIbzmBASKmQtTsrrUTr6NcoovD33qCua59eSIRESIRESIRESIRESIRESIRESIRE" +
  "SIREpdzj4+NsNlNiu90+PT0ptFqtJpOJEm3bPj8/K1QpN5vNlsulEl3XKbdYLJqmUWK32ykXEiEREpXe7u/vj8ej" +
  "D10uF+WWy+VwOPSh+Xy+2Wz0U+nteDy+vb35A06nk985n896C4mQCImQCImQCImQCImQqJTbbrdd17m6XC5u53A4" +
  "tG3rar/fKzeo69qnFxIhERIhERKV3lbTf75/6dzIr/fBj59D/VR6+/tb99dXt/IlOr2FREhUejtdBu//dm7k1/tA" +
  "b4O6rn16IRESIRESIVEpt1qtFouFq+VyeTqd3Mh0Ol2v1642/1OoUm4ymTRN42o4HLqd0WjUNI2r8XisXEiEREiE" +
  "REiEREiEREiERKW3+Xx+Pp996HA4vL6+KjSdTkejkQ/d3d3prdLbZrPxO23bPjw8KLRer5um8eeFREiERKVc27a7" +
  "3U6J/X6v3GazGY/HSry8vCg3qOvapxcSIRESIRESIRESIRESIRESIRESIRESIfEfdQ10BSA6CS4AAAAASUVORK5C" +
  "YII=";

function decode(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Pliki ikon paczki `.pkpass` (nazwa w archiwum -> bajty PNG). */
export function walletIconFiles(): { name: string; data: Uint8Array }[] {
  return [
    { name: "icon.png", data: decode(ICON_29) },
    { name: "icon@2x.png", data: decode(ICON_58) },
    { name: "icon@3x.png", data: decode(ICON_87) },
  ];
}
