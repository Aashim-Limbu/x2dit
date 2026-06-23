import type { Metadata } from "next";
import { Archivo, Public_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { GrainOverlay } from "@/components/site/grain-overlay";

// The dossier voice: Archivo is an institutional grotesque (agency signage /
// official seal), set heavy for display. Public Sans is the literal US federal
// plain-language typeface — its provenance is the credibility. JetBrains Mono
// is the ledger/evidence voice for every exact value, address, and file label.
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-archivo",
  display: "swap",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "zk-houdini — now you see it, now you don't",
  description:
    "A private cross-chain bridge. Lock USDC on Ethereum, claim it on Stellar through a zero-knowledge proof — with no link between the two.",
  applicationName: "zk-houdini",
  metadataBase: new URL("https://zk-houdini.example"),
  openGraph: {
    title: "zk-houdini — a private cross-chain bridge",
    description:
      "Lock on Ethereum. Reappear privately on Stellar. A zero-knowledge vanishing act.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${archivo.variable} ${publicSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="relative min-h-full flex flex-col overflow-x-hidden">
        {children}
        <GrainOverlay />
      </body>
    </html>
  );
}
