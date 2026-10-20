import { describe, expect, it, vi } from "vitest";
import { uploadPdf } from "@/features/tools/inkgrid/upload";

/**
 * An upload for inkgrid's workbench (spec 21 §5.1): `POST /api/uploads` with the PDF as multipart,
 * its answer parsed; refusals named like any other call.
 */

const DOC = "d5152b39-8bbc-4141-ac06-9d5e70f98f99";
const JOB = "49932edf-fd77-44b0-8ac2-b69933f8d536";
const file = () => new File([new Uint8Array([37, 80, 68, 70, 45])], "fees.pdf", { type: "application/pdf" });

describe("uploadPdf", () => {
  it("posts the file as multipart and reads the document and job ids", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json(
        { document_id: DOC, job_id: JOB, deduplicated: false },
        { status: 201, headers: { "x-request-id": "rid" } },
      ),
    );
    const outcome = await uploadPdf(file(), { fetchImpl });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("/api/uploads");
    const body = fetchImpl.mock.calls[0]?.[1].body;
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("file")).toBeInstanceOf(File);
    expect(outcome).toEqual({
      ok: true,
      data: { document_id: DOC, job_id: JOB, deduplicated: false },
      status: 201,
      requestId: "rid",
    });
  });

  it("accepts a deduplicated upload with no job", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ document_id: DOC, job_id: null, deduplicated: true }, { headers: { "x-request-id": "r" } }),
    );
    expect(await uploadPdf(file(), { fetchImpl })).toMatchObject({ ok: true, data: { job_id: null } });
  });

  it("names a refusal (not a PDF) with its request id", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { error: "unsupported_media_type", detail: "not a PDF", requestId: "rid" },
        { status: 415 },
      ),
    );
    expect(await uploadPdf(file(), { fetchImpl })).toMatchObject({
      ok: false,
      kind: "refused",
      error: "unsupported_media_type",
      requestId: "rid",
    });
  });
});
