/**
 * Credential vault: envelope encryption for raw sensitive values.
 *  - each value gets a random 256-bit DEK and is encrypted with AES-256-GCM
 *  - the DEK is wrapped by a KeyWrapper: Cloud KMS in production (KMS_KEY_NAME), a local KEK in dev/test (VA_LOCAL_KEK)
 *  - credential_vault stores ciphertext + wrapped DEK + masked display value + HMAC fingerprint
 * Every other table stores only the masked value and the fingerprint. The ONLY decrypt path is
 * decryptCredential(), which writes an audit_log row before returning plaintext.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { fingerprint, maskEntityValue, type EntityType } from "@voidaccess/engine-client";
import { inSystem, type Ctx } from "./ctx";
import { auditLog, credentialVault } from "./schema";

export interface KeyWrapper {
  readonly keyRef: string;
  wrap(dek: Buffer): Promise<Buffer>;
  unwrap(wrapped: Buffer): Promise<Buffer>;
}

/** Dev/test KEK: AES-256-GCM, wrapped = iv(12) | tag(16) | ciphertext. Never use in production. */
export class LocalKeyWrapper implements KeyWrapper {
  readonly keyRef = "local:v1";
  constructor(private readonly kek: Buffer) {
    if (kek.length !== 32) throw new Error("VA_LOCAL_KEK must be 32 bytes (base64)");
  }
  async wrap(dek: Buffer) {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.kek, iv);
    const ct = Buffer.concat([c.update(dek), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]);
  }
  async unwrap(wrapped: Buffer) {
    const d = createDecipheriv("aes-256-gcm", this.kek, wrapped.subarray(0, 12));
    d.setAuthTag(wrapped.subarray(12, 28));
    return Buffer.concat([d.update(wrapped.subarray(28)), d.final()]);
  }
}

/** Cloud KMS via REST with Application Default Credentials (no heavy gRPC client). */
export class KmsKeyWrapper implements KeyWrapper {
  readonly keyRef: string;
  /** keyName: projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k> */
  constructor(private readonly keyName: string) {
    this.keyRef = `kms:${keyName}`;
  }
  private async call<T>(op: "encrypt" | "decrypt", data: Record<string, string>): Promise<T> {
    const { GoogleAuth } = await import("google-auth-library");
    const client = await new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    }).getClient();
    const res = await client.request<T>({
      url: `https://cloudkms.googleapis.com/v1/${this.keyName}:${op}`,
      method: "POST",
      data,
    });
    return res.data;
  }
  async wrap(dek: Buffer) {
    const r = await this.call<{ ciphertext: string }>("encrypt", { plaintext: dek.toString("base64") });
    return Buffer.from(r.ciphertext, "base64");
  }
  async unwrap(wrapped: Buffer) {
    const r = await this.call<{ plaintext: string }>("decrypt", { ciphertext: wrapped.toString("base64") });
    return Buffer.from(r.plaintext, "base64");
  }
}

export function keyWrapperFromEnv(env: NodeJS.ProcessEnv = process.env): KeyWrapper {
  if (env.KMS_KEY_NAME) return new KmsKeyWrapper(env.KMS_KEY_NAME);
  if (env.VA_LOCAL_KEK) return new LocalKeyWrapper(Buffer.from(env.VA_LOCAL_KEK, "base64"));
  throw new Error("No key wrapper configured: set KMS_KEY_NAME (production) or VA_LOCAL_KEK (dev/test)");
}

export interface VaultOptions {
  wrapper?: KeyWrapper;
  /** HMAC key for fingerprints (VA_FINGERPRINT_KEY) */
  fingerprintKey?: string;
}
const fpKey = (o: VaultOptions) => {
  const k = o.fingerprintKey ?? process.env.VA_FINGERPRINT_KEY;
  if (!k) throw new Error("VA_FINGERPRINT_KEY is not set");
  return k;
};

export interface StoredCredential {
  id: string;
  maskedValue: string;
  fingerprint: string;
}

/** Encrypt and store a raw sensitive value. Callers persist only the returned masked value + fingerprint elsewhere. */
export async function storeCredential(
  input: { userId: string; investigationId?: string; type: EntityType | string; value: string },
  ctx: Ctx = {},
  opts: VaultOptions = {},
): Promise<StoredCredential> {
  const wrapper = opts.wrapper ?? keyWrapperFromEnv();
  const dek = randomBytes(32);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", dek, iv);
  const ciphertext = Buffer.concat([c.update(input.value, "utf8"), c.final()]);
  const authTag = c.getAuthTag();
  const wrappedDek = await wrapper.wrap(dek);
  dek.fill(0);
  const maskedValue = maskEntityValue(input.type as EntityType, input.value);
  const fp = fingerprint(fpKey(opts), input.type, input.value);
  return inSystem(ctx, "vault.store", async (tx) => {
    const [row] = await tx
      .insert(credentialVault)
      .values({
        userId: input.userId,
        investigationId: input.investigationId,
        kind: String(input.type),
        ciphertext,
        iv,
        authTag,
        wrappedDek,
        keyRef: wrapper.keyRef,
        maskedValue,
        fingerprint: fp,
      })
      .returning({ id: credentialVault.id });
    return { id: row!.id, maskedValue, fingerprint: fp };
  });
}

/**
 * The ONLY function that returns a raw credential. Writes an audit_log row (actor, vault id, reason)
 * before decrypting, so a failed or aborted decrypt is still recorded.
 */
export async function decryptCredential(
  vaultId: string,
  access: { actor: string; reason: string },
  ctx: Ctx = {},
  opts: VaultOptions = {},
): Promise<string> {
  if (!access.actor || !access.reason) throw new Error("decryptCredential requires actor and reason");
  const wrapper = opts.wrapper ?? keyWrapperFromEnv();
  const row = await inSystem(ctx, "vault.decrypt", async (tx) => {
    await tx.insert(auditLog).values({
      actor: access.actor,
      action: "credential.decrypt",
      target: vaultId,
      meta: { reason: access.reason },
    });
    const [r] = await tx.select().from(credentialVault).where(eq(credentialVault.id, vaultId));
    return r;
  });
  if (!row) throw new Error("credential not found");
  const dek = await wrapper.unwrap(row.wrappedDek);
  const d = createDecipheriv("aes-256-gcm", dek, row.iv);
  d.setAuthTag(row.authTag);
  const out = Buffer.concat([d.update(row.ciphertext), d.final()]).toString("utf8");
  dek.fill(0);
  return out;
}
