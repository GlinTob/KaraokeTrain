# AGENTS.md

## Stack (sin build, sin tests)
- Sitio **estático en Vercel**, ES modules puros (`package.json` es stub, `"type": "module"`). **No hay** lint/test/compilador: no inventar comandos. Única verificación local útil: `node --check <archivo>.js`.
- `index.html` (raíz) → `script.js` → `modules/*.js`. App de karaoke a 2 micrófonos. **Todo en español**: UI, comentarios y console messages.

## Cache-busting manual `?v=N` (crítico)
- Cada import usa `?v=` **manualmente**. Al editar un archivo hay que **subir su `?v=` en todos los importadores** (buscar con grep `?v=`). `script.js` sube su `?v=` en `index.html`.
- Cadena vigente (oct-2026): `index.html` → `style.css?v=4`, `cloudflare-storage.js?v=3`, `supabase-config.js?v=3`, `worklets.js?v=3`, `script.js?v=7`, `pitch-shifter-processor.js?v=10`. `script.js` → `config.js?v=6` (8×), `biblioteca.js?v=3`, `cambiar-tono.js?v=5`, `karaoke.js?v=3`. `karaoke.js` → `config.js?v=6`. `biblioteca.js`/`cambiar-tono.js` → `karaoke.js?v=3`.
- Ejemplo real: "añadir 23 emojis a `config.js`" tocó `config.js`, `karaoke.js`, `biblioteca.js`, `cambiar-tono.js`, `script.js` e `index.html` (efecto dominó).

## Deploy
- Repo público GitHub `GlinTob/KaraokeTrain` → Vercel. **El usuario sube los cambios él mismo** (no hay git/gh local ni credenciales en esta máquina). No commitear/pushear salvo que lo pida; entregar archivos + instrucciones claras (o zip listo para subir por web).

## Módulos clave
- `index.html` define `window.__PITCH_WORKLET_URL__` y `__VOCAL_PROCESSOR_URL__`; `modules/worklets.js` carga los worklets (`registerProcessor`).
- `pitch-shifter-processor.js`: port fiel de olvb/**phaze** (Unlicense) — phase vocoder Laroche-Dolson *region-shift*: hop 128, ventana 2048, 16 solapes OLA, desplazamiento de picos con corrección de fase `e^{+j·Δω·timeCursor}`. La FFT forward usa signo **+1** (convención de fft.js; sus fases están conjugadas respecto a signo −1). Param: `pitchRatio`; passthrough si `|ratio−1| < 0.0001`. **NO reintroducir** el diseño antiguo (anillo + resample + acumulador de fase): se probó y fallaba; este diseño es el validado.
- `modules/cambiar-tono.js`: pitch shift en vivo y render offline para karaoke.
- `modules/config.js`: `EMOJI_OPTIONS` (96 emojis), `AVATAR_CATEGORIES` (imágenes `assets/avatares/*.png` — al añadir un avatar, el `.png` debe existir), temas de app/escenario, test de micrófonos.
- `supabase-config.js` + `@supabase/supabase-js@2` (CDN): **pendiente** warning CORS (`Authorization`) desde el browser → opción elegida: proxy `/api/db/*` en Vercel (NO implementado aún; no insistir con otras vías).
- `cloudflare-worker.js` / `wrangler.toml` / `cloudflare-storage.js`: storage R2 legacy, infra aparte — ignorar salvo tareas de archivos.

## Verificar worklets sin browser
- No hay harness en el repo. En `C:\Users\Tobon\AppData\Local\Temp\opencode\` hay scripts Node que stubean `AudioWorkletProcessor`/`registerProcessor`, evalúan el worklet y le alimentan bloques de 128 muestras → miden pitch (autocorr), ripple/ganancia, NaN, latencia y cola de impulso. Los tests auditivos (micrófono en browser) los hace el usuario.
- Criterios sane: pitch ≈ `f0·ratio` (± ~4 Hz por cuantización de bin es normal), ripple < ~2 %, sin NaN.

## Gotchas
- `npm` desde PowerShell falla con `npm.ps1` (policy de ejecución): usar **`npm.cmd`**.
- `separador/` contiene un `.venv` Python (torch/einops) de una herramienta previa: no escanear, no commitear; ignorarlo.
- `.env` guarda secretos (Supabase URL/key): nunca loguearlos ni incluirlos; `.gitignore` ya los cubre.