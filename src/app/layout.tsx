import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Martian_Mono } from "next/font/google";
import { SITE } from "@/lib/site/config";
import { ROOT_VIEWPORT, rootMetadata } from "@/lib/site/metadata";
import "./globals.css";

// The house face for UI and code (convention-frontend-conventions), and a wide mono for names and
// headlines. Both are self-hosted by next/font at build time.
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"] });
const martianMono = Martian_Mono({
  variable: "--font-martian-mono",
  subsets: ["latin"],
  axes: ["wdth"],
});

export const metadata: Metadata = rootMetadata(SITE);
export const viewport: Viewport = ROOT_VIEWPORT;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${jetbrainsMono.variable} ${martianMono.variable}`}>
      <body className="relative min-h-screen bg-background bg-grid bg-scanlines font-mono text-foreground">
        {children}
      </body>
    </html>
  );
}
