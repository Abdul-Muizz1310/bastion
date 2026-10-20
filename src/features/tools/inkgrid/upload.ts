import * as z from "zod/mini";
import { type CallOptions, postForm } from "../client";
import type { ToolOutcome } from "../outcome";

/**
 * A visitor's PDF for inkgrid's workbench (spec 21 §5.1): `POST /api/uploads` (≤ 4 MB, budget
 * `upload`), answered with the document and, unless inkthread already knew the file, its job.
 * inkthread processes the bytes and never keeps them (DR-0029).
 */

const uuid = z.string().check(z.regex(/^[0-9a-f-]{36}$/));

export const uploadAnswer = z.object({
  document_id: uuid,
  job_id: z.nullable(uuid),
  deduplicated: z.boolean(),
});

export type UploadAnswer = z.infer<typeof uploadAnswer>;

export function uploadPdf(
  file: File,
  options: CallOptions = {},
): Promise<ToolOutcome<UploadAnswer>> {
  const form = new FormData();
  form.set("file", file, file.name);
  return postForm("/api/uploads", form, uploadAnswer, options);
}
