import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/toaster";
import { ModeToggle } from "@/components/mode-toggle";
import { QuickCapture } from "@/components/quick-capture";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "open-recall",
  description: "Privacy-focused, local-first Personal Knowledge Management with GraphRAG",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} antialiased`}>
        <Providers>
          {children}
          <QuickCapture />
          <ModeToggle />
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
