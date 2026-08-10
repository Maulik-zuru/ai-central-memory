import type { Metadata } from "next";
import { Caveat } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const caveat = Caveat({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-marker",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI Memory & Context Platform",
  description: "One memory, every AI you use.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full antialiased ${caveat.variable}`}>
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
