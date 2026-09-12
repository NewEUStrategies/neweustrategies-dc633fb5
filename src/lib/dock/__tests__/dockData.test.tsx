import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import {
  notesQueryOptions,
  useNotes,
  useCreateNote,
  useUpdateNote,
  useDeleteNote,
} from "../useNotes";
import {
  todosQueryOptions,
  useTodos,
  useOpenTodoCount,
  useCreateTodo,
  useToggleTodo,
  useUpdateTodoPriority,
  useDeleteTodo,
} from "../useTodos";
import {
  readLaterQueryOptions,
  useReadLater,
  useAddReadLater,
  useSetReadLaterState,
  useRemoveReadLater,
} from "../useReadLater";
import { savedQueryOptions, useSavedEntries, savedEntryTitle } from "../useSaved";
import {
  calendarEventsQueryOptions,
  useDockCalendar,
  calendarEntryTitle,
} from "../useDockCalendar";
import { dockKeys } from "../keys";
import { sortTodos, type UserTodo } from "../types";
import { prefetchDockData } from "../prefetchDockData";

const auth = vi.hoisted(() => ({ user: { id: "member" } as { id: string } | null }));
const db = supabaseFromStub();
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => db.from(table) },
}));
let qc: QueryClient;
function wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
const tables = [
  "user_notes",
  "user_todos",
  "user_read_later",
  "user_bookmarks",
  "event_bookmarks",
  "events",
  "posts",
  "pages",
];
beforeEach(() => {
  auth.user = { id: "member" };
  db.reset();
  for (const table of tables) db.setResponse(table, ok(null));
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  qc.clear();
  vi.restoreAllMocks();
});
const todo = (id: string, patch: Partial<UserTodo> = {}): UserTodo => ({
  id,
  title: id,
  priority: "medium",
  due_at: null,
  done: false,
  done_at: null,
  source_task_id: null,
  created_at: "2026-09-01T00:00:00Z",
  ...patch,
});
const entity = {
  entityType: "post" as const,
  entityId: "11111111-1111-4111-8111-111111111111",
  title: "Article",
  url: "/article",
};

describe("dock reads and cache policy", () => {
  it.each([
    ["user_notes", () => notesQueryOptions("member").queryFn()],
    ["user_todos", () => todosQueryOptions("member").queryFn()],
    ["user_read_later", () => readLaterQueryOptions("member").queryFn()],
    ["events", () => calendarEventsQueryOptions("member", 2026, 8).queryFn()],
  ] as const)("%s handles absent data and propagates RLS errors", async (table, query) => {
    expect(await query()).toEqual([]);
    db.setResponse(table, fail("permission denied"));
    await expect(query()).rejects.toThrow("permission denied");
  });
  it("normalizes legacy rows and sorts tasks without modifying input", async () => {
    db.setResponse(
      "user_notes",
      ok([
        { id: "a", color: "unknown", entity_type: "unknown" },
        { id: "b", color: "rose", entity_type: "post" },
      ]),
    );
    expect(await notesQueryOptions("member").queryFn()).toEqual([
      expect.objectContaining({ color: "amber", entity_type: null }),
      expect.objectContaining({ color: "rose", entity_type: "post" }),
    ]);
    db.setResponse(
      "user_read_later",
      ok([
        { id: "a", entity_type: "obsolete", state: "old" },
        { id: "b", entity_type: "post", state: "read" },
      ]),
    );
    expect(await readLaterQueryOptions("member").queryFn()).toEqual([
      expect.objectContaining({ entity_type: "external", state: "unread" }),
      expect.objectContaining({ entity_type: "post", state: "read" }),
    ]);
    db.setResponse(
      "user_todos",
      ok([{ ...todo("a"), priority: "obsolete" }, todo("b", { priority: "urgent" })]),
    );
    expect((await todosQueryOptions("member").queryFn()).map((t) => [t.id, t.priority])).toEqual([
      ["b", "urgent"],
      ["a", "medium"],
    ]);
    const rows = [
      todo("done", { done: true }),
      todo("no-date"),
      todo("later", { due_at: "2026-09-10" }),
      todo("earlier", { due_at: "2026-09-09" }),
      todo("new", { created_at: "2026-09-02" }),
      todo("urgent", { priority: "urgent" }),
    ];
    const original = [...rows];
    const ordered = ["urgent", "earlier", "later", "new", "no-date", "done"];
    expect(sortTodos(rows).map((t) => t.id)).toEqual(ordered);
    expect(rows).toEqual(original);
    expect(sortTodos([...rows].reverse()).map((t) => t.id)).toEqual(ordered);
  });
  it("never fetches private lists for a visitor and partitions each cache key", () => {
    auth.user = null;
    const { result } = renderHook(
      () => ({
        notes: useNotes(),
        todos: useTodos(),
        later: useReadLater(),
        saved: useSavedEntries(),
        calendar: useDockCalendar(2026, 8),
        count: useOpenTodoCount(),
      }),
      { wrapper },
    );
    expect(result.current.count).toBe(0);
    expect(result.current.calendar.entries).toEqual([]);
    expect(db.chains).toHaveLength(0);
    for (const key of Object.values(dockKeys)) {
      expect(key(undefined).at(-1)).toBe("anon");
      expect(key("member").at(-1)).toBe("member");
    }
  });
  it("combines dated open tasks and events, retaining data while changing month", async () => {
    db.setResponse(
      "events",
      ok([
        { id: "e", slug: "event", title_pl: null, title_en: "Event", starts_at: "2026-09-10" },
        {
          id: "f",
          slug: "second",
          title_pl: "Wydarzenie",
          title_en: null,
          starts_at: "2026-09-11",
        },
      ]),
    );
    db.setResponse(
      "user_todos",
      ok([
        todo("open", { due_at: "2026-09-10" }),
        todo("closed", { done: true, due_at: "2026-09-10" }),
        todo("undated"),
      ]),
    );
    const { result, rerender } = renderHook(
      ({ month }) => ({
        calendar: useDockCalendar(2026, month),
        count: useOpenTodoCount(),
        notes: useNotes(),
        saved: useSavedEntries(),
        later: useReadLater(),
      }),
      { wrapper, initialProps: { month: 8 } },
    );
    await waitFor(() => expect(result.current.calendar.entries).toHaveLength(3));
    expect(result.current.count).toBe(2);
    expect(result.current.calendar.entries.map((e) => e.id)).toEqual([
      "event:e",
      "event:f",
      "todo:open",
    ]);
    expect(calendarEntryTitle(result.current.calendar.entries[0], "pl")).toBe("Event");
    expect(calendarEntryTitle(result.current.calendar.entries[1], "en")).toBe("Wydarzenie");
    expect(
      calendarEntryTitle({ ...result.current.calendar.entries[0], titlePl: "", titleEn: "" }, "en"),
    ).toBe("event");
    const previous = result.current.calendar.entries;
    rerender({ month: 9 });
    expect(result.current.calendar.entries).toBe(previous);
    await waitFor(() => expect(result.current.calendar.isFetching).toBe(false));
    expect(db.lastChain("events")?.argsOf("gte")).toEqual([
      "starts_at",
      "2026-10-01T00:00:00.000Z",
    ]);
  });
  it("prefetches only the chosen panel and reuses fresh results on repeated intent", async () => {
    prefetchDockData(qc, "notes", undefined, [2026, 8]);
    prefetchDockData(qc, "chat", "member", [2026, 8]);
    expect(db.chains).toHaveLength(0);
    for (const tool of ["todos", "notes", "saved", "readLater", "calendar"] as const)
      prefetchDockData(qc, tool, "member", [2026, 8]);
    await waitFor(() => expect(qc.isFetching()).toBe(0));
    expect(db.chains).toHaveLength(6);
    for (const tool of ["todos", "notes", "saved", "readLater", "calendar"] as const)
      prefetchDockData(qc, tool, "member", [2026, 8]);
    await waitFor(() => expect(qc.isFetching()).toBe(0));
    expect(db.chains).toHaveLength(6);
  });
});

