# AGENTS.md

## Stack (sin build, sin tests)
- Sitio **estÃ¡tico en Vercel**, ES modules puros (`package.json` es stub, `"type": "module"`). **No hay** lint/test/compilador: no inventar comandos. Ãšnica verificaciÃ³n local Ãºtil: `node --check <archivo>.js`.
- `index.html` (raÃ­z) â†’ `script.js` â†’ `modules/*.js`. App de karaoke a 2 micrÃ³fonos. **Todo en espaÃ±ol**: UI, comentarios y console messages.

## Cache-busting automÃ¡tico vÃ­a `vercel.json` (desde oct-2026)
- `vercel.json` envÃ­a `Cache-Control: no-cache, must-revalidate` para `*.js`, `*.css`, `*.html` y `/`. El navegador revalida cada carga (304 si no cambiÃ³); **ya NO hay que subir `?v=` al editar**.
- Los `?v=` antiguos se dejan como estÃ¡n (inofensivos). No agregar `?v=` a imports nuevos: usar rutas peladas consistentes.
- Cadena vigente (sep-2026): `index.html` â†’ `style.css?v=6`, `cloudflare-storage.js?v=3`, `supabase-config.js?v=3`, `worklets.js?v=5`, `script.js?v=17`, `pitch-shifter-processor.js?v=11`. `script.js` â†’ `config.js?v=9`, `biblioteca.js?v=4`, `afinador.js?v=1`, `cambiar-tono.js?v=6`, `karaoke.js?v=18`, `estudio.js` (pelado). `karaoke.js` â†’ `config.js?v=9`, `afinador.js?v=1`, `biblioteca.js?v=4`, `worklets.js?v=5`. `biblioteca.js` â†’ `karaoke.js?v=18`. `cambiar-tono.js` â†’ `karaoke.js?v=18`, `biblioteca.js?v=4`, `worklets.js?v=5`. `estudio.js` â†’ `afinador.js?v=1`, `biblioteca.js?v=4`. Worker de audio: `audio-controller.js` â†’ `audio-processor-worker.js?v=2` (clÃ¡sico, sin importers con `?v=`). `worklets.js` carga `vocal-gate-processor.js?v=2` y `pitch-shifter-processor.js?v=11` (vÃ­a `index.html`).
- **Regla anti doble-instancia**: cada archivo debe importarse con el MISMO `?v=` en todos los importadores; mezclar ruta pelada (`./x.js`) con `./x.js?v=N` hace que el navegador ejecute el mÃ³dulo DOS veces (dos estados propios), ademÃ¡s de dejar la ruta pelada cacheada para siempre. Gaps preexistentes (uniformes en todas partes, sin doble instancia pero sin cache-busting): `utils.js`, `estudio.js` y `audio-controller.js` se importan sin `?v=`.
- Ejemplo real: "aÃ±adir 23 emojis a `config.js`" tocÃ³ `config.js`, `karaoke.js`, `biblioteca.js`, `cambiar-tono.js`, `script.js` e `index.html` (efecto dominÃ³).

## Deploy
- Repo pÃºblico GitHub `GlinTob/KaraokeTrain` â†’ Vercel. **El usuario sube los cambios Ã©l mismo** (no hay git/gh local ni credenciales en esta mÃ¡quina). No commitear/pushear salvo que lo pida; entregar archivos + instrucciones claras (o zip listo para subir por web).

## MÃ³dulos clave
- `index.html` define `window.__PITCH_WORKLET_URL__`; `modules/worklets.js` carga los worklets (`registerProcessor`): pitch-shifter y **vocal-gate**. El procesador vocal (vocal-processor.js / vocal-settings.js / liveAudioService.js) se ELIMINÃ“ (sep-2026): no reintroducir; el mix karaoke **limpia la voz automÃ¡ticamente** en el render offline (`karaoke.js` `mixKaraoke`): cadena voz = makeup automÃ¡tico (hasta Ã—12 si el canto quedÃ³ bajo) â†’ BiquadFilter highpass 90Hz â†’ `vocal-gate-processor.js` (noise gate/expansor por RMS: abre > âˆ’24 dB, cierra < âˆ’50 dB, piso âˆ’38 dB, ratio 2:1, attack 50ms/release 800ms, ganancia suavizada por muestra; con fallback sin gate si el worklet no carga) â†’ DynamicsCompressor (âˆ’18, knee 10, ratio 4) â†’ gain 0.65. Cadena pista = DynamicsCompressor (âˆ’14, knee 8, ratio 3) â†’ gain 0.38. Todo interno, sin controles de usuario.
- `pitch-shifter-processor.js`: port fiel de olvb/**phaze** (Unlicense) â€” phase vocoder Laroche-Dolson *region-shift*: hop 128, ventana 2048, 16 solapes OLA, desplazamiento de picos con correcciÃ³n de fase `e^{+jÂ·Î”Ï‰Â·timeCursor}`. La FFT forward usa signo **+1** (convenciÃ³n de fft.js; sus fases estÃ¡n conjugadas respecto a signo âˆ’1). Param: `pitchRatio`; passthrough si `|ratioâˆ’1| < 0.0001`. **NO reintroducir** el diseÃ±o antiguo (anillo + resample + acumulador de fase): se probÃ³ y fallaba; este diseÃ±o es el validado.
- `modules/cambiar-tono.js`: pitch shift en vivo y render offline para karaoke.
- `modules/config.js`: `EMOJI_OPTIONS` (96 emojis), `AVATAR_CATEGORIES` (imÃ¡genes `assets/avatares/*.png` â€” al aÃ±adir un avatar, el `.png` debe existir), temas de app/escenario, test de micrÃ³fonos.
- `supabase-config.js` + `@supabase/supabase-js@2` (CDN): **pendiente** warning CORS (`Authorization`) desde el browser â†’ opciÃ³n elegida: proxy `/api/db/*` en Vercel (NO implementado aÃºn; no insistir con otras vÃ­as).
- `cloudflare-worker.js` / `wrangler.toml` / `cloudflare-storage.js`: storage R2 legacy, infra aparte â€” ignorar salvo tareas de archivos.

## Verificar worklets sin browser
- Harness en el repo: `scripts/pitch-harness.cjs` (`npm.cmd test`) stubea `AudioWorkletProcessor`/`registerProcessor`, evalÃºa el worklet y le alimenta bloques de 128 muestras â†’ mide pitch (autocorr), ripple/ganancia, NaN, latencia y cola de impulso. Los tests auditivos (micrÃ³fono en browser) los hace el usuario.
- Criterios sane: pitch â‰ˆ `f0Â·ratio` (Â± ~4 Hz por cuantizaciÃ³n de bin es normal), ripple < ~2 %, sin NaN.

## Gotchas
- `npm` desde PowerShell falla con `npm.ps1` (policy de ejecuciÃ³n): usar **`npm.cmd`**.
- `separador/` contiene un `.venv` Python (torch/einops) de una herramienta previa: no escanear, no commitear; ignorarlo.
- `.env` guarda secretos (Supabase URL/key): nunca loguearlos ni incluirlos; `.gitignore` ya los cubre.
