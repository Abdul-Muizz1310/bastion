import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { PageFrame } from "@/components/terminal/PageFrame";
import { Panel } from "@/components/tools/Panel";
import { WakeGate } from "@/components/tools/WakeGate";
import { DocumentPages } from "@/features/dossier/components/DocumentPages";
import { confidenceOf, DossierHeader } from "@/features/dossier/components/DossierHeader";
import { DossierLive } from "@/features/dossier/components/DossierLive";
import { EvidenceTable } from "@/features/dossier/components/EvidenceTable";
import { PerfReceipt } from "@/features/dossier/components/PerfReceipt";
import { AuditReceipt, EnvelopeReceipt } from "@/features/dossier/components/SealReceipts";
import { StageTimeline } from "@/features/dossier/components/StageTimeline";
import { TranscriptView } from "@/features/dossier/components/TranscriptView";
import { VerifyPanel } from "@/features/dossier/components/VerifyPanel";
import { VerifyProvider } from "@/features/dossier/components/verify-context";
import { type DossierPageData, loadDossierPage } from "@/features/dossier/load";
import { type DossierReceiptView, receiptView } from "@/features/dossier/receipt-view";
import { onePerStage, stepView } from "@/features/dossier/step-view";

/**
 * `/d/[id]` (spec 21 §3, §6.5, §6.6): a dossier at its own public URL. Rendered per request. A
 * succeeded dossier is its permanent receipt, drawn here on the server so it can be read and
 * crawled without script; a pending or running one is the live island, which renders the page
 * again once the run ends; a failed one shows its timeline with "retry from this stage" and every
 * receipt it already holds. An unknown or malformed id is a 404.
 */

type Params = Promise<{ id: string }>;

/** Titled from the id alone: the title never reads the database. */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  return { title: `dossier ${id.slice(0, 8)}`, alternates: { canonical: `/d/${id}` } };
}

export default async function DossierPage({ params }: { params: Params }) {
  const { id } = await params;
  await connection();
  const data = await loadDossierPage(id);
  if (data === null) notFound();

  const { dossier } = data;
  const view = receiptView(data);
  const unfinished = dossier.status === "pending" || dossier.status === "running";

  return (
    <PageFrame
      active="dossier"
      statusLeft={`dossier · ${dossier.id.slice(0, 8)}`}
      statusRight="public · verifiable"
    >
      <div className="space-y-12">
        <DossierHeader dossier={dossier} view={view} />
        {unfinished ? (
          <>
            <RunPanel data={data} />
            <p className="max-w-3xl font-mono text-xs leading-relaxed text-fg-muted">
              the receipt appears here once the run finishes: the evidence and its certificates, the
              signed debate, the documents drawn on their pages, the queries every service ran, and
              the envelope that seals them — each one re-checkable by anyone.
            </p>
          </>
        ) : (
          <VerifyProvider dossierId={dossier.id}>
            {dossier.status === "failed" ? <RunPanel data={data} /> : null}
            <ReceiptSections data={data} view={view} />
            {dossier.status === "succeeded" ? (
              <Section name="run">
                <Panel
                  id="run"
                  title="the run"
                  hint="the eight stages, as the runner recorded them"
                >
                  <StageTimeline steps={data.steps.map(stepView)} labelledBy="run-title" />
                </Panel>
              </Section>
            ) : null}
            <Section name="verify">
              <Panel id="verify" title="verify everything" hint="live, against each issuer">
                <VerifyPanel
                  dossierId={dossier.id}
                  evidenceKeys={Object.fromEntries(view.certificateKeys)}
                  documentIds={view.documents.map((d) => d.documentId)}
                />
              </Panel>
            </Section>
          </VerifyProvider>
        )}
      </div>
    </PageFrame>
  );
}

function Section({ name, children }: { name: string; children: ReactNode }) {
  return <div data-section={name}>{children}</div>;
}

function RunPanel({ data }: { data: DossierPageData }) {
  const { dossier } = data;
  const steps = data.steps.map(stepView);
  return (
    <Section name="progress">
      <Panel
        id="run"
        title="the run"
        hint="wake → gather → read → seal → debate → measure → envelope → record"
      >
        {steps.length === 0 || onePerStage(steps) ? (
          <DossierLive
            key={`${dossier.status}:${dossier.updatedAt.toISOString()}`}
            dossierId={dossier.id}
            initial={{
              status: dossier.status,
              verdict: dossier.verdict,
              confidence: confidenceOf(dossier),
              steps,
            }}
          />
        ) : (
          // Only a tampered dossier gets here: its steps check fails, and the page cannot follow it.
          <div className="space-y-5">
            <p className="font-mono text-xs text-warning">
              This dossier’s step rows are not one per stage, so this page cannot follow or retry
              it. Verifying it says what is wrong.
            </p>
            <StageTimeline steps={steps} labelledBy="run-title" />
          </div>
        )}
      </Panel>
    </Section>
  );
}

function ReceiptSections({ data, view }: { data: DossierPageData; view: DossierReceiptView }) {
  const failed = data.dossier.status === "failed";
  return (
    <>
      <Section name="evidence">
        <Panel
          id="evidence"
          title="the evidence"
          hint={`${view.evidence.length} items · each one certified by inkprint before the debate saw it`}
        >
          <EvidenceTable rows={view.evidence} />
        </Panel>
      </Section>

      <Section name="transcript">
        <Panel id="transcript" title="the debate" hint="paper-trail’s signed transcript">
          {view.transcript.kind === "ok" ? (
            <TranscriptView
              transcript={view.transcript.value}
              certificateKeys={view.certificateKeys}
            />
          ) : view.transcript.kind === "none" ? (
            <p className="font-mono text-xs text-fg-muted">
              {failed
                ? "no transcript: the run stopped before the debate finished."
                : "no transcript is stored for this dossier."}
            </p>
          ) : (
            <p className="font-mono text-xs text-warning">{view.transcript.detail}</p>
          )}
        </Panel>
      </Section>

      {view.documents.length > 0 ? (
        <Section name="documents">
          <Panel
            id="documents"
            title="the documents"
            hint="each quoted passage, boxed on inkthread’s render of its page"
          >
            <WakeGate name="inkthread" services={["inkthread"]}>
              <DocumentPages documents={view.documents} />
            </WakeGate>
          </Panel>
        </Section>
      ) : null}

      <Section name="perf">
        <Panel
          id="perf"
          title="the queries it caused"
          hint="slowquery, by this dossier’s request id"
        >
          {view.perf.kind === "ok" ? (
            <PerfReceipt perf={view.perf.value} />
          ) : (
            <p
              className={`font-mono text-xs ${view.perf.kind === "none" ? "text-fg-muted" : "text-warning"}`}
            >
              {view.perf.kind === "none"
                ? "no perf receipt: the run did not reach the measure stage."
                : view.perf.detail}
            </p>
          )}
        </Panel>
      </Section>

      <Section name="envelope">
        <Panel
          id="envelope"
          title="the seal"
          hint="inkprint’s envelope over every receipt, and bastion’s audit digest"
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <EnvelopeReceipt envelope={view.envelope} />
            <AuditReceipt audit={view.audit} requestId={data.dossier.requestId} />
          </div>
        </Panel>
      </Section>
    </>
  );
}
