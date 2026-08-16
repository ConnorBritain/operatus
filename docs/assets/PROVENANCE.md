# Operatus visual asset provenance

The Operatus operations floor is new clean-room work. It began under the working name Matrix, passed through the Atelier and Ventura working identities, and was finalized as Operatus before release. The adopted direction is a light, legible 16-bit operations floor with distinct implementation, evidence, critique, and repair zones.

Restricted Munder/LimeZu tiles, maps, base character sheets, recolors, screenshots, and promotional imagery were not used as references or inputs. Code adapted from upstream remains covered by its source license and attribution independently from the removed art.

## Operations floor — 2026-08-15

- Source: `src/renderer/src/assets/operatus/operatus-operations-floor-source.png`
- Runtime derivative: `src/renderer/src/assets/operatus/operatus-operations-floor.png` (768×576)
- Map contract: `src/renderer/src/assets/maps/operatus-operations.tmj`
- Generation tool: OpenAI image generation through Codex's built-in image tool.
- Input images: none.
- Initial prompt: "Create an original clean-room 16-bit pixel-art top-down technical operations office for a desktop multi-agent coding application called Matrix. Preserve the useful spatial feel of a compact cozy pixel office: a slightly larger glass-walled Conductor room in the upper-left; a central open bullpen with rows of individual desks and glowing monitors; a critique/evidence room with inspection consoles; a bounded repair bay; a small break area; corridors wide enough for walking sprites; wall boards, clocks, plants, server racks, cable conduits, and status lights. Make the zones visually readable but do not include any words, letters, logos, copyrighted characters, sitcom references, or recognizable existing game assets. Art direction: precise orthographic/top-down 16-bit pixel art, crisp nearest-neighbor edges, 16px-grid discipline, cozy but technical, cool slate/navy/indigo base with muted mint, amber, lilac, and coral status accents, warm monitor glow, restrained detail, strong floor/wall separation. The composition should feel like a polished reskin of a dense office-floor management UI rather than a generic dashboard or a sci-fi spaceship. Opaque background, no transparency, one complete floor plan, no UI chrome, no people. Landscape 4:3 composition, suitable as source art for a 1024x768 application floor."
- Adopted light-office edit prompt: "Edit this exact Matrix operations-floor image while preserving the overall floor-plan geometry, room placement, desk count, corridors, glass-walled Conductor room, central bullpen, critique/evidence room, repair bay, break area, and top-down 16-bit pixel-art construction. Change only the visual design direction from a dark command bunker to a bright, warm, contemporary AI research office. Use abundant soft daylight; warm-white and oatmeal walls; pale oak desks and cabinetry; light warm-gray floors; soft charcoal structural outlines instead of black; muted terracotta/coral, clay, sage, lavender, and restrained indigo accents; healthy green plants; translucent glass; cream task boards; subtle warm monitor glow. Keep enough contrast for small moving sprites and app overlays. The mood should be calm, thoughtful, human, collaborative, premium, and cozy—an inviting research studio rather than a spaceship or cyberpunk control room. No words, letters, logos, trademarks, people, copyrighted characters, or recognizable existing game assets. Maintain crisp nearest-neighbor-style pixel edges and the same landscape 4:3 composition."

## Operatus application icon — 2026-08-16

- Adopted source: `docs/assets/operatus-icon-source.png`.
- Runtime and packaging derivatives: `docs/logo.png`, `docs/apple-touch-icon.png`, `docs/favicon-32.png`, `build/icon.png`, `build/icon.icns`, and `build/icon.ico`.
- Generation tool: OpenAI image generation through Codex's built-in image tool.
- Concept: a friendly faceted-gem operator behind a compact briefcase desk. The gem carries forward Atelier's strongest visual idea; the desk supplies the business/operator reference without turning the mark into a literal executive or ominous command system.
- Input image: an earlier clean-room Operatus concept generated in the same session. No upstream logo, character, screenshot, or third-party icon was used.
- Adopted production edit prompt: "Edit this exact Operatus pixel-art icon into a dock-size production mark. Keep the friendly faceted coral gemstone operator and the executive briefcase-desk concept, but REMOVE the entire organization-chart line and all three subordinate gems below it. Remove the floating sparkle symbols, plant, coffee cup, and decorative peripheral objects. Simplify the desk into one compact warm-charcoal briefcase-shaped business console with a small muted-gold handle and minimal terracotta edge accents. Make the gem operator and desk substantially larger, centered, and together fill about 65% of the square while retaining generous clear space around the emblem. Preserve the gem's subtle friendly face, calm cooperative personality, faceted highlight, and warm palette. Strengthen the outer silhouette and reduce internal details so it remains unmistakable at 16px, 32px, and macOS dock sizes. Hard-edged authentic 16-bit pixel art, limited flat palette, opaque uniform warm cream background edge-to-edge. No subagents, no orbit, no organization chart, no targeting ring, no gradients, no glow, no shadow, no text, no letters, no extra symbols, no robot body, no sci-fi menace. One compact gem-at-briefcase-desk emblem only, square 1:1."
- Final personality pass: restored one small teal plant, one small cream/coral cup, three sparse background sparkles, and four distinct blue, red, yellow, and green status studs on the briefcase while retaining the same single-operator silhouette and excluding subordinate-agent imagery.
- Production processing: center-cropped, reduced to a 128×128 pixel-art working grid, and scaled to the 1024×1024 master with nearest-neighbor sampling. Platform and web sizes were derived from that master with hard pixel edges.

