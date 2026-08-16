import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Operatus Agent Firm Control",
    short_name: "Operatus",
    description: "Observe and safely direct a scalable agent firm from any screen.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f2e8",
    theme_color: "#f2eadc",
    icons: [
      { src: "/operatus-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/operatus-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
