// Harness del pitch-shifter: alimenta el worklet con bloques de 128 muestras
// (estéreo idéntico, seno 440 Hz, +1 semitono) y verifica pitch, coherencia
// L/R y ausencia de NaN. Uso: npm test
// FIX #43: también inyecta sampleRate global (requerido por vocal-gate) y
// añade un test rápido de vocal-gate (noise gate por RMS).
const fs = require('fs');
const path = require('path');

function loadProcessor(file, extraGlobals = {}) {
  let Registered = null;
  const src = fs.readFileSync(file, 'utf8');
  // Inyectar globals requeridos (sampleRate, etc.) en el sandbox del worklet
  const fn = new Function('AudioWorkletProcessor', 'registerProcessor', 'console', 'sampleRate', 'currentTime', src);
  fn(class {}, (name, cls) => { Registered = cls; }, console, extraGlobals.sampleRate || 48000, extraGlobals.currentTime || 0);
  if (!Registered) throw new Error('No se registró ningún processor en ' + file);
  return Registered;
}

function zeroCrossingPitch(buf, sr) {
  let z = 0;
  for (let i = 1; i < buf.length; i++) {
    if ((buf[i - 1] < 0 && buf[i] >= 0) || (buf[i - 1] >= 0 && buf[i] < 0)) z++;
  }
  return z / 2 / (buf.length / sr);
}

function main() {
  const file = path.join(__dirname, '..', 'modules', 'pitch-shifter-processor.js');
  const Cls = loadProcessor(file, { sampleRate: 48000 });
  const proc = new Cls();
  const SR = 48000, F0 = 440, N = 48000, B = 128;
  const ratio = Math.pow(2, 1 / 12);
  const esperado = F0 * ratio;
  const inL = new Float32Array(N), inR = new Float32Array(N);
  const outL = new Float32Array(N), outR = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const v = 0.5 * Math.sin((2 * Math.PI * F0 * i) / SR);
    inL[i] = v;
    inR[i] = v;
  }
  const params = { pitchRatio: new Float32Array([ratio]) };
  for (let off = 0; off < N; off += B) {
    const ib = [inL.subarray(off, off + B), inR.subarray(off, off + B)];
    const ob = [new Float32Array(B), new Float32Array(B)];
    proc.process([ib], [ob], params);
    ob[0].forEach((v, i) => { outL[off + i] = v; });
    ob[1].forEach((v, i) => { outR[off + i] = v; });
  }
  const mL = outL.slice(8192), mR = outR.slice(8192);
  let nan = 0, maxDiff = 0;
  for (let i = 0; i < mL.length; i++) {
    if (!Number.isFinite(mL[i]) || !Number.isFinite(mR[i])) nan++;
    const d = Math.abs(mL[i] - mR[i]);
    if (d > maxDiff) maxDiff = d;
  }
  const pitch = zeroCrossingPitch(mL, SR);
  console.log(`pitch: ${pitch.toFixed(1)} Hz (esperado ${esperado.toFixed(1)}) | max|L-R|: ${maxDiff.toExponential(2)} | NaN: ${nan}`);
  const fallos = [];
  if (Math.abs(pitch - esperado) > 4) fallos.push(`pitch fuera de ±4 Hz (${pitch.toFixed(1)} vs ${esperado.toFixed(1)})`);
  if (maxDiff > 1e-6) fallos.push(`canales L/R divergen (${maxDiff})`);
  if (nan > 0) fallos.push(`${nan} muestras NaN/no-finitas`);
  if (fallos.length) {
    console.error('FALLO: ' + fallos.join(' · '));
    process.exit(1);
  }
  console.log('OK: pitch-shifter sane.');

  // ==========================================
  // TEST VOCAL-GATE (FIX #43)
  // ==========================================
  const gateFile = path.join(__dirname, '..', 'modules', 'vocal-gate-processor.js');
  if (fs.existsSync(gateFile)) {
    const GateCls = loadProcessor(gateFile, { sampleRate: 48000 });
    const gate = new GateCls();
    const gb = 128, gn = 4800;
    const gin = new Float32Array(gn), gout = new Float32Array(gn);
    // Señal de prueba: ruido bajo (debe cerrar) + tono fuerte (debe abrir)
    for (let i = 0; i < gn; i++) {
      gin[i] = i < gn / 2 ? 0.001 * Math.random() : 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48000);
    }
    const gparams = {};
    for (let off = 0; off < gn; off += gb) {
      const ib = [gin.subarray(off, off + gb)];
      const ob = [new Float32Array(gb)];
      gate.process([ib], [ob], gparams);
      ob[0].forEach((v, i) => { gout[off + i] = v; });
    }
    let gnan = 0;
    for (let i = 0; i < gn; i++) if (!Number.isFinite(gout[i])) gnan++;
    const rmsRuido = Math.sqrt(gout.slice(0, gn / 2).reduce((s, v) => s + v * v, 0) / (gn / 2));
    const rmsTono = Math.sqrt(gout.slice(gn / 2).reduce((s, v) => s + v * v, 0) / (gn / 2));
    console.log(`vocal-gate: RMS ruido=${rmsRuido.toExponential(2)} | RMS tono=${rmsTono.toFixed(3)} | NaN=${gnan}`);
    if (gnan > 0) {
      console.error('FALLO vocal-gate: muestras NaN');
      process.exit(1);
    }
    if (!(rmsTono > rmsRuido * 10)) {
      console.error('FALLO vocal-gate: el tono fuerte no pasó con ganancia suficiente');
      process.exit(1);
    }
    console.log('OK: vocal-gate sane.');
  } else {
    console.warn('AVISO: vocal-gate-processor.js no encontrado, se omite su test.');
  }
}

main();
