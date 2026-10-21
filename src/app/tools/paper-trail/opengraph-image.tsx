import { workbenchCard, workbenchCardAlt } from "@/features/tools/workbench-card";
import { SHARE_CARD_SIZE } from "@/lib/site/share-card";

export const alt = workbenchCardAlt("paper-trail");
export const size = SHARE_CARD_SIZE;
export const contentType = "image/png";

export default function OpengraphImage() {
  return workbenchCard("paper-trail");
}
