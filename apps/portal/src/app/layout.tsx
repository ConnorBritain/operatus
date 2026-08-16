import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://england-ventura.vercel.app"),
  title: "Ventura — Venture Control",
  description: "An identity-bound operations floor for your branches and agent ventures.",
  applicationName: "Ventura",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/ventura-icon-192.png", apple: "/apple-touch-icon.png" },
  openGraph: {
    title: "Ventura — Venture Control",
    description: "Drop into your machine branches and agent ventures from anywhere.",
    images: [{ url: "/ventura-icon.png", width: 1024, height: 1024, alt: "Ventura mark" }],
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
