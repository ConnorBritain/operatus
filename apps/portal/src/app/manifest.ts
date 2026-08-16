import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ventura Venture Control",
    short_name: "Ventura",
    description: "Observe and safely direct your machine branches and agent ventures from any screen.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f2e8",
    theme_color: "#f2eadc",
    icons: [
      { src: "/ventura-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/ventura-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
