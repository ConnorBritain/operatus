"use client";

import { useEffect } from "react";

export function AppearanceSync({ appearance, density }: { appearance: string; density: string }) {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.appearance = appearance;
    root.dataset.density = density;
    return () => {
      delete root.dataset.appearance;
      delete root.dataset.density;
    };
  }, [appearance, density]);

  return null;
}
