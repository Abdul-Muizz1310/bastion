import { ImageResponse } from "next/og";
import { shareCardAssets } from "@/lib/site/assets";
import { SITE } from "@/lib/site/config";
import { SHARE_CARD_SIZE, ShareCard, shareCardAlt } from "@/lib/site/share-card";

export const alt = shareCardAlt(SITE);
export const size = SHARE_CARD_SIZE;
export const contentType = "image/png";

export default async function OpengraphImage() {
  const { fonts, icon } = await shareCardAssets();
  return new ImageResponse(<ShareCard site={SITE} icon={icon} />, { ...size, fonts });
}
