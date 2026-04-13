# Chronicle — Image Generation Prompts

Prompts para generar todas las imágenes de la sección Chronicle. Cada prompt es copy/paste directo — ya incluye character anchor + scene anchor + contenido específico expandidos.

## Workflow recomendado

1. Usa la imagen base del ghost como `--cref <URL>` en Midjourney (o image-prompt en Flux/DALL-E) para anclar el personaje
2. Genera **Hero primero** — define el tono de toda la serie
3. Luego **L1 observer** y **L8 kindred** — los extremos narrativos definen el arco
4. Después L2-L7 interpolan
5. Por último texturas e iconos de milestone
6. Sugerencia Midjourney: `--cw 80 --s 250 --v 7`

## Parámetros por tipo

| Tipo | Aspect ratio | Notas |
|---|---|---|
| Hero | `--ar 21:9` | Cinematic banner |
| Tier portraits (L1-L8) | `--ar 1:1` | Square cards |
| Locked silhouette | `--ar 1:1` | Square |
| Unlockable placeholder | `--ar 1:1` | Square icon |
| Background texture | `--ar 1:1` | 1024x1024 tileable |
| Milestone icon set | `--ar 1:1` | Each square |

---

## 1. Hero image (header de /chronicle)

```
Cute chibi ghost character wearing a white hooded cloak/hoodie, round face with two small black dot eyes and a tiny gentle closed-mouth smile, small visible arms at the sides, wavy ghost-sheet bottom, small spiral galaxy emblem on the chest. Soft cyan and blue rim lighting, white body with subtle blue-purple shading, 3D cartoon kawaii style.

Wide cinematic scene: the chibi hooded ghost floats gently in the center-left holding an open softly glowing book, from which wisps of amber and cyan light rise upward forming faint star constellations. A soft waning crescent moon glows in the upper right sky.

Dark carbon-fiber textured background with subtle diagonal grid pattern, radial gradient lights: soft purple glow from top-left corner, soft teal-cyan glow from top-right corner, deep black base. Small four-pointed diamond sparkle accent in a corner. Atmospheric depth, soft bloom.

21:9 cinematic aspect ratio, atmospheric depth, soft film grain, no text, no typography.
```

---

## 2. Tier portraits (8 images)

### L1 — observer

```
Cute chibi ghost character wearing a white hooded cloak/hoodie, round face with two small black dot eyes and a tiny gentle closed-mouth smile, small visible arms at the sides, wavy ghost-sheet bottom, small spiral galaxy emblem on the chest. Soft cyan and blue rim lighting, white body with subtle blue-purple shading, 3D cartoon kawaii style.

The chibi hooded ghost peeking shyly from behind a tall column of purple mist in the distance, only half of its body visible, curious and tentative posture. A single small white star glimmers above.

Dark carbon-fiber textured background with subtle diagonal grid pattern, radial gradient lights: soft purple glow from top-left corner, soft teal-cyan glow from top-right corner, deep black base. Small four-pointed diamond sparkle accent in a corner. Atmospheric depth, soft bloom.

Square 1:1 aspect ratio, no text, no typography, minimalist nocturnal illustration.
```

### L2 — echo

```
Cute chibi ghost character wearing a white hooded cloak/hoodie, round face with two small black dot eyes and a tiny gentle closed-mouth smile, small visible arms at the sides, wavy ghost-sheet bottom, small spiral galaxy emblem on the chest. Soft cyan and blue rim lighting, white body with subtle blue-purple shading, 3D cartoon kawaii style.

The chibi hooded ghost duplicated into two slightly offset overlapping silhouettes — the second one softer and more transparent like an afterimage — with concentric ripples of pale cyan light radiating between them.

Dark carbon-fiber textured background with subtle diagonal grid pattern, radial gradient lights: soft purple glow from top-left corner, soft teal-cyan glow from top-right corner, deep black base. Small four-pointed diamond sparkle accent in a corner. Atmospheric depth, soft bloom.

Square 1:1 aspect ratio, no text, no typography, minimalist nocturnal illustration.
```

### L3 — whisper

