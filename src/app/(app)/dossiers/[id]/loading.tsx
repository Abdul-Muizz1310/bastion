import { PageFrame } from "@/components/terminal/PageFrame";
import { TerminalWindow } from "@/components/terminal/TerminalWindow";

export default function DossierLoading() {
  return (
    <PageFrame statusLeft="loading dossier" statusRight="bastion · control plane">
      <div className="mx-auto mt-16 max-w-xl">
        <TerminalWindow title="$ bastion dossier load" status="yellow">
          <div className="space-y-3 font-mono text-sm">
            <p className="text-fg-muted">
              {"$ fetching dossier state"}
              <span className="cursor-blink ml-1 inline-block h-3.5 w-1.5 bg-accent-violet" />
            </p>
            <p className="text-fg-faint text-xs">{"// this should only take a moment"}</p>
          </div>
        </TerminalWindow>
      </div>
    </PageFrame>
  );
}