### Freestanding portal mark

- Runtime asset: `apps/portal/public/operatus-mark-transparent.png` (1024×1024).
- SHA-256: `2ac346b81a3c86df50adddbb626924aee96f19ca679406134fc4c0e8c380df75`.
- Source: the adopted `apps/portal/public/operatus-icon.png`; no generative restyling was accepted.
- Production processing: the uniform warm-cream border color was sampled and removed with the image-generation skill's chroma-key helper using a hard eight-point tolerance and no despill. The hard alpha edge corrects the earlier washed-out portal rendering by keeping the coral gem, teal plant, cream cup, sparkles, and four status colors fully opaque and saturated.
- Intended use: a borderless identity mark over the hosted sign-in surface. The original opaque icon remains authoritative for dock, favicon, PWA, and social uses.

### Inverse sign-in mark

- Runtime asset: `apps/portal/public/operatus-mark-inverse.png` (1254×1254).
- SHA-256: `c78c6353b64e0e291928229c7e07c1d6d40031fb93d1d74c9cbff49453bf4f9f`.
- Generation tool: OpenAI image generation through Codex's built-in image tool in precise-object-edit mode.
- Input image: the intact `docs/assets/operatus-icon-source.png`. The earlier transparent derivative was rejected because its background extraction had removed part of the gem's upper-left facet.
- Adopted prompt: "Use case: precise-object-edit. Create an inverse-color variant of this exact intact Operatus pixel-art icon. Preserve the complete solid closed diamond silhouette exactly, especially the continuous upper-left facet: there must be NO hole, cutout, missing wedge, crack, split, black interior gap, transparent interior, or egg-like shell shape anywhere inside the gem. Recolor only the coral/orange diamond operator to warm ivory/off-white with restrained pale blush and peach facet shading. Preserve its friendly face, dark outline, desk, drawer, plant, cup, handle, sparkles, four colored desk studs, scale, position, crisp pixel geometry, and all other details. Replace the existing cream background with one perfectly uniform flat chroma background color #FF00FF edge-to-edge. No gradients, shadows, texture, or magenta on the subject. Do not add or remove objects, restyle, resize, smooth, or add text. Square 1:1."
- Production processing: the generated chroma background was removed with a tight local matte. The result was inspected at source size and is also verified in the portal at its 88–104 px rendered size before release.
- Intended use: the coral identity band on the hosted sign-in card. The freestanding coral mark remains the canonical light-surface portal mark, and the opaque application icon remains authoritative for dock, favicon, PWA, and social uses.

## Hosted portal collaboration scene — 2026-08-16

- Runtime asset: `apps/portal/public/operatus-office-collaboration.webp` (1448×1086).
- SHA-256: `fbec26499ead1e0e3e1047ef9f1b51e1d015d4fdc8af77d3a58b5f80dbb9ba0e`.
- Generation tool: OpenAI image generation through Codex's built-in image tool.
- Input image: the clean-room Operatus operations floor documented above, used only as a reference for the product's room geometry, warm materials, and established visual language.
- Adopted prompt: "Create a new original 16-bit pixel-art illustration of a friendly AI firm actively collaborating inside a warm operations office. Show several small faceted gem AI agents with simple expressive faces: a coral Conductor coordinating at a shared planning table, a teal Implementer at a monitor, a lavender Critic inspecting evidence on screens, and an amber Repairer bringing a work packet between stations. Use an inviting top-down three-quarter office related to the reference app layout—glass lead room, central desk bullpen, evidence/critique room, repair workbench, pale oak desks, cream tile, plants, server racks, warm task lighting, windows, and subtle daylight. Keep the essential characters in the central 65 percent so the image survives wide desktop and tall mobile crops. Polished hand-authored 16-bit/SNES-era pixel art, crisp nearest-neighbor edges, warm and sophisticated rather than childish. No large empty flat grid, UI chrome, words, letters, numbers, logos, watermarks, humans, copyrighted characters, sitcom references, recognizable game assets, cyberpunk, ominous robots, or photorealism."
- Production processing: encoded as a high-quality WebP for responsive delivery. The same scene is cropped into the Welcome Back card as a small 16-bit window into the active office.
