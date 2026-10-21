import Link from "next/link";
import { ReceiptCard } from "@/components/receipts/ReceiptCard";
import type { PublicDossier } from "@/dossier/gallery";
import { dossierReceipt } from "../gallery-view";

/** The home gallery (spec 21 §3.1): finished dossiers as receipts, or why there are none to show. */

export type GalleryState =
  | { kind: "ok"; dossiers: readonly PublicDossier[] }
  | { kind: "unavailable" };

function Notice({ children, status = false }: { children: React.ReactNode; status?: boolean }) {
  return (
    <div
      role={status ? "status" : undefined}
      className="receipt-torn max-w-xl bg-surface px-5 pt-4 pb-[calc(var(--tear)+1rem)] font-mono text-sm"
    >
      {children}
    </div>
  );
}

export function DossierGallery({ gallery }: { gallery: GalleryState }) {
  if (gallery.kind === "unavailable") {
    return (
      <Notice status>
        <p className="text-warning">The gallery is unavailable right now.</p>
        <p className="mt-2 text-xs leading-relaxed text-fg-muted">
          The database did not answer. Reload in a minute, or{" "}
          <Link href="/dossier" className="text-accent-violet underline underline-offset-4">
            run a dossier of your own
          </Link>
          .
        </p>
      </Notice>
    );
  }

  if (gallery.dossiers.length === 0) {
    return (
      <Notice>
        <p className="text-foreground">no finished dossiers yet.</p>
        <p className="mt-2 text-xs leading-relaxed text-fg-muted">
          Every dossier lands here once its envelope is sealed.{" "}
          <Link href="/dossier" className="text-accent-violet underline underline-offset-4">
            run the first one →
          </Link>
        </p>
      </Notice>
    );
  }

  return (
    <ul className="grid gap-x-5 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
      {gallery.dossiers.map((d) => {
        const receipt = dossierReceipt(d);
        return (
          <li key={d.id}>
            <ReceiptCard {...receipt} />
          </li>
        );
      })}
    </ul>
  );
}