```
Cute chibi ghost character wearing a white hooded cloak/hoodie, round face with two small black dot eyes and a tiny gentle closed-mouth smile, small visible arms at the sides, wavy ghost-sheet bottom, small spiral galaxy emblem on the chest. Soft cyan and blue rim lighting, white body with subtle blue-purple shading, 3D cartoon kawaii style.

The chibi hooded ghost leaning forward intimately toward the viewer, one small translucent hand raised near its mouth, tiny drifting motes of warm amber light rising from its lips like whispered words. Close cozy framing.

Dark carbon-fiber textured background with subtle diagonal grid pattern, radial gradient lights: soft purple glow from top-left corner, soft teal-cyan glow from top-right corner, deep black base. Small four-pointed diamond sparkle accent in a corner. Atmospheric depth, soft bloom.

Square 1:1 aspect ratio, no text, no typography, minimalist nocturnal illustration.
```

### L4 — shade

```
Cute chibi ghost character wearing a white hooded cloak/hoodie, round face with two small black dot eyes and a tiny gentle closed-mouth smile, small visible arms at the sides, wavy ghost-sheet bottom, small spiral galaxy emblem on the chest. Soft cyan and blue rim lighting, white body with subtle blue-purple shading, 3D cartoon kawaii style.

The chibi hooded ghost sitting peacefully cross-legged, half-transparent, the bottom of its wavy body dissolving into a soft pool of purple shadow beneath it like ink in water. Calm settled mood, dimmer lighting.

Dark carbon-fiber textured background with subtle diagonal grid pattern, radial gradient lights: soft purple glow from top-left corner, soft teal-cyan glow from top-right corner, deep black base. Small four-pointed diamond sparkle accent in a corner. Atmospheric depth, soft bloom.

Square 1:1 aspect ratio, no text, no typography, minimalist nocturnal illustration.
```

### L5 — shadow

```
Cute chibi ghost character wearing a white hooded cloak/hoodie, round face with two small black dot eyes and a tiny gentle closed-mouth smile, small visible arms at the sides, wavy ghost-sheet bottom, small spiral galaxy emblem on the chest. Soft cyan and blue rim lighting, white body with subtle blue-purple shading, 3D cartoon kawaii style.

The chibi hooded ghost standing confidently and centered, slightly larger and more vividly lit, with vibrant cyan rim light. Behind it on the ground, a long dramatic cast shadow — but the shadow is shaped like a human silhouette (a person) instead of the ghost's own form. The spiral emblem on its chest glows faintly brighter.

Dark carbon-fiber textured background with subtle diagonal grid pattern, radial gradient lights: soft purple glow from top-left corner, soft teal-cyan glow from top-right corner, deep black base. Small four-pointed diamond sparkle accent in a corner. Atmospheric depth, soft bloom.

Square 1:1 aspect ratio, no text, no typography, minimalist nocturnal illustration.
```

### L6 — wraith

```
Cute chibi ghost character wearing a white hooded cloak/hoodie, round face with two small black dot eyes and a tiny gentle closed-mouth smile, small visible arms at the sides, wavy ghost-sheet bottom, small spiral galaxy emblem on the chest. Soft cyan and blue rim lighting, white body with subtle blue-purple shading, 3D cartoon kawaii style.

The chibi hooded ghost with its hoodie pulled slightly lower over its face, its form more ethereal and flowing, with 2-3 faint translucent duplicates trailing behind at slightly different positions as if moving autonomously. Cold blue-white wisps of mist drift around it. Slightly spookier elegance.

Dark carbon-fiber textured background with subtle diagonal grid pattern, radial gradient lights: soft purple glow from top-left corner, soft teal-cyan glow from top-right corner, deep black base. Small four-pointed diamond sparkle accent in a corner. Atmospheric depth, soft bloom.

Square 1:1 aspect ratio, no text, no typography, minimalist nocturnal illustration.
```

### L7 — herald

```
Cute chibi ghost character wearing a white hooded cloak/hoodie, round face with two small black dot eyes and a tiny gentle closed-mouth smile, small visible arms at the sides, wavy ghost-sheet bottom, small spiral galaxy emblem on the chest. Soft cyan and blue rim lighting, white body with subtle blue-purple shading, 3D cartoon kawaii style.

The chibi hooded ghost holding a small bright glowing orb of warm amber light in its hands in front of its chest, from which curling wisps of pale light rise into the air forming the faint shapes of half-formed symbols and rune-like glyphs, as if announcing something before it is spoken. Reverent anticipatory pose.

Dark carbon-fiber textured background with subtle diagonal grid pattern, radial gradient lights: soft purple glow from top-left corner, soft teal-cyan glow from top-right corner, deep black base. Small four-pointed diamond sparkle accent in a corner. Atmospheric depth, soft bloom.

Square 1:1 aspect ratio, no text, no typography, minimalist nocturnal illustration.
```

