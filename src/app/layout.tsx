import type { Metadata } from "next";
import { Playfair_Display, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Web3Providers } from "@/providers/Web3Providers";
import { TopNav } from "@/components/TopNav";
import { RevealInit } from "@/components/RevealInit";
import { ErrorBoundary } from "@/components/ErrorBoundary";

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
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable} antialiased fx-body`}
        suppressHydrationWarning
      >
        <ErrorBoundary>
          <Web3Providers>
            <RevealInit />
            <TopNav />
            {children}
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