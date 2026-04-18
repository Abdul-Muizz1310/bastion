import {
  bigserial,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

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
    actorId: uuid("actor_id").references(/* v8 ignore next */ () => users.id),
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
    userId: uuid("user_id")
      .notNull()
      .references(/* v8 ignore next */ () => users.id),
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
    url: text("url").notNull(),
    title: text("title").notNull(),
    certificateId: uuid("certificate_id"),
    contentHash: text("content_hash").notNull(),
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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type Dossier = typeof dossiers.$inferSelect;
export type NewDossier = typeof dossiers.$inferInsert;
export type EvidenceItem = typeof evidenceItems.$inferSelect;
export type NewEvidenceItem = typeof evidenceItems.$inferInsert;
export type DossierEvent = typeof dossierEvents.$inferSelect;
export type NewDossierEvent = typeof dossierEvents.$inferInsert;
