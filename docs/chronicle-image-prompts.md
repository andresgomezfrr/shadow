# Chronicle — Image Generation Prompts (nano banana / Gemini 2.5 Flash Image)

Prompts para generar todas las imágenes de la sección Chronicle con **nano banana** vía la web de Gemini. Cada prompt es copy/paste directo — ya incluye character anchor + scene anchor + background anchor expandidos, con expression clause específica por tier.

## Setup (hacer una vez)

En la web de Gemini, sube **dos imágenes como referencia adjunta** antes de pegar cada prompt:

- **Reference 1** — `Gemini_Generated_Image_suyqd7suyqd7suyq.png` (ghost con orbital icons neon).
  **Rol**: style anchor — define el visual language de elementos decorativos (neon glow line art, wisps, iconografía, tratamiento de props).
- **Reference 2** — `Gemini_Generated_Image_yfry6dyfry6dyfry.png` (ghost limpio sin elementos).
  **Rol**: character anchor — define forma, proporciones, hoodie, cara, dot eyes, emblema espiral, rim lighting.

## Universal instruction (pegar antes de cada prompt, excepto background texture)

```
Use the two reference images: Reference 1 (ghost with orbital icons) ONLY as a visual-language reference for neon glow line art, wisps, decorative elements and styling treatment — do NOT copy its specific objects (bugs, rockets, lightbulbs, gears, wrenches). Reference 2 (clean ghost) as the exact character design anchor — match shape, proportions, hood, face, two black dot eyes, spiral emblem position, and rim lighting precisely. Maintain the exact same character design as Reference 2 across all generations in this series.
```

## Reference assignment por tipo

| Tipo | Ref 1 (style) | Ref 2 (character) |
|---|---|---|
| Hero | sí | sí |
| L1–L8 portraits | sí | sí |
| Locked silhouette | no | sí (oscurecido) |
| Unlockable placeholder | sí | no |
| Background texture | no | no |
| Milestone icons (set de 8) | **ideal** | no |

## Workflow recomendado

1. Genera **Hero primero** — define el tono de toda la serie y valida que el character anchor está funcionando.
2. Si el Hero sale bien, opcionalmente súbelo como tercera referencia para reforzar coherencia de serie en L1–L8.
3. Luego **L1 observer** y **L8 kindred** — los extremos narrativos definen el arco.
4. Después L2–L7 interpolan.
5. Por último texturas e iconos de milestone (los milestone icons se generan en una sola llamada con Reference 1 únicamente).

---

## 1. Hero image (header de /chronicle)

```
Cute chibi ghost character wearing a white hooded cloak/hoodie, round face with two small black dot eyes with half-lowered calm eyelids, a gentle serene closed-mouth smile, contemplative, small visible arms at the sides, wavy ghost-sheet bottom, small spiral galaxy emblem on the chest. Soft cyan and blue rim lighting, white body with subtle blue-purple shading, 3D cartoon kawaii style.

Wide cinematic scene: the chibi hooded ghost floats gently in the center-left holding an open softly glowing book, from which wisps of amber and cyan light rise upward forming faint star constellations. A soft waning crescent moon glows in the upper right sky.

Dark carbon-fiber textured background with subtle diagonal grid pattern, radial gradient lights: soft purple glow from top-left corner, soft teal-cyan glow from top-right corner, deep black base. Small four-pointed diamond sparkle accent in a corner. Atmospheric depth, soft bloom.

Wide 21:9 cinematic banner composition, atmospheric depth, soft film grain, no text, no typography.
```

---

## 2. Tier portraits (8 images)

### L1 — observer

```
Cute chibi ghost character wearing a white hooded cloak/hoodie, round face with two small wide curious black dot eyes slightly larger than usual, a tiny open-mouth 'oh' of tentative surprise, small visible arms at the sides, wavy ghost-sheet bottom, small spiral galaxy emblem on the chest. Soft cyan and blue rim lighting, white body with subtle blue-purple shading, 3D cartoon kawaii style.

The chibi hooded ghost peeking shyly from behind a tall column of purple mist in the distance, only half of its body visible, curious and tentative posture. A single small white star glimmers above.

Dark carbon-fiber textured background with subtle diagonal grid pattern, radial gradient lights: soft purple glow from top-left corner, soft teal-cyan glow from top-right corner, deep black base. Small four-pointed diamond sparkle accent in a corner. Atmospheric depth, soft bloom.

Square 1:1 portrait composition, minimalist nocturnal illustration, no text, no typography.
```