### L8 — kindred

```
Cute chibi ghost character wearing a white hooded cloak/hoodie, round face with two small black dot eyes and a tiny gentle closed-mouth smile, small visible arms at the sides, wavy ghost-sheet bottom, small spiral galaxy emblem on the chest. Soft cyan and blue rim lighting, white body with subtle blue-purple shading, 3D cartoon kawaii style.

The chibi hooded ghost and a faint human silhouette merging into a single unified form, their outlines interwoven with flowing threads of soft amber, cyan and purple light, no clear boundary between them. The spiral emblem on the chest glows brightly as a shared center point. Harmonious intimate final union.

Dark carbon-fiber textured background with subtle diagonal grid pattern, radial gradient lights: soft purple glow from top-left corner, soft teal-cyan glow from top-right corner, deep black base. Small four-pointed diamond sparkle accent in a corner. Atmospheric depth, soft bloom.

Square 1:1 aspect ratio, no text, no typography, minimalist nocturnal illustration.
```

---

## 3. Locked tier silhouette (anti-spoiler placeholder)

```
A dark unknowable silhouette of a small chibi hooded ghost figure completely obscured by thick swirling deep purple mist, only the vague rounded outline visible, no face, no details, with a single tiny dim question mark glyph barely glowing at its center. Cold atmospheric fog, intentional ambiguity, unrevealed.

Dark carbon-fiber textured background with subtle diagonal grid pattern, radial gradient lights: soft purple glow from top-left corner, soft teal-cyan glow from top-right corner, deep black base. Small four-pointed diamond sparkle accent in a corner. Atmospheric depth, soft bloom.

Square 1:1 aspect ratio, no text, no typography, minimalist nocturnal illustration, mysterious and unrevealed.
```

---

## 4. Unlockable placeholder (locked unlock slot)

```
Centered minimalist icon: a small floating object wrapped in soft luminous white cloth with flowing folds, suspended mid-air, faint amber light leaking through gaps suggesting something precious hidden inside. Small four-pointed diamond sparkle hovering nearby.

Dark carbon-fiber textured background with subtle diagonal grid pattern, radial gradient lights: soft purple glow from top-left corner, soft teal-cyan glow from top-right corner, deep black base. Atmospheric depth, soft bloom.

Square 1:1 aspect ratio, no text, no typography, icon style, minimalist nocturnal illustration.
```

---

## 5. Background texture (tileable page background)

```
Seamless tileable carbon-fiber textured background, deep black base with very subtle diagonal grid pattern, sparse scattered tiny white stars, faint drifting purple and cyan mist streaks, extremely low contrast, designed to sit behind UI content without distraction, no focal points, even distribution, 1024x1024 tileable, no text, no typography.
```

---

## 6. Milestone icons (set cohesivo de 8)

```
Set of 8 minimalist glyph-style milestone icons, each on the same dark carbon-fiber textured background with subtle purple and cyan radial gradients matching the chibi hooded ghost aesthetic. Each icon is a small 3D cartoon element with soft cyan rim lighting. Icons:

(1) a small constellation of 5 stars connected by faint lines
(2) a waning crescent moon with a soft halo
(3) an hourglass with glowing amber sand
(4) a paper lantern with a tiny flame inside
(5) a pair of soft ghostly footprints
(6) a closed book with a ribbon bookmark
(7) a small quill pen with an amber ink drop
(8) a simple ornate key wrapped in light wisps

Consistent line weight, cohesive set design, four-pointed diamond sparkles as ambient accents, each icon on its own square 1:1 canvas, same rendering style across the set, no text, no typography.
```

---

## Notas de consistencia

- **Emblema espiral del pecho** = watermark visual. Asegurar que aparezca en todos los tiers. Brilla más en L5, L7, L8.
- **Cyan rim light** = firma de estilo. Si el generador lo pierde, regenerar.
- **Carbon-fiber background + purple/teal corner glows** = fondo consistente en todas las imágenes (excepto tileable texture).
- **Four-pointed sparkle** = accent ambiental — aparece sutil en casi todas.
- **Consistencia > creatividad**: regenerar el mismo prompt hasta lograr coherencia de personaje, no variar buscando "algo distinto". Los 8 tiers son una serie.
