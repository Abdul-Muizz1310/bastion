import { sql } from "drizzle-orm";
import {
  bigserial,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/*
 * v1 user, session and magic-link tables stay in the database (and therefore here) until a later,
 * destructive migration drops them: migration 0002 is additive only, so that the v1 deployment
 * keeps working against the migrated database. No code reads or writes `sessions` or
 * `magic_links` any more; `users` is read-only history that old events and dossiers reference.
 */

export const EVIDENCE_KINDS = ["web", "passage", "table"] as const;
export const DOSSIER_STAGES = [
  "wake",
  "gather",
  "read",
  "seal",
  "debate",
  "measure",
  "envelope",
  "record",
] as const;
export const STEP_STATUSES = ["pending", "running", "waiting", "ok", "error", "skipped"] as const;
export const DOCUMENT_KINDS = ["sample", "upload"] as const;
export const RECEIPT_KINDS = ["certificate", "transcript", "perf", "envelope", "audit"] as const;

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: text("role", { enum: ["admin", "editor", "viewer"] }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(/* v8 ignore next */ () => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
});

export const magicLinks = pgTable("magic_links", {
  token: text("token").primaryKey(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** v1 history only: the signed-in user. New rows write `actor` instead. */
    actorId: uuid("actor_id").references(/* v8 ignore next */ () => users.id),
    /** A visitor id (`v_…`) or `bastion`; null only on v1 rows. */
    actor: text("actor"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    service: text("service"),
    requestId: text("request_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  /* v8 ignore start */
  (t) => [
    index("events_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    index("events_time_idx").on(t.createdAt),
    index("events_service_idx").on(t.service, t.createdAt),
    index("events_request_idx").on(t.requestId),
  ],
  /* v8 ignore stop */
);

export const dossiers = pgTable(
  "dossiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** v1 history only: v2 dossiers belong to a visitor, not a user. */
    userId: uuid("user_id").references(/* v8 ignore next */ () => users.id),
    visitor: text("visitor"),
    claim: text("claim").notNull(),
    sources: text("sources").array().notNull(),
    mode: text("mode", { enum: ["rapid", "standard", "adversarial"] }).notNull(),
    status: text("status", {
      enum: ["pending", "running", "succeeded", "failed"],
    }).notNull(),
    verdict: text("verdict", { enum: ["TRUE", "FALSE", "INCONCLUSIVE"] }),
    confidence: numeric("confidence", { precision: 3, scale: 2 }),
    requestId: text("request_id").notNull(),
    envelopeId: uuid("envelope_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  /* v8 ignore start */
  (t) => [
    index("dossiers_user_idx").on(t.userId, t.createdAt),
    index("dossiers_status_idx").on(t.status, t.createdAt),
  ],
  /* v8 ignore stop */
);

export const evidenceItems = pgTable(
  "evidence_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dossierId: uuid("dossier_id")
      .notNull()
      .references(/* v8 ignore next */ () => dossiers.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    stableId: text("stable_id").notNull(),
    url: text("url").notNull().default(""),
    title: text("title").notNull().default(""),
    certificateId: uuid("certificate_id"),
    contentHash: text("content_hash").notNull(),
    /** Null on v1 rows (which were all web evidence). */
    kind: text("kind", { enum: EVIDENCE_KINDS }),
    product: text("product"),
    /** `{ url }` for web evidence; `{ documentId, page, bbox, nodeId }` for a document. */
    locator: jsonb("locator"),
    excerpt: text("excerpt"),
    inkprintHash: text("inkprint_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  /* v8 ignore start */
  (t) => [
    index("evidence_dossier_idx").on(t.dossierId, t.createdAt),
    unique("evidence_dossier_stable_unique").on(t.dossierId, t.stableId),
  ],
  /* v8 ignore stop */
);

export const dossierEvents = pgTable(
  "dossier_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    dossierId: uuid("dossier_id")
      .notNull()
      .references(/* v8 ignore next */ () => dossiers.id, { onDelete: "cascade" }),
    step: text("step", {
      enum: ["gather", "seal", "adjudicate", "measure", "envelope", "record"],
    }).notNull(),
    status: text("status", { enum: ["started", "ok", "error"] }).notNull(),
    latencyMs: integer("latency_ms"),
    metadata: jsonb("metadata").notNull().default({}),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  /* v8 ignore start */
  (t) => [index("dossier_events_dossier_idx").on(t.dossierId, t.at)],
  /* v8 ignore stop */
);

/** The durable runner's state machine (spec 21 §6.2): one row per dossier stage. */
export const dossierSteps = pgTable(
  "dossier_steps",
  {
    dossierId: uuid("dossier_id")
      .notNull()
      .references(/* v8 ignore next */ () => dossiers.id, { onDelete: "cascade" }),
    stage: text("stage", { enum: DOSSIER_STAGES }).notNull(),
    status: text("status", { enum: STEP_STATUSES }).notNull(),
    attempt: integer("attempt").notNull().default(0),
    leaseUntil: timestamp("lease_until", { withTimezone: true }).notNull().default(sql`'epoch'`),
    notBefore: timestamp("not_before", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    output: jsonb("output").notNull().default({}),
    error: text("error"),
  },
  /* v8 ignore start */
  (t) => [primaryKey({ columns: [t.dossierId, t.stage] })],
  /* v8 ignore stop */
);

/** inkthread documents a dossier reads (spec 21 §6.3). */
export const dossierDocuments = pgTable(
  "dossier_documents",
  {
    dossierId: uuid("dossier_id")
      .notNull()
      .references(/* v8 ignore next */ () => dossiers.id, { onDelete: "cascade" }),
    documentId: text("document_id").notNull(),
    sha256: text("sha256"),
    title: text("title"),
    kind: text("kind", { enum: DOCUMENT_KINDS }).notNull(),
    graphHash: text("graph_hash"),
    pageCount: integer("page_count"),
    jobId: text("job_id"),
  },
  /* v8 ignore start */
  (t) => [primaryKey({ columns: [t.dossierId, t.documentId] })],
  /* v8 ignore stop */
);

/** Every receipt a dossier collects; the receipts bundle is a SELECT of these (spec 21 §6.3). */
export const receipts = pgTable("receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  dossierId: uuid("dossier_id")
    .notNull()
    .references(/* v8 ignore next */ () => dossiers.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: RECEIPT_KINDS }).notNull(),
  ref: text("ref"),
  hash: text("hash"),
  signature: text("signature"),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type Dossier = typeof dossiers.$inferSelect;
export type NewDossier = typeof dossiers.$inferInsert;
export type EvidenceItem = typeof evidenceItems.$inferSelect;
export type NewEvidenceItem = typeof evidenceItems.$inferInsert;
export type DossierEvent = typeof dossierEvents.$inferSelect;
export type NewDossierEvent = typeof dossierEvents.$inferInsert;
export type DossierStep = typeof dossierSteps.$inferSelect;
export type NewDossierStep = typeof dossierSteps.$inferInsert;
export type DossierDocument = typeof dossierDocuments.$inferSelect;
export type NewDossierDocument = typeof dossierDocuments.$inferInsert;
export type Receipt = typeof receipts.$inferSelect;
export type NewReceipt = typeof receipts.$inferInsert;