describe("dock mutations", () => {
  it("creates trimmed notes with optional and invalid entity links", async () => {
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(useCreateNote, { wrapper });
    await act(() => result.current.mutateAsync({ title: " Title ", body: " Body " }));
    expect(db.lastChain("user_notes")?.argsOf("insert")?.[0]).toEqual({
      user_id: "member",
      title: "Title",
      body: "Body",
      color: "amber",
      pinned: false,
      entity_type: null,
      entity_id: null,
      entity_title: null,
      entity_url: null,
    });
    await act(() =>
      result.current.mutateAsync({
        title: "x".repeat(250),
        body: "x".repeat(21000),
        color: "sky",
        pinned: true,
        entity,
      }),
    );
    expect(db.lastChain("user_notes")?.argsOf("insert")?.[0]).toEqual(
      expect.objectContaining({
        title: "x".repeat(200),
        body: "x".repeat(20000),
        entity_id: entity.entityId,
        entity_type: "post",
        entity_url: "/article",
        pinned: true,
      }),
    );
    await act(() =>
      result.current.mutateAsync({
        title: "T",
        body: "B",
        entity: { ...entity, entityId: "invalid", url: null },
      }),
    );
    expect(db.lastChain("user_notes")?.argsOf("insert")?.[0]).toEqual(
      expect.objectContaining({
        entity_id: null,
        entity_type: null,
        entity_title: "Article",
        entity_url: null,
      }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: dockKeys.notes("member") });
  });
  it("updates only provided fields and can unlink a note", async () => {
    const { result } = renderHook(useUpdateNote, { wrapper });
    await act(() => result.current.mutateAsync({ id: "n", patch: {} }));
    expect(db.chains).toHaveLength(0);
    await act(() =>
      result.current.mutateAsync({
        id: "n",
        patch: { title: " T ", body: " B ", color: "rose", pinned: false, entity },
      }),
    );
    expect(db.lastChain("user_notes")?.argsOf("update")?.[0]).toEqual({
      title: "T",
      body: "B",
      color: "rose",
      pinned: false,
      entity_type: "post",
      entity_id: entity.entityId,
      entity_title: "Article",
      entity_url: "/article",
    });
    expect(db.lastChain("user_notes")?.argsOf("eq")).toEqual(["id", "n"]);
    for (const value of [null, { ...entity, entityId: "invalid" }]) {
      await act(() => result.current.mutateAsync({ id: "n", patch: { entity: value } }));
      expect(db.lastChain("user_notes")?.argsOf("update")?.[0]).toEqual({
        entity_type: null,
        entity_id: null,
        entity_title: null,
        entity_url: null,
      });
    }
  });
  it("validates task titles and records both completion transitions", async () => {
    const { result } = renderHook(
      () => ({
        create: useCreateTodo(),
        toggle: useToggleTodo(),
        priority: useUpdateTodoPriority(),
      }),
      { wrapper },
    );
    await expect(result.current.create.mutateAsync({ title: "  " })).rejects.toThrow("Empty title");
    expect(db.chains).toHaveLength(0);
    await act(() => result.current.create.mutateAsync({ title: " Task " }));
    expect(db.lastChain("user_todos")?.argsOf("insert")?.[0]).toEqual({
      user_id: "member",
      title: "Task",
      priority: "medium",
      due_at: null,
    });
    await act(() =>
      result.current.create.mutateAsync({
        title: "x".repeat(600),
        priority: "high",
        dueAt: "2026-09-12",
      }),
    );
    expect(db.lastChain("user_todos")?.argsOf("insert")?.[0]).toEqual(
      expect.objectContaining({ title: "x".repeat(500), priority: "high", due_at: "2026-09-12" }),
    );
    for (const done of [true, false]) {
      await act(() => result.current.toggle.mutateAsync({ id: "t", done }));
      expect(db.lastChain("user_todos")?.argsOf("update")?.[0]).toEqual({
        done,
        done_at: done ? expect.any(String) : null,
      });
    }
    await act(() => result.current.priority.mutateAsync({ id: "t", priority: "urgent" }));
    expect(db.lastChain("user_todos")?.argsOf("update")?.[0]).toEqual({ priority: "urgent" });
  });
  it("accepts duplicate queue entries and sets or clears read time", async () => {
    const { result } = renderHook(
      () => ({ add: useAddReadLater(), state: useSetReadLaterState() }),
      { wrapper },
    );
    await act(() => result.current.add.mutateAsync({ entityType: "post", entityId: "p" }));
    expect(db.lastChain("user_read_later")?.argsOf("insert")?.[0]).toEqual({
      user_id: "member",
      entity_type: "post",
      entity_id: "p",
      title: null,
      url: null,
    });
    db.setResponse("user_read_later", fail("Duplicate key"));
    await expect(
      result.current.add.mutateAsync({
        entityType: "post",
        entityId: "p",
        title: "Post",
        url: "/post",
      }),
    ).resolves.toBeUndefined();
    db.setResponse("user_read_later", ok(null));
    for (const state of ["read", "unread", "archived"] as const) {
      await act(() => result.current.state.mutateAsync({ id: "r", state }));
      expect(db.lastChain("user_read_later")?.argsOf("update")?.[0]).toEqual({
        state,
        read_at: state === "read" ? expect.any(String) : null,
      });
    }
  });
  it("rejects creation after logout before touching the backend", async () => {
    auth.user = null;
    const { result } = renderHook(
      () => ({ note: useCreateNote(), todo: useCreateTodo(), later: useAddReadLater() }),
      { wrapper },
    );
    await expect(result.current.note.mutateAsync({ title: "t", body: "b" })).rejects.toThrow(
      "Not authenticated",
    );
    await expect(result.current.todo.mutateAsync({ title: "t" })).rejects.toThrow(
      "Not authenticated",
    );
    await expect(
      result.current.later.mutateAsync({ entityType: "post", entityId: "p" }),
    ).rejects.toThrow("Not authenticated");
    expect(db.chains).toHaveLength(0);
  });
  it("propagates every write failure without invalidating cached data", async () => {
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(
      () => ({
        nc: useCreateNote(),
        nu: useUpdateNote(),
        nd: useDeleteNote(),
        tc: useCreateTodo(),
        tt: useToggleTodo(),
        tp: useUpdateTodoPriority(),
        td: useDeleteTodo(),
        ra: useAddReadLater(),
        rs: useSetReadLaterState(),
        rd: useRemoveReadLater(),
      }),
      { wrapper },
    );
    for (const table of ["user_notes", "user_todos", "user_read_later"])
      db.setResponse(table, fail("denied"));
    const operations = [
      () => result.current.nc.mutateAsync({ title: "t", body: "b" }),
      () => result.current.nu.mutateAsync({ id: "n", patch: { title: "t" } }),
      () => result.current.nd.mutateAsync("n"),
      () => result.current.tc.mutateAsync({ title: "t" }),
      () => result.current.tt.mutateAsync({ id: "t", done: true }),
      () => result.current.tp.mutateAsync({ id: "t", priority: "high" }),
      () => result.current.td.mutateAsync("t"),
      () => result.current.ra.mutateAsync({ entityType: "post", entityId: "p" }),
      () => result.current.rs.mutateAsync({ id: "r", state: "read" }),
      () => result.current.rd.mutateAsync("r"),
    ];
    for (const operation of operations) await expect(operation()).rejects.toThrow("denied");
    expect(invalidate).not.toHaveBeenCalled();
  });
  it("deletes by ID and invalidates the matching list", async () => {
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(
      () => ({ note: useDeleteNote(), todo: useDeleteTodo(), later: useRemoveReadLater() }),
      { wrapper },
    );
    await act(() => result.current.note.mutateAsync("n"));
    await act(() => result.current.todo.mutateAsync("t"));
    await act(() => result.current.later.mutateAsync("r"));
    for (const [table, id, key] of [
      ["user_notes", "n", dockKeys.notes("member")],
      ["user_todos", "t", dockKeys.todos("member")],
      ["user_read_later", "r", dockKeys.readLater("member")],
    ] as const) {
      expect(db.lastChain(table)?.argsOf("eq")).toEqual(["id", id]);
      expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
    }
  });
});

