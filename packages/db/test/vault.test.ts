import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LocalKeyWrapper, OPAQUE_MASK, decryptCredential, maskForKind, storeCredential } from "../src";
import { appDb, makeUser, ownerPool, pgError } from "./helpers";

const db = appDb();
const opts = { wrapper: new LocalKeyWrapper(randomBytes(32)), fingerprintKey: "test-fp-key" };

describe("credential vault", () => {
  it("stores only ciphertext; masked value and fingerprint are derived; plaintext appears nowhere in the row", async () => {
    const u = await makeUser("pro");
    const secret = "AKIAIOSFODNN7EXAMPLE-s3cr3t-token";
    const s = await storeCredential({ userId: u, type: "API_KEY", value: secret }, { database: db }, opts);
    expect(s.maskedValue).not.toContain("s3cr3t");
    expect(s.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const { rows } = await ownerPool().query(`select * from credential_vault where id=$1`, [s.id]);
    const dump =
      JSON.stringify(rows[0]) +
      rows[0].ciphertext.toString("latin1") +
      rows[0].wrapped_dek.toString("latin1");
    expect(dump).not.toContain("s3cr3t");
    expect(dump).not.toContain(secret);
    expect(rows[0].masked_value).toBe(s.maskedValue);
  });

  it("our own secrets (admin_totp, admin_totp_pending) get a constant mask that reveals nothing", async () => {
    const u = await makeUser("pro");
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    for (const kind of ["admin_totp", "admin_totp_pending"]) {
      const s = await storeCredential({ userId: u, type: kind, value: secret }, { database: db }, opts);
      expect(s.maskedValue).toBe(OPAQUE_MASK);
      const { rows } = await ownerPool().query(`select * from credential_vault where id=$1`, [s.id]);
      expect(rows[0].kind).toBe(kind);
      expect(rows[0].masked_value).toBe(OPAQUE_MASK);
      const dump = JSON.stringify(rows[0]) + rows[0].ciphertext.toString("latin1");
      expect(dump).not.toContain(secret);
      expect(dump).not.toContain(secret.slice(0, 4));
      expect(await decryptCredential(s.id, { actor: u, reason: "test" }, { database: db }, opts)).toBe(
        secret,
      );
    }
    // entity kinds keep their usual mask
    expect(maskForKind("API_KEY", "abc")).toBe("len:3");
  });

  it("decrypts through the single audited function and writes an audit row each time", async () => {
    const u = await makeUser("pro");
    const s = await storeCredential(
      { userId: u, type: "API_KEY", value: "hunter2-hunter2" },
      { database: db },
      opts,
    );
    const before = await ownerPool().query(
      `select count(*)::int n from audit_log where action='credential.decrypt' and target=$1`,
      [s.id],
    );
    expect(before.rows[0].n).toBe(0);
    for (let i = 1; i <= 2; i++) {
      expect(
        await decryptCredential(
          s.id,
          { actor: "admin:" + u, reason: "owner unmask" },
          { database: db },
          opts,
        ),
      ).toBe("hunter2-hunter2");
      const n = await ownerPool().query(
        `select count(*)::int n from audit_log where action='credential.decrypt' and target=$1`,
        [s.id],
      );
      expect(n.rows[0].n).toBe(i);
    }
    await expect(
      decryptCredential(s.id, { actor: "", reason: "x" }, { database: db }, opts),
    ).rejects.toThrow();
  });

  it("a wrong key or tampered ciphertext fails (and the attempt is still audited)", async () => {
    const u = await makeUser("pro");
    const s = await storeCredential(
      { userId: u, type: "API_KEY", value: "topsecretvalue" },
      { database: db },
      opts,
    );
    const wrong = { ...opts, wrapper: new LocalKeyWrapper(randomBytes(32)) };
    await expect(
      decryptCredential(s.id, { actor: "x", reason: "attack" }, { database: db }, wrong),
    ).rejects.toThrow();
    const n = await ownerPool().query(
      `select count(*)::int n from audit_log where action='credential.decrypt' and target=$1`,
      [s.id],
    );
    expect(n.rows[0].n).toBe(1);
    await ownerPool().query(
      `update credential_vault set ciphertext = set_byte(ciphertext, 0, get_byte(ciphertext,0) # 1) where id=$1`,
      [s.id],
    );
    await expect(
      decryptCredential(s.id, { actor: "x", reason: "tamper" }, { database: db }, opts),
    ).rejects.toThrow();
  });

  it("the app role cannot read or write the vault directly", async () => {
    const u = await makeUser("pro");
    const s = await storeCredential(
      { userId: u, type: "API_KEY", value: "x-secret-value" },
      { database: db },
      opts,
    );
    const r = await pgError(
      db.withUser(u, (tx) =>
        tx.execute(`select ciphertext from credential_vault where id='${s.id}'` as never),
      ),
    );
    expect(r.code).toBe("42501");
  });
});
