import crypto from "node:crypto";
import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { getDossier, listEvidenceItems } from "@/features/dossier/server/query";
import { appendEvent } from "@/lib/audit/write";
import { COOKIE_NAME, getSession } from "@/lib/auth/session";
import { callService } from "@/lib/gateway/client";

type VerifyCheck = {
  signature: boolean;
  hash: boolean;
  simhash?: boolean;
  embedding?: boolean;
};

type VerifyResult = {
  certificate_id: string;
  valid: boolean;
  checks: VerifyCheck;
  reason?: string;
};

type InkprintVerifyBatchResponse = {
  results: VerifyResult[];
};

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const cookieStore = await cookies();
  const session = await getSession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dossier = await getDossier(id);
  if (!dossier) {
    return NextResponse.json({ error: "Dossier not found" }, { status: 404 });
  }

  if (session.user.role === "viewer" && dossier.userId !== session.user.id) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const items = await listEvidenceItems(id);
  const certIds = items.map((i) => i.certificateId).filter((c): c is string => Boolean(c));

  const requestId = crypto.randomUUID();

  if (certIds.length === 0) {
    await appendEvent({
      actorId: session.user.id,
      action: "dossier.verified.ok",
      entityType: "dossier",
      entityId: id,
      service: "bastion",
      requestId,
      metadata: { total: 0, passed: 0, failed: 0 },
    });
    return NextResponse.json({
      dossier_id: id,
      overall_valid: null,
      message: "no_evidence_yet",
      results: [],
      verified_at: new Date().toISOString(),
    });
  }

  const response = await callService<InkprintVerifyBatchResponse>("inkprint", "/verify/batch", {
    method: "POST",
    body: { items: certIds.map((cid) => ({ certificate_id: cid })) },
    actor: { id: session.user.id, role: session.user.role },
    requestId,
  });

  if (!response.ok) {
    await appendEvent({
      actorId: session.user.id,
      action: "dossier.verified.error",
      entityType: "dossier",
      entityId: id,
      service: "inkprint",
      requestId,
      metadata: { reason: response.error, status: response.status },
    });
    return NextResponse.json(
      { error: "Verification failed", reason: response.error },
      { status: 502 },
    );
  }

  const results = response.data.results;
  const passed = results.filter((r) => r.valid).length;
  const failed = results.length - passed;
  const overallValid = failed === 0;

  await appendEvent({
    actorId: session.user.id,
    action: overallValid ? "dossier.verified.ok" : "dossier.verified.error",
    entityType: "dossier",
    entityId: id,
    service: "inkprint",
    requestId,
    metadata: { total: results.length, passed, failed },
  });

  return NextResponse.json({
    dossier_id: id,
    overall_valid: overallValid,
    results,
    verified_at: new Date().toISOString(),
  });
}
