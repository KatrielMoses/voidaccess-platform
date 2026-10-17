import { describe, expect, it } from "vitest";
import { ENTITY_TYPES } from "@voidaccess/engine-client";
import { GROUPS, groupOf } from "./categories";
import { buildIndex, highlightRuns, middleTruncate, normalize, search, searchIndex } from "./search";
import { initialSidebar, sidebarReducer, type SidebarEvent, type SidebarState } from "./sidebar-state";

describe("categories", () => {
  it("maps every EntityType to exactly one known group", () => {
    const ids = new Set(GROUPS.map((g) => g.id));
    for (const t of ENTITY_TYPES) expect(ids.has(groupOf(t)), t).toBe(true);
  });

  it("follows the brief's grouping", () => {
    const cases: [string, string][] = [
      ["ONION_URL", "onion"],
      ["PASTE_URL", "web"],
      ["IPFS_CID", "web"],
      ["MAC_ADDRESS", "ip"],
      ["EXPLOIT_DB_ID", "cve"],
      ["RANSOMWARE_GROUP", "actors"],
      ["FILE_HASH_MD5", "malware"],
      ["NUCLEI_TEMPLATE", "malware"],
      ["MONERO_ADDRESS", "crypto"],
      ["CRYPTO_SEED_PHRASE", "crypto"],
      ["STRIPE_KEY", "credentials"],
      ["TELEGRAM_HANDLE", "contacts"],
      ["PGP_KEY_BLOCK", "contacts"],
      ["ORGANIZATION_NAME", "orgs"],
      ["MITRE_TACTIC", "attack"],
      ["LOCATION", "other"],
      ["SOMETHING_NEW", "other"],
    ];
    for (const [t, g] of cases) expect(groupOf(t), t).toBe(g);
  });
});

describe("search", () => {
  const items = [
    { id: "a", type: "ONION_URL", display: "lockbit3ab…zwrad[.]onion", tags: ["method:regex"] },
    { id: "b", type: "EMAIL_ADDRESS", display: "j***@acme[.]com" },
    { id: "c", type: "RANSOMWARE_GROUP", display: "LockBit" },
    { id: "d", type: "DOMAIN", display: "hxxp://evil[.]example[.]net" },
  ];

  it("matches substrings of what is displayed, case-insensitively", () => {
    expect([...search(items, "LOCKBIT").keys()]).toEqual(["a", "c"]);
    expect([...search(items, "acme").keys()]).toEqual(["b"]);
  });

  it("matches defanged forms both ways and highlights the original characters", () => {
    expect([...search(items, "zwrad.onion").keys()]).toEqual(["a"]);
    expect([...search(items, "zwrad[.]onion").keys()]).toEqual(["a"]);
    expect([...search(items, "http://evil.example").keys()]).toEqual(["d"]);
    const m = search(items, "zwrad.onion").get("a")!;
    const d = items[0]!.display;
    expect(d.slice(m.ranges[0]![0], m.ranges[0]![1])).toBe("zwrad[.]onion");
  });

  it("matches the type label and tags, with no display highlight", () => {
    expect(search(items, "ransomware").get("c")).toEqual({ id: "c", ranges: [] });
    expect([...search(items, "method:regex").keys()]).toEqual(["a"]);
  });

  it("only sees masked values: the masked-away part of an email never matches", () => {
    // the raw address was john@acme.com; the payload only ever carries the masked display
    expect(search(items, "john").size).toBe(0);
    expect(search(items, "j***").size).toBe(1);
  });

  it("an empty query matches nothing; the index is reusable", () => {
    const idx = buildIndex(items);
    expect(searchIndex(idx, "  ").size).toBe(0);
    expect(searchIndex(idx, "lock").size).toBe(2);
    expect(searchIndex(idx, "net").size).toBe(1);
  });

  it("highlight runs cover the string exactly; middle truncation keeps both ends", () => {
    const runs = highlightRuns("abcdef", [[1, 3]]);
    expect(runs).toEqual([
      { text: "a", hit: false },
      { text: "bc", hit: true },
      { text: "def", hit: false },
    ]);
    const long = "lockbit3abcdefghijklmnopqrstuvwxyzzwrad[.]onion";
    const t = middleTruncate(long, 24);
    expect(t).toHaveLength(24);
    expect(t.startsWith("lockbit3")).toBe(true);
    expect(t.endsWith("[.]onion")).toBe(true);
    expect(normalize("A[.]B(dot)C")).toBe("a.b.c");
  });
});

describe("sidebar auto-collapse", () => {
  const run = (s: SidebarState, ...es: SidebarEvent["t"][]) =>
    es.reduce((acc, t) => sidebarReducer(acc, { t } as SidebarEvent), s);

  it("collapses to the rail when the graph is worked, and expands on rest, focus, / and search select", () => {
    const s0 = initialSidebar(false);
    expect(run(s0, "graphInteract").mode).toBe("rail");
    for (const t of ["railHoverRest", "railFocus", "slash", "searchSelect"] as const)
      expect(run(s0, "graphInteract", t).mode, t).toBe("expanded");
  });

  it("a hover peek closes again on leave; a focus or / expansion does not", () => {
    const s0 = initialSidebar(false);
    expect(run(s0, "graphInteract", "railHoverRest", "pointerLeave").mode).toBe("rail");
    expect(run(s0, "graphInteract", "slash", "pointerLeave").mode).toBe("expanded");
  });

  it("pinned stays open whatever happens in the graph", () => {
    const s0 = initialSidebar(true);
    expect(run(s0, "graphInteract", "graphInteract", "pointerLeave").mode).toBe("expanded");
    const pinnedFromRail = run(initialSidebar(false), "graphInteract", "togglePin");
    expect(pinnedFromRail).toMatchObject({ mode: "expanded", pinned: true });
    expect(run(pinnedFromRail, "togglePin", "graphInteract").mode).toBe("rail");
  });

  it("reduced motion changes state instantly (animate false) but still changes it", () => {
    const s0 = initialSidebar(false, true);
    const s1 = run(s0, "graphInteract");
    expect(s1).toMatchObject({ mode: "rail", animate: false });
    const s2 = sidebarReducer(s1, { t: "reducedMotion", on: false });
    expect(s2.animate).toBe(true);
  });

  it("the header toggle collapses (and unpins) or expands", () => {
    const s0 = initialSidebar(true);
    expect(run(s0, "toggle")).toMatchObject({ mode: "rail", pinned: false });
    expect(run(s0, "toggle", "toggle").mode).toBe("expanded");
  });
});
