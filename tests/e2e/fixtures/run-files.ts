import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * The files an e2e run needs and nobody commits (spec 21 §10.1): the stub's TLS certificate and key
 * (bastion only calls https services), and the run's throwaway secrets — an Ed25519 signing key and
 * an `IRON_SESSION_PASSWORD`. They live in `.e2e/` (git-ignored) and are made once, then reused
 * until the certificate is a day old, so the config evaluated by every Playwright worker sees the
 * same files.
 */

export type RunFiles = {
  certPath: string;
  keyPath: string;
  signingKeyPrivate: string;
  signingKeyPublic: string;
  ironSessionPassword: string;
};

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const secretsSchema = z.strictObject({
  signingKeyPrivate: z.string().min(1),
  signingKeyPublic: z.string().min(1),
  ironSessionPassword: z.string().min(32),
});
type Secrets = z.infer<typeof secretsSchema>;

function fresh(path: string): boolean {
  return existsSync(path) && Date.now() - statSync(path).mtimeMs < MAX_AGE_MS;
}

function makeCertificate(certPath: string, keyPath: string): void {
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-days",
        "2",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
        "-keyout",
        keyPath,
        "-out",
        certPath,
      ],
      { stdio: "pipe" },
    );
  } catch (err) {
    throw new Error(
      `e2e: could not make the stub's TLS certificate with openssl (${err instanceof Error ? err.message : String(err)}). Install openssl and run again.`,
    );
  }
}

function makeSecrets(): Secrets {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    signingKeyPrivate: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    signingKeyPublic: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    ironSessionPassword: randomBytes(32).toString("base64"),
  };
}

export function prepareRun(root: string): RunFiles {
  const dir = join(root, ".e2e");
  mkdirSync(dir, { recursive: true });
  const certPath = join(dir, "stub-cert.pem");
  const keyPath = join(dir, "stub-key.pem");
  const secretsPath = join(dir, "secrets.json");

  if (!fresh(certPath) || !existsSync(keyPath)) makeCertificate(certPath, keyPath);
  if (!existsSync(secretsPath)) {
    writeFileSync(secretsPath, `${JSON.stringify(makeSecrets())}\n`, { mode: 0o600 });
  }
  const parsed = secretsSchema.safeParse(JSON.parse(readFileSync(secretsPath, "utf8")));
  if (!parsed.success) {
    throw new Error("e2e: .e2e/secrets.json is malformed; delete the .e2e folder and run again");
  }
  return { certPath, keyPath, ...parsed.data };
}
