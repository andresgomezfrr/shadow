# Shadow evals

Baseline ligero (frozen 20 casos iniciales) para validar la calidad de los
prompts `extract` y `observe` antes de scalear cambios. Cubre las dos
observations abiertas: "Few-shot examples sin baseline ROI" y "Locale-aware
prompts sin baseline ROI".

## Estructura

```
evals/
  types.ts                  EvalCase + EvalResult shapes
  fixtures/
    extract.ts              10 inputs para la fase extract
    observe.ts              10 inputs para la fase observe
  runner.ts                 CLI runner (offline + live placeholder)
  snapshots/                outputs LLM frozen (gitignored)
```

## Uso

```bash
# Validar todos los casos contra snapshots locales (no llama al LLM):
npm run eval

# Solo una fase:
npx tsx evals/runner.ts --phase=extract

# Output máquina-readable para CI:
npx tsx evals/runner.ts --json
```

## Workflow para añadir/refrescar snapshots

1. Añade el caso a `fixtures/extract.ts` o `fixtures/observe.ts` con id único
   `extract-NN-<slug>` o `observe-NN-<slug>`.
2. Genera el snapshot llamando al pipeline real (manual, gasta tokens) y guarda
   el JSON en `evals/snapshots/<id>.json`. El modo `--mode=live` automatizará
   esto en una iteración posterior.
3. Corre `npm run eval` — el caso debe pasar todas las expectations (schema +
   limits + kinds + forbidden substrings).
4. Si una expectation falla, decide: ¿el prompt regresionó, o la expectation
   era demasiado estricta? Ajusta el lado que corresponda.

## Métricas layered

El runner valida en orden:

1. **schema-valid** (determinístico) — Zod `safeParse` con el schema del fixture.
2. **min/max items** — número de insights/observations dentro del rango.
3. **kind ∈ {...}** — al menos un item con el `kind` esperado.
4. **no-forbidden-substrings** — el snapshot serializado no contiene secretos
   ni código literal que se debería haber abstraído.

Una iteración futura añadirá `llm-as-judge` (Haiku) para factual-recall y
locale-correctness en los casos donde determinístico no es suficiente.

## CI

`.github/workflows/evals.yml` corre `npm run eval --json` nightly y en
`workflow_dispatch`. **No se ejecuta en cada PR** — sería ruido sin valor: los
snapshots están versionados y sólo regresionan si alguien los cambia o si el
schema cambia. Si quieres validar localmente antes de un PR que toca prompts,
corre `npm run eval` a mano.

## Pendiente (no en este sprint)

- `--mode=live`: refresca snapshots llamando al LLM real con `analysis/extract.ts`
  y `analysis/observe.ts` directamente. Requiere wiring de DB + config.
- LLM-as-judge layer con Haiku para metricas de calidad subjetiva (locale-fit,
  factual-recall vs input).
- Output a `shadow_observe` con tag `eval-regression` para que Shadow se
  auto-monitorice cuando un eval regresiona.