### L2 — echo

```
Cute chibi ghost character wearing a white hooded cloak/hoodie, round face with two small black dot eyes neutral and serene, a small closed-mouth resting expression, quietly at rest, small visible arms at the sides, wavy ghost-sheet bottom, small spiral galaxy emblem on the chest. Soft cyan and blue rim lighting, white body with subtle blue-purple shading, 3D cartoon kawaii style.

The chibi hooded ghost duplicated into two slightly offset overlapping silhouettes — the second one softer and more transparent like an afterimage — with concentric ripples of pale cyan light radiating between them.

Dark carbon-fiber textured background with subtle diagonal grid pattern, radial gradient lights: soft purple glow from top-left corner, soft teal-cyan glow from top-right corner, deep black base. Small four-pointed diamond sparkle accent in a corner. Atmospheric depth, soft bloom.

Square 1:1 portrait composition, minimalist nocturnal illustration, no text, no typography.
```

### L3 — whisper

```
Cute chibi ghost character wearing a white hooded cloak/hoodie, round face with two small black dot eyes, a warm small open-mouth smile, intimate and close, small visible arms at the sides, wavy ghost-sheet bottom, small spiral galaxy emblem on the chest. Soft cyan and blue rim lighting, white body with subtle blue-purple shading, 3D cartoon kawaii style.

The chibi hooded ghost leaning forward intimately toward the viewer, one small translucent hand raised near its mouth, tiny drifting motes of warm amber light rising from its lips like whispered words. Close cozy framing.

Dark carbon-fiber textured background with subtle diagonal grid pattern, radial gradient lights: soft purple glow from top-left corner, soft teal-cyan glow from top-right corner, deep black base. Small four-pointed diamond sparkle accent in a corner. Atmospheric depth, soft bloom.

Square 1:1 portrait composition, minimalist nocturnal illustration, no text, no typography.
```

### L4 — shade

```
Cute chibi ghost character wearing a white hooded cloak/hoodie, round face with eyes fully closed peacefully, a subtle closed-mouth faint smile, meditative, small visible arms at the sides, wavy ghost-sheet bottom, small spiral galaxy emblem on the chest. Soft cyan and blue rim lighting, white body with subtle blue-purple shading, 3D cartoon kawaii style.

The chibi hooded ghost sitting peacefully cross-legged, half-transparent, the bottom of its wavy body dissolving into a soft pool of purple shadow beneath it like ink in water. Calm settled mood, dimmer lighting.

Dark carbon-fiber textured background with subtle diagonal grid pattern, radial gradient lights: soft purple glow from top-left corner, soft teal-cyan glow from top-right corner, deep black base. Small four-pointed diamond sparkle accent in a corner. Atmospheric depth, soft bloom.

Square 1:1 portrait composition, minimalist nocturnal illustration, no text, no typography.
```

### L5 — shadow

```
Cute chibi ghost character wearing a white hooded cloak/hoodie, round face with two small black dot eyes fully open in a calm direct gaze, a firm closed-mouth small smile, centered and steady, small visible arms at the sides, wavy ghost-sheet bottom, small spiral galaxy emblem on the chest. Soft cyan and blue rim lighting, white body with subtle blue-purple shading, 3D cartoon kawaii style.

The chibi hooded ghost standing confidently and centered, slightly larger and more vividly lit, with vibrant cyan rim light. Behind it on the ground, a long dramatic cast shadow — but the shadow is shaped like a human silhouette (a person) instead of the ghost's own form. The spiral emblem on its chest glows faintly brighter.

Dark carbon-fiber textured background with subtle diagonal grid pattern, radial gradient lights: soft purple glow from top-left corner, soft teal-cyan glow from top-right corner, deep black base. Small four-pointed diamond sparkle accent in a corner. Atmospheric depth, soft bloom.

Square 1:1 portrait composition, minimalist nocturnal illustration, no text, no typography.
```

