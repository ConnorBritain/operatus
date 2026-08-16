import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://operatus.vercel.app"),
  title: "Operatus — Agent Firm Control",
  description: "An identity-bound operations floor for a scalable agent firm.",
  applicationName: "Operatus",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/operatus-icon-192.png", apple: "/apple-touch-icon.png" },
  openGraph: {
    title: "Operatus — Agent Firm Control",
    description: "Direct machine branches and agent ventures from anywhere.",
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
