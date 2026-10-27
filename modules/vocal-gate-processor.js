// ==========================================
// VOCAL GATE PROCESSOR — Limpieza automática de voz
// ==========================================
//
// Se inserta en la cadena de la voz ANTES del compresor del mix. Hace, todo
// automático (sin botones ni controles para el usuario):
//
//   1. Expansor descendente CONTINUO por RMS: por debajo del umbral atenúa el
//      ambiente de forma progresiva (1.5 dB por dB) hasta un piso de -18 dB.
//      NO hay escalón en la ley de ganancia. La versión anterior saltaba de
//      -5 dB a -55 dB al cruzar el umbral de cierre (-42 dB) y eso se oía como
//      bombeo: el volumen subía y bajaba sílaba a sílaba, sobre todo en voces
//      flojas o grabadas con poca ganancia de entrada.
//
//   2. Envolvente con attack rápido, release lento y HOLD: entre sílabas la
//      env no cae durante 120 ms, así el gate no "respira" al ritmo del canto.
//
//   3. Suavizado de ganancia POR MUESTRA: sin clicks ni escalones.
//
// El paso-alto de retumbos se hace con un BiquadFilterNode en el grafo
// principal (karaoke.js); este processor NO hace filtrado espectral.
//
// La cadena de karaoke.js normaliza la voz con una ganancia ESTÁTICA antes de
// este nodo: así el umbral significa lo mismo con cualquier micrófono y el AGC
// del navegador puede quedar apagado (el AGC era otra fuente de bombeo).

const UMBRAL_DB = -38;   // encima: ganancia 1 (la voz cantada no se toca)
const PISO_DB = -18;     // atenuación máxima del ambiente (antes -55: cortaba la voz)
const RATIO = 2.5;       // expansor 2.5:1 => 1.5 dB de atenuación por dB bajo el umbral

const ATTACK_S = 0.01;    // env sube rápido: abre en la primera sílaba
const RELEASE_S = 0.25;   // env cae tras el hold
const HOLD_S = 0.12;      // congela la caída entre sílabas (evita el "bombeo")
const G_ATTACK_S = 0.02;  // suavizado de ganancia al abrir
const G_RELEASE_S = 0.25; // suavizado de ganancia al atenuar

const PISO_LIN = Math.pow(10, PISO_DB / 20);

class VocalGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._sr = sampleRate;
    this._envDb = -70;
    this._holdLeft = 0;
    this._gain = PISO_LIN; // coherente con _envDb inicial (gate cerrado)
    // La ganancia se suaviza POR MUESTRA, así que su coeficiente tiene que ser
    // por muestra (antes se usaba el coeficiente por bloque y el "release de
    // 180 ms" se completaba en ~1.4 ms: el gate cerraba de golpe).
    this._gAttackCoef = 1 - Math.exp(-1 / (this._sr * G_ATTACK_S));
    this._gReleaseCoef = 1 - Math.exp(-1 / (this._sr * G_RELEASE_S));
  }

  // Coeficiente POR BLOQUE para la envolvente de nivel: depende del blockSize
  // real, no de un 128 fijo.
  _envCoef(blockSize, segundos) {
    return 1 - Math.exp(-blockSize / (this._sr * segundos));
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

    // 1. RMS del bloque sobre TODOS los canales: una voz paneada a R con L en
    // silencio no debe cerrar el gate por error. Se ignoran no-finitos para
    // que un NaN no envenene la envolvente.
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

    // 2. Envolvente de nivel en dB con attack / hold / release. Si el rms no es
    // finito se conserva la envolvente previa en vez de caer a -100.
    const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -100;
    if (Number.isFinite(rmsDb)) {
      if (rmsDb > this._envDb) {
        this._envDb += (rmsDb - this._envDb) * this._envCoef(blockSize, ATTACK_S);
        this._holdLeft = HOLD_S;
      } else if (this._holdLeft > 0) {
        // Hold: la envolvente no baja. Es lo que evita que la ganancia caiga
        // entre palabra y palabra y vuelva a subir en la siguiente.
        this._holdLeft = Math.max(0, this._holdLeft - blockSize / this._sr);
      } else {
        this._envDb += (rmsDb - this._envDb) * this._envCoef(blockSize, RELEASE_S);
      }
    }

    // 3. Ganancia objetivo: expansor CONTINUO (sin escalón) con piso.
    //    porDebajo = dB que la envolvente está bajo el umbral.
    //    targetDb  = -(RATIO - 1) * porDebajo  => 0 en el umbral, -1.5 dB por
    //    dB por debajo, y se aplana en PISO_DB (nunca hay salto).
    const porDebajo = UMBRAL_DB - this._envDb;
    let targetDb = porDebajo > 0 ? -(porDebajo * (RATIO - 1)) : 0;
    if (targetDb < PISO_DB) targetDb = PISO_DB;
    const targetG = Math.pow(10, targetDb / 20);

    // 4. Aplico la ganancia con suavizado por muestra (sin clicks). Se itera
    // sobre el mínimo de longitudes y se rellena con 0: longitudes dispares
    // daban undefined*gain = NaN en la salida.
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