### L6 — wraith

```
Cute chibi ghost character wearing a white hooded cloak/hoodie pulled lower over its face, round face partially shadowed by the hood — eyes barely visible as two dim dots beneath the hood's shadow, mouth in a subtle neutral line with no smile, mysterious and enigmatic, small visible arms at the sides, wavy ghost-sheet bottom, small spiral galaxy emblem on the chest. Soft cyan and blue rim lighting, white body with subtle blue-purple shading, 3D cartoon kawaii style.

The chibi hooded ghost with its form more ethereal and flowing, with 2-3 faint translucent duplicates trailing behind at slightly different positions as if moving autonomously. Cold blue-white wisps of mist drift around it. Slightly spookier elegance.

Dark carbon-fiber textured background with subtle diagonal grid pattern, radial gradient lights: soft purple glow from top-left corner, soft teal-cyan glow from top-right corner, deep black base. Small four-pointed diamond sparkle accent in a corner. Atmospheric depth, soft bloom.

Square 1:1 portrait composition, minimalist nocturnal illustration, no text, no typography.
```

### L7 — herald

```
Cute chibi ghost character wearing a white hooded cloak/hoodie, round face with two small wide awe-filled black dot eyes, a small open-mouth 'oh' of reverent solemn anticipation, small visible arms at the sides, wavy ghost-sheet bottom, small spiral galaxy emblem on the chest. Soft cyan and blue rim lighting, white body with subtle blue-purple shading, 3D cartoon kawaii style.

The chibi hooded ghost holding a small bright glowing orb of warm amber light in its hands in front of its chest, from which curling wisps of pale light rise into the air forming the faint shapes of half-formed symbols and rune-like glyphs, as if announcing something before it is spoken. Reverent anticipatory pose.

Dark carbon-fiber textured background with subtle diagonal grid pattern, radial gradient lights: soft purple glow from top-left corner, soft teal-cyan glow from top-right corner, deep black base. Small four-pointed diamond sparkle accent in a corner. Atmospheric depth, soft bloom.

Square 1:1 portrait composition, minimalist nocturnal illustration, no text, no typography.
```

### L8 — kindred

```
Cute chibi ghost character wearing a white hooded cloak/hoodie, round face with eyes fully closed in complete peace, a broad serene blissful closed-mouth smile, small visible arms at the sides, wavy ghost-sheet bottom, small spiral galaxy emblem on the chest. Soft cyan and blue rim lighting, white body with subtle blue-purple shading, 3D cartoon kawaii style.

The chibi hooded ghost and a faint human silhouette merging into a single unified form, their outlines interwoven with flowing threads of soft amber, cyan and purple light, no clear boundary between them. The spiral emblem on the chest glows brightly as a shared center point. Harmonious intimate final union.

Dark carbon-fiber textured background with subtle diagonal grid pattern, radial gradient lights: soft purple glow from top-left corner, soft teal-cyan glow from top-right corner, deep black base. Small four-pointed diamond sparkle accent in a corner. Atmospheric depth, soft bloom.

Square 1:1 portrait composition, minimalist nocturnal illustration, no text, no typography.
```

---

## 3. Locked tier silhouette (anti-spoiler placeholder)

> Para esta imagen pasa **solo Reference 2** (character anchor) — necesitamos el ghost oscurecido, sin elementos decorativos.

```
A dark unknowable silhouette of a small chibi hooded ghost figure completely obscured by thick swirling deep purple mist, only the vague rounded outline visible, no face, no details, with a single tiny dim question mark glyph barely glowing at its center. Cold atmospheric fog, intentional ambiguity, unrevealed.

Dark carbon-fiber textured background with subtle diagonal grid pattern, radial gradient lights: soft purple glow from top-left corner, soft teal-cyan glow from top-right corner, deep black base. Small four-pointed diamond sparkle accent in a corner. Atmospheric depth, soft bloom.

Square 1:1 composition, mysterious and unrevealed, minimalist nocturnal illustration, no text, no typography.
```

