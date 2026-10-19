// ==========================================
// VOCAL GATE PROCESSOR — Limpieza automática de voz
// ==========================================
//
// Se inserta en la cadena de la voz ANTES del compresor del mix. Hace, todo
// automático (sin botones ni controles para el usuario):
//
//   1. Expansor / noise gate por RMS: el ruido ambiente y las respiraciones
//      viven muy por debajo del nivel de la voz cantada; por debajo del umbral
//      el procesador reduce la ganancia hasta un piso (no silencio total,
//      para que las transiciones no "bombeen").
//
//   2. Banda de transición con histéresis y ratio 2:1 entre UMBRAL_CIERRE y
//      UMBRAL_APERTURA para que la voz suave no se corte de golpe.
//
//   3. Envolvente con attack rápido / release lento y suavizado de ganancia
//      por muestra: sin clicks ni fondos removidos de forma audible.
//
// El paso-alto de gravedad/retumbos se hace con un BiquadFilterNode en el
// grafo principal (karaoke.js), este processor NO hace filtrado espectral.

const UMBRAL_APERTURA_DB = -26;   // por encima: voz abierta (ganancia 1) - la voz con maquillaje llega a ~-21 dB, abre sin problema
const UMBRAL_CIERRE_DB = -42;     // por debajo: gate cerrado (ganancia piso) - subido desde -50: con mics al 50% el ambiente de cuarto (~-50 dB) quedaba en la zona de transición y se oía
const PISO_DB = -55;              // ganancia mínima cuando está cerrado - bajado desde -38: antes el "cerrado" dejaba pasar ambiente audible
const RATIO = 3.0;                // expansor 3:1 en la transición (antes 2:1, muy suave para ambiente)

const ATTACK_S = 0.05;            // env sigue subidas un poco más lento (ataque de la voz)
const RELEASE_S = 0.4;            // env cae más rápido: antes 0.8 s mantenía el gate abierto entre frases y colaba ambiente
const G_ATTACK_S = 0.005;         // suavizado de ganancia al abrir
const G_RELEASE_S = 0.18;         // suavizado de ganancia al cerrar (antes 0.35: cola de ruido audible)

const PISO_LIN = Math.pow(10, PISO_DB / 20);

class VocalGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._sr = sampleRate;
    this._envDb = -70;
    this._gain = PISO_LIN; // coherente con _envDb inicial (gate cerrado)
    // FIX: la ganancia se suaviza POR MUESTRA, así que su coeficiente tiene
    // que ser por muestra. Antes se usaba el coeficiente por bloque (B=128) y
    // el "release de 180 ms" se completaba en ~68 muestras (≈1.4 ms): el gate
    // cerraba de golpe entre frases (corte/bombeo audible).
    this._gAttackCoef = 1 - Math.exp(-1 / (this._sr * G_ATTACK_S));
    this._gReleaseCoef = 1 - Math.exp(-1 / (this._sr * G_RELEASE_S));
  }

  // Coeficiente POR BLOQUE para la envolvente de nivel (se actualiza una sola
  // vez por process): depende del blockSize real, no de un 128 fijo.
  _envCoef(blockSize, subiendo) {
    const t = subiendo ? ATTACK_S : RELEASE_S;
    return 1 - Math.exp(-blockSize / (this._sr * t));
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output || !output[0]) {
      // Rellenar con ceros: si no, queda basura/cola anterior en la salida.
      if (output) {
        for (let c = 0; c < output.length; c++) {
          if (output[c]) output[c].fill(0);
        }
      }
      return true;
    }

    const blockSize = output[0] ? output[0].length : 128;

    // 1. RMS del bloque sobre TODOS los canales (antes solo canal 0: una voz
    // paneada a R con L en silencio cerraba el gate por error). Se toman
    // hasta blockSize muestras por canal y se ignoran no-finitos para que un
    // NaN no envenene la envolvente y cierre el gate ~0.8 s.
    let sum = 0;
    let count = 0;
    for (let c = 0; c < input.length; c++) {
      const ch = input[c];
      if (!ch) continue;
      const n = Math.min(ch.length, blockSize);
      for (let i = 0; i < n; i++) {
        const s = ch[i];
        if (!Number.isFinite(s)) continue;
        sum += s * s;
        count++;
      }
    }
    const rms = count > 0 ? Math.sqrt(sum / count) : 0;

    // 2. Envolvente de nivel en dB (attack rápido, release lento). Si el rms
    // no es finito se conserva la envolvente previa en vez de caer a -100.
    const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -100;
    if (Number.isFinite(rmsDb)) {
      const coef = this._envCoef(blockSize, rmsDb > this._envDb);
      this._envDb += (rmsDb - this._envDb) * coef;
    }

    // 3. Ganancia objetivo según curva gate/expansor
    let targetG;
    if (this._envDb > UMBRAL_APERTURA_DB) {
      targetG = 1;
    } else if (this._envDb < UMBRAL_CIERRE_DB) {
      targetG = PISO_LIN;
    } else {
      const gDb = -(UMBRAL_APERTURA_DB - this._envDb) / RATIO;
      targetG = Math.pow(10, gDb / 20);
    }

    // 4. Aplico la ganancia con suavizado por muestra (sin clicks).
    // Se itera sobre el mínimo de longitudes y se rellena con 0: longitudes
    // dispares daban undefined*gain = NaN en la salida.
    if (!Number.isFinite(this._gain)) this._gain = 1;
    const gCoef = targetG > this._gain ? this._gAttackCoef : this._gReleaseCoef;
    const outCount = output.length;
    const firstIn = input[0] === undefined ? output[0] : input[0];

    for (let i = 0; i < blockSize; i++) {
      this._gain += (targetG - this._gain) * gCoef;
      for (let c = 0; c < outCount; c++) {
        const src = c < input.length ? input[c] : firstIn;
        const v = src && i < src.length ? src[i] : 0;
        output[c][i] = Number.isFinite(v) ? v * this._gain : 0;
      }
    }

    return true;
  }
}

registerProcessor("vocal-gate-processor", VocalGateProcessor);
