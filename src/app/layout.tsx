import type { Metadata } from "next";
import { Cinzel, Manrope } from "next/font/google";
import "./globals.css";
import { Web3Providers } from "@/providers/Web3Providers";
import { TopNav } from "@/components/TopNav";

const displayFont = Cinzel({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const bodyFont = Manrope({
  variable: "--font-body",
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
    <html lang="en">
      <body
        className={`${displayFont.variable} ${bodyFont.variable} antialiased fx-body`}
      >
        <Web3Providers>
          <TopNav />
          {children}
        </Web3Providers>
      </body>
    </html>
  );
}