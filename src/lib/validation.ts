import { z } from "zod/v4";

export const roleSchema = z.enum(["admin", "editor", "viewer"]);
export type Role = z.infer<typeof roleSchema>;

export const insertUserSchema = z.object({
  email: z.email(),
  name: z.string().optional(),
  role: roleSchema,
});
