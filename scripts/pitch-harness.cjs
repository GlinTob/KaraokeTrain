// Harness del pitch-shifter: alimenta el worklet con bloques de 128 muestras
// (estéreo idéntico, seno 440 Hz, +1 semitono) y verifica pitch, coherencia
// L/R y ausencia de NaN. Uso: npm test
// Criterios: pitch ≈ f0·ratio (±4 Hz), L/R idénticos, 0 NaN.
const fs = require('fs');
const path = require('path');

function loadProcessor(file) {
  let Registered = null;
  const src = fs.readFileSync(file, 'utf8');
  const fn = new Function('AudioWorkletProcessor', 'registerProcessor', 'console', src);
  fn(class {}, (name, cls) => { Registered = cls; }, console);
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
  const Cls = loadProcessor(file);
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
}

main();
