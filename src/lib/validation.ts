import { z } from "zod/v4";

export const roleSchema = z.enum(["admin", "editor", "viewer"]);
export type Role = z.infer<typeof roleSchema>;

export const insertUserSchema = z.object({
  email: z.email(),
  name: z.string().optional(),
  role: roleSchema,
});

export const eventInputSchema = z.object({
  actorId: z.string().uuid().optional(),
  action: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  service: z.string().optional(),
  requestId: z.string().optional(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type EventInput = z.infer<typeof eventInputSchema>;
