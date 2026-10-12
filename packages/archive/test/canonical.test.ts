import { describe, expect, it } from "vitest";
import { canonicalUrl, canonicalize, foldName, hostOf, refang } from "../src";
import { scanForSecrets } from "../src";
import { tierOf } from "../src";
import { feedMatchFor } from "../src";

const c = (type: string, v: string) => canonicalize(type, v);

describe("canonicalisation (per entity type)", () => {
  it.each([
    ["DOMAIN", "WWW.Example.COM", "example.com"],
    ["DOMAIN", "evil[.]example[.]org.", "evil.example.org"],
    ["DOMAIN", "mail(.)corp-test.net", "mail.corp-test.net"],
    ["ENS_DOMAIN", "Vitalik.ETH", "vitalik.eth"],
    ["URL", "hxxps://www.Example.com/Path/?utm_source=x&id=7#frag", "example.com/Path?id=7"],
    ["URL", "http://example.com:80/a/", "example.com/a"],
    ["URL", "https://example.com:8443/a", "example.com:8443/a"],
    [
      "ONION_URL",
      "HTTP://ABCDEF234567ABCDEF234567ABCDEF234567ABCDEF234567ABCDEFGH.onion/Page",
      "abcdef234567abcdef234567abcdef234567abcdef234567abcdefgh.onion/Page",
    ],
    [
      "ONION_URL",
      "abcdef234567abcdef234567abcdef234567abcdef234567abcdefgh[.]onion",
      "abcdef234567abcdef234567abcdef234567abcdef234567abcdefgh.onion",
    ],
    ["IP_ADDRESS", "198.51.100[.]7", "198.51.100.7"],
    [
      "FILE_HASH_SHA256",
      "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789",
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    ],
    ["FILE_HASH_MD5", "D41D8CD98F00B204E9800998ECF8427E", "d41d8cd98f00b204e9800998ecf8427e"],
    ["CVE_NUMBER", "cve 2023 34362", "CVE-2023-34362"],
    ["CVE_NUMBER", "CVE‑2021‑44228", "CVE-2021-44228"],
    ["MITRE_TECHNIQUE", "t1059.001", "T1059.001"],
    ["MITRE_TACTIC", "ta0001", "TA0001"],
    ["EXPLOIT_DB_ID", "EDB-ID: 50592", "50592"],
    [
      "ETHEREUM_ADDRESS",
      "0xABCDEF0123456789ABCDEF0123456789ABCDEF01",
      "0xabcdef0123456789abcdef0123456789abcdef01",
    ],
    [
      "BITCOIN_ADDRESS",
      "BC1QXY2KGDYGJRSQTZQ2N0YRF2493P83KKFJHX0WLH",
      "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
    ],
    ["BITCOIN_ADDRESS", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"], // base58: case is part of the checksum
    ["BITCOIN_CASH_ADDRESS", "BitcoinCash:QQ1Example", "bitcoincash:qq1example"],
    ["TELEGRAM_HANDLE", "@Some_Actor", "some_actor"],
    ["DISCORD_HANDLE", "@@Dark_Wolf", "dark_wolf"],
    ["ORGANIZATION_NAME", "Northwind Traders, Inc.", "northwindtraders"],
    ["ORGANIZATION_NAME", "northwind-traders inc", "northwindtraders"],
    ["ORGANIZATION_NAME", "Contoso Ltd.", "contoso"],
    ["ORGANIZATION_NAME", "Fabrikam Holdings GmbH", "fabrikamholdings"],
    ["MALWARE_FAMILY", "Cobalt Strike", "cobaltstrike"],
    ["MALWARE_FAMILY", "cobalt-strike", "cobaltstrike"],
  ])("%s %j -> %j", (type, input, expected) => {
    expect(c(type, input)?.canonical).toBe(expected);
  });

  it("returns null for empty or unusable values", () => {
    expect(c("DOMAIN", "  ")).toBeNull();
    expect(c("EXPLOIT_DB_ID", "none")).toBeNull();
  });

  it("merges aliases of a known group into one entity: ALPHV and BlackCat are the same thing", () => {
    const a = c("RANSOMWARE_GROUP", "ALPHV")!;
    for (const name of ["BlackCat", "black-cat", "ALPHV BlackCat", "Noberus", "alphv"]) {
      const x = c("RANSOMWARE_GROUP", name)!;
      expect(x.canonical, name).toBe(a.canonical);
      expect(x.display).toBe("ALPHV");
    }
    // typed differently in another run, still the same group entity
    const asMalware = c("MALWARE_FAMILY", "BlackCat")!;
    expect(asMalware).toMatchObject({ type: "RANSOMWARE_GROUP", canonical: a.canonical });
    expect(c("RANSOMWARE_GROUP", "Clop")!.canonical).toBe(c("RANSOMWARE_GROUP", "CL0P")!.canonical);
    expect(c("THREAT_ACTOR", "Fancy Bear")!.canonical).toBe(c("THREAT_ACTOR_HANDLE", "APT28")!.canonical);
  });

  it("does not merge unrelated names, and organisations never go through the alias table", () => {
    expect(c("RANSOMWARE_GROUP", "Akira")!.canonical).not.toBe(c("RANSOMWARE_GROUP", "Play")!.canonical);
    expect(c("ORGANIZATION_NAME", "BlackCat")).toMatchObject({
      type: "ORGANIZATION_NAME",
      canonical: "blackcat",
    });
  });

  it("refang, fold and host helpers", () => {
    expect(refang("hxxp://a[.]b[:]8080")).toBe("http://a.b:8080");
    expect(foldName("Čafé Ünïcode-Name_1")).toBe("cafeunicodename1");
    expect(hostOf("blog.example.co.uk")).toBe("example.co.uk");
    expect(hostOf("a.b.example.com")).toBe("example.com");
    expect(hostOf("abc.onion")).toBe("abc.onion");
    expect(canonicalUrl("")).toBeNull();
    expect(canonicalUrl("urn:tor_search:rss")?.key).toBe("urn:tor_search:rss");
  });
});

describe("content scan (defence in depth)", () => {
  it.each([
    ["AKIAIOSFODNN7EXAMPLE leaked", "aws_access_key"],
    ["token ghp_abcdefghijklmnopqrstuvwxyz0123456789AB", "github_token"],
    ["Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345", "bearer_token"],
    ["password: hunter2hunter2", "secret_assignment"],
    ["-----BEGIN RSA PRIVATE KEY-----", "private_key_block"],
    ["write to alice@example.org for the key", "email_address"],
    ["call +1 555 010 9999 now", "phone_number"],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdEFGH", "jwt"],
  ])("flags %j as %s", (text, name) => {
    expect(scanForSecrets(text)).toContain(name);
  });
  it("leaves ordinary threat-intel text and redaction placeholders alone, and never returns the matched text", () => {
    expect(
      scanForSecrets(
        "The group posted a leak on its blog; masked contact j***@example.org and [REDACTED]. CVE-2023-34362. sha256 d41d8cd98f00b204e9800998ecf8427e",
      ),
    ).toEqual([]);
    expect(JSON.stringify(scanForSecrets("AKIAIOSFODNN7EXAMPLE"))).not.toContain("AKIA");
  });
});

describe("tiers", () => {
  it("one source or many pages from one host stay unconfirmed; two hosts corroborate; a feed match validates", () => {
    expect(tierOf(1, null)).toBe("unconfirmed");
    expect(tierOf(2, null)).toBe("corroborated");
    expect(tierOf(1, "cisa_kev")).toBe("feed_validated");
    expect(feedMatchFor("CVE_NUMBER", "CVE-2023-34362")).toBe("cisa_kev");
    expect(feedMatchFor("CVE_NUMBER", "CVE-2099-0001")).toBeNull();
    expect(feedMatchFor("DOMAIN", "example.com")).toBeNull();
  });
});