describe("saved content", () => {
  it.each(["user_bookmarks", "event_bookmarks"])("propagates %s errors", async (table) => {
    db.setResponse(table, fail("unavailable"));
    await expect(savedQueryOptions("member").queryFn()).rejects.toThrow("unavailable");
  });
  it("handles absent lists without querying content tables", async () => {
    expect(await savedQueryOptions("member").queryFn()).toEqual([]);
    expect(db.chains.map((c) => c.table).sort()).toEqual(["event_bookmarks", "user_bookmarks"]);
  });
  it("resolves posts, pages and events, skipping deleted references", async () => {
    db.setResponse(
      "user_bookmarks",
      ok([
        { id: "bp", entity_type: "post", entity_id: "p", created_at: "2026-09-01" },
        { id: "bq", entity_type: "page", entity_id: "q", created_at: "2026-09-03" },
        { id: "bad", entity_type: "other", entity_id: "bad" },
        { id: "gone", entity_type: "post", entity_id: "gone" },
      ]),
    );
    db.setResponse(
      "event_bookmarks",
      ok([
        { id: "be", event_id: "e", created_at: "2026-09-02" },
        { id: "gone-event", event_id: "gone" },
      ]),
    );
    db.setResponse("posts", ok([{ id: "p", slug: "post", title_pl: "Wpis", title_en: null }]));
    db.setResponse("pages", ok([{ id: "q", slug: "page", title_pl: null, title_en: "Page" }]));
    db.setResponse("events", ok([{ id: "e", slug: "event", title_pl: null, title_en: null }]));
    const entries = await savedQueryOptions("member").queryFn();
    expect(entries.map((e) => [e.id, e.href])).toEqual([
      ["bq", "/page"],
      ["be", "/events/event"],
      ["bp", "/post"],
    ]);
    expect(entries.map((e) => savedEntryTitle(e, "pl"))).toEqual(["Page", "event", "Wpis"]);
    expect(entries.map((e) => savedEntryTitle(e, "en"))).toEqual(["Page", "event", "Wpis"]);
    for (const table of ["posts", "pages", "events"]) db.setResponse(table, ok(null));
    expect(await savedQueryOptions("member").queryFn()).toEqual([]);
  });
});
