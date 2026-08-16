import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atelier — Remote Studio",
  description: "A calm, identity-bound view across your Atelier machines and conducted runs.",
  applicationName: "Atelier",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/atelier-mark.svg", apple: "/atelier-mark.svg" },
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
