import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://operatus.vercel.app"),
  title: "Operatus | Visual Agent Operations",
  description: "A visual tool for managing AI agent operations across any machine, anywhere.",
  applicationName: "Operatus",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/operatus-icon-192.png", apple: "/apple-touch-icon.png" },
  openGraph: {
    title: "Operatus | Visual Agent Operations",
    description: "Delegate agent work to a lead Conductor and keep every machine in view from anywhere.",
    images: [{ url: "/operatus-icon.png", width: 1024, height: 1024, alt: "Operatus mark" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f2eadc",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
