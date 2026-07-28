export function itemsOf(c, k) {
    const v = c[k];
    if (!Array.isArray(v))
        return [];
    return v.filter((x) => typeof x === "object" && x !== null && !Array.isArray(x));
}
