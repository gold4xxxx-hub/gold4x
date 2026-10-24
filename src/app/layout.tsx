import type { Metadata } from "next";
import { Playfair_Display, Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Web3Providers } from "@/providers/Web3Providers";
import { TopNav } from "@/components/TopNav";
import { PortfolioAutoScroll } from "@/components/PortfolioAutoScroll";
import { RevealInit } from "@/components/RevealInit";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { WalletAccessGate } from "@/components/WalletAccessGate";

const displayFont = Playfair_Display({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const bodyFont = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const monoFont = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Display font for the audit console's cyber-luxury layer. Exposed as its own
// variable instead of replacing --font-display, so the rest of the app keeps
// Playfair and only the audit page opts into Space Grotesk.
const luxFont = Space_Grotesk({
  variable: "--font-lux",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "JSAVIOR | BSC DApp",
  description: "JSAVIOR live interface for Binance Smart Chain contract interactions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning data-scroll-behavior="smooth">
      <body
        className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable} ${luxFont.variable} antialiased fx-body`}
        suppressHydrationWarning
      >
        <ErrorBoundary>
          <Web3Providers>
            <WalletAccessGate>
              <RevealInit />
              <TopNav />
              <PortfolioAutoScroll />
              {children}
            </WalletAccessGate>
          </Web3Providers>
        </ErrorBoundary>
        <svg aria-hidden="true" style={{position:'fixed',pointerEvents:'none',width:0,height:0,opacity:0}}>
          <filter id="fx-noise">
            <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </svg>
      </body>
    </html>
  );
}