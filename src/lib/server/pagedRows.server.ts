/** Read every PostgREST page. Offsets follow the actual response size, so a
 * server-side row cap below our requested page size does not truncate data.
 * Callers must supply a stable, unique ordering and preserve tenant filters.
 */
export async function readPagedRows<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: unknown;
    count?: number | null;
  }>,
): Promise<{ data: T[] }> {
  const data: T[] = [];
  const pageSize = 500;
  for (;;) {
    const page = await fetchPage(data.length, data.length + pageSize - 1);
    if (page.error) throw page.error;
    const rows = page.data ?? [];
    if (!Array.isArray(rows)) throw new TypeError("PostgREST page must contain an array");
    data.push(...rows);
    if (rows.length === 0 || (page.count != null && data.length >= page.count)) return { data };
  }
}