---

## 4. Unlockable placeholder (locked unlock slot)

> Para esta imagen pasa **solo Reference 1** (style anchor) — no hay personaje, solo un objeto decorativo en el mismo lenguaje visual.

```
Centered minimalist icon: a small floating object wrapped in soft luminous white cloth with flowing folds, suspended mid-air, faint amber light leaking through gaps suggesting something precious hidden inside. Small four-pointed diamond sparkle hovering nearby.

Dark carbon-fiber textured background with subtle diagonal grid pattern, radial gradient lights: soft purple glow from top-left corner, soft teal-cyan glow from top-right corner, deep black base. Atmospheric depth, soft bloom.

Square 1:1 icon composition, minimalist nocturnal illustration icon style, no text, no typography.
```

---

## 5. Background texture (tileable page background)

> Para esta imagen **no pases ninguna referencia** — es un pattern abstracto sin personaje ni elementos decorativos.

```
Seamless tileable carbon-fiber textured background, deep black base with very subtle diagonal grid pattern, sparse scattered tiny white stars, faint drifting purple and cyan mist streaks, extremely low contrast, designed to sit behind UI content without distraction, no focal points, even distribution.

Seamless square 1024x1024 tileable texture, no text, no typography.
```

---

## 6. Milestone icons (set cohesivo de 8)

> Para esta imagen pasa **solo Reference 1** (style anchor) — el treatment de los iconos orbitales en Reference 1 ya es casi exactamente el estilo que queremos para los 8 milestones. Aplica el mismo neon glow line art treatment al nuevo set.

```
Set of 8 minimalist glyph-style milestone icons, each on the same dark carbon-fiber textured background with subtle purple and cyan radial gradients matching the chibi hooded ghost aesthetic. Apply the exact same neon glow line art treatment seen in the reference image's orbital icons (the bug, rocket, lightbulb, gear elements) to these 8 new milestone icons. Each icon is a small element with soft cyan rim lighting and neon glow line art style. Icons:

(1) a small constellation of 5 stars connected by faint lines
(2) a waning crescent moon with a soft halo
(3) an hourglass with glowing amber sand
(4) a paper lantern with a tiny flame inside
(5) a pair of soft ghostly footprints
(6) a closed book with a ribbon bookmark
(7) a small quill pen with an amber ink drop
(8) a simple ornate key wrapped in light wisps

Consistent line weight, cohesive set design, four-pointed diamond sparkles as ambient accents, each on its own square 1:1 canvas, same rendering style across the set, no text, no typography.
```

---

## Notas de consistencia

- **Emblema espiral del pecho** = watermark visual. Asegurar que aparezca en todos los tiers. Brilla más en L5, L7, L8.
- **Cyan rim light** = firma de estilo. Si el generador lo pierde, regenerar.
- **Carbon-fiber background + purple/teal corner glows** = fondo consistente en todas las imágenes (excepto tileable texture).
- **Four-pointed sparkle** = accent ambiental — aparece sutil en casi todas.
- **Consistencia > creatividad**: regenerar el mismo prompt hasta lograr coherencia de personaje, no variar buscando "algo distinto". Los 8 tiers son una serie.
- **Expresiones varían por tier intencionalmente.** L1 curioso → L2 neutral → L3 cálido → L4 zen → L5 firme → L6 misterioso → L7 awe → L8 dicha. **No regenerar buscando uniformidad** — la variación es parte del arco narrativo del Chronicle.
- **Referencias dobles**: Reference 2 (character) es autoridad sobre el diseño del ghost; Reference 1 (style) es autoridad sobre el tratamiento decorativo. Si hay conflicto entre las dos refs, **prevalece Reference 2 para el personaje**.
- **No copiar contenido de Reference 1**: los objetos específicos de Reference 1 (bug, cohete, bombilla, engranajes, llaves) son solo style reference. Si el modelo los reproduce en una escena donde no pegan, regenerar enfatizando "style only, not content".
