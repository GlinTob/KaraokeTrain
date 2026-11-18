// scripts/test-audio.mjs
// Tests unitarios de funciones de audio puras (sin build, sin framework).
// Correr con: node scripts/test-audio.mjs

// Mock mínimo de entorno de navegador para que Node pueda cargar módulos
// que importan config.js / karaoke.js (usan `window`). No afecta la app real.
if (typeof window === 'undefined') {
  const listeners = {};
  globalThis.window = {
    addEventListener: (type, handler) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(handler);
    },
    removeEventListener: (type, handler) => {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((h) => h !== handler);
    },
    dispatchEvent: (event) => {
      const type = event.type || event;
      (listeners[type] || []).forEach((h) => h(event));
    },
  };
}

async function main() {
  const assert = await import('node:assert');

  const {
    noteToFrequency,
    frequencyToMidi,
    midiToNoteName,
    frequencyToNoteName,
  } = await import('../modules/afinador.js');

  const {
    rmsOfAudioBuffer,
    singingRmsOfBuffer,
    computeVoiceNormGain,
    peakOfBuffer,
    applyStaticGain,
  } = await import('../modules/karaoke.js');

  // --- Mock mínimo de AudioBuffer (solo lo que usan estas funciones) ---
  function crearBufferMock(samples, sampleRate = 44100) {
    const data = new Float32Array(samples);
    return {
      numberOfChannels: 1,
      length: data.length,
      duration: data.length / sampleRate,
      sampleRate,
      getChannelData: () => data,
    };
  }

  let pasados = 0;
  let fallidos = 0;

  function test(nombre, fn) {
    try {
      fn();
      pasados++;
      console.log(`✅ ${nombre}`);
    } catch (err) {
      fallidos++;
      console.error(`❌ ${nombre}: ${err.message}`);
    }
  }

  function cercaDe(actual, esperado, tol = 1e-6) {
    assert.ok(
      Math.abs(actual - esperado) <= tol,
      `esperaba ~${esperado}, obtuve ${actual}`
    );
  }

  // ---------- afinador.js ----------
  test('noteToFrequency: A4 = 440 Hz', () => {
    cercaDe(noteToFrequency('A4'), 440);
  });

  test('noteToFrequency: E2 ≈ 82.41 Hz', () => {
    cercaDe(noteToFrequency('E2'), 82.41, 0.01);
  });

  test('noteToFrequency: nota inválida devuelve E2 (82.41 Hz)', () => {
    assert.strictEqual(noteToFrequency('XYZ'), 82.41);
  });

  test('frequencyToMidi: 440 Hz = 69', () => {
    assert.strictEqual(frequencyToMidi(440), 69);
  });

  test('frequencyToMidi: 0, negativo o NaN devuelven null', () => {
    assert.strictEqual(frequencyToMidi(0), null);
    assert.strictEqual(frequencyToMidi(-10), null);
    assert.strictEqual(frequencyToMidi(NaN), null);
  });

  test('midiToNoteName: 69 = A4', () => {
    assert.strictEqual(midiToNoteName(69), 'A4');
  });

  test('frequencyToNoteName: 440 = A4', () => {
    assert.strictEqual(frequencyToNoteName(440), 'A4');
  });

  // ---------- karaoke.js ----------
  test('rmsOfAudioBuffer: silencio = 0', () => {
    const buf = crearBufferMock([0, 0, 0, 0]);
    assert.strictEqual(rmsOfAudioBuffer(buf), 0);
  });

  test('rmsOfAudioBuffer: tono constante 0.5 = 0.5', () => {
    const buf = crearBufferMock([0.5, 0.5, 0.5]);
    assert.strictEqual(rmsOfAudioBuffer(buf), 0.5);
  });

  test('computeVoiceNormGain: silencio = 1 (no amplificar ruido de fondo)', () => {
    const buf = crearBufferMock(new Array(44100).fill(0));
    assert.strictEqual(computeVoiceNormGain(buf), 1);
  });

  test('computeVoiceNormGain: voz baja se satura en ×16', () => {
    const buf = crearBufferMock(new Array(44100).fill(0.002));
    assert.strictEqual(computeVoiceNormGain(buf), 16);
  });

  test('computeVoiceNormGain: voz normal ≈ 0.06 / rms', () => {
    const rms = 0.03;
    const buf = crearBufferMock(new Array(44100).fill(rms));
    cercaDe(computeVoiceNormGain(buf), 0.06 / rms);
  });

  test('peakOfBuffer: captura pico absoluto (negativo o positivo)', () => {
    const buf = crearBufferMock([-0.8, 0.3, 0.5]);
    cercaDe(peakOfBuffer(buf), 0.8);
  });

  test('applyStaticGain: multiplica in-place', () => {
    const data = new Float32Array([0.1, 0.2, 0.3]);
    const buf = crearBufferMock(data);
    applyStaticGain(buf, 2);
    cercaDe(buf.getChannelData(0)[0], 0.2);
    cercaDe(buf.getChannelData(0)[2], 0.6);
  });

  test('applyStaticGain: gain = 1 no modifica nada', () => {
    const data = new Float32Array([0.1, 0.2]);
    const buf = crearBufferMock(data);
    applyStaticGain(buf, 1);
    cercaDe(buf.getChannelData(0)[1], 0.2);
  });

  // ---------- resumen ----------
  console.log(`\n${pasados} pasados, ${fallidos} fallidos`);
  process.exitCode = fallidos > 0 ? 1 : 0;
}

main();
