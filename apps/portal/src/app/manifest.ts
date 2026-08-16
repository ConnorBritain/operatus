import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Atelier Remote Studio",
    short_name: "Atelier",
    description: "Observe and safely direct authorized Atelier machines from any screen.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f2e8",
    theme_color: "#f2eadc",
    icons: [{ src: "/atelier-mark.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }],
  };
}
