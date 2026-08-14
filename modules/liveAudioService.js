// liveAudioService.js - SERVICIO DE CAPTURA EN VIVO DE MICRÓFONO Y PROCESADORES

let audioCtx = null;
let stream = null;
let micSource = null;
let vocalNode = null;
let shifterNode = null;
let analyserNode = null;
let monitorGainNode = null;
let usingFallback = false;

function hasActiveAudioStream(currentStream) {
  return !!(
    currentStream &&
    currentStream.getAudioTracks &&
    currentStream.getAudioTracks().some(track => track.readyState === "live")
  );
}

function safeDisconnect(node) {
  if (!node) return;
  try {
    node.disconnect();
  } catch (_) {}
}

export async function startLiveAudio(options = {}) {
  const {
    deviceId = null,
    monitor = false,
    echoCancellation = true,
    noiseSuppression = true,
    autoGainControl = false
  } = options;

  // Si ya existe una sesión viva, la reutilizamos
  if (audioCtx && audioCtx.state !== "closed" && hasActiveAudioStream(stream) && analyserNode) {
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }
    return {
      analyser: analyserNode,
      shifter: shifterNode,
      vocal: vocalNode,
      audioContext: audioCtx,
      stream,
      usingFallback
    };
  }

  // Si hay residuos de una sesión anterior, limpiamos antes de reiniciar
  await stopLiveAudio();

  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }

    const audioConstraints = {
      echoCancellation,
      noiseSuppression,
      autoGainControl
    };

    if (deviceId) {
      audioConstraints.deviceId = { exact: deviceId };
    }

    stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints
    });

    micSource = audioCtx.createMediaStreamSource(stream);

    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 2048;

    monitorGainNode = audioCtx.createGain();
    monitorGainNode.gain.value = monitor ? 1 : 0;

    usingFallback = false;

    try {
      await audioCtx.audioWorklet.addModule(
        new URL("./vocal-processor.js", import.meta.url)
      );
      await audioCtx.audioWorklet.addModule(
        new URL("./pitch-shifter-processor.js", import.meta.url)
      );

      vocalNode = new AudioWorkletNode(audioCtx, "vocal-processor");
      shifterNode = new AudioWorkletNode(audioCtx, "pitch-shifter-processor");

      // Cadena:
      // Mic -> Vocal -> Pitch Shifter -> Analyser -> MonitorGain -> Destination
      micSource.connect(vocalNode);
      vocalNode.connect(shifterNode);
      shifterNode.connect(analyserNode);
      analyserNode.connect(monitorGainNode);
      monitorGainNode.connect(audioCtx.destination);

    } catch (error) {
      usingFallback = true;
      console.warn(
        "No se pudieron cargar los AudioWorklets, usando conexión directa de respaldo:",
        error
      );

      vocalNode = null;
      shifterNode = null;

      micSource.connect(analyserNode);
      analyserNode.connect(monitorGainNode);
      monitorGainNode.connect(audioCtx.destination);
    }

    return {
      analyser: analyserNode,
      shifter: shifterNode,
      vocal: vocalNode,
      audioContext: audioCtx,
      stream,
      usingFallback
    };
  } catch (error) {
    console.error("Error al iniciar audio en vivo:", error);
    await stopLiveAudio();
    throw new Error(`No se pudo iniciar el audio en vivo: ${error.message}`);
  }
}

export async function stopLiveAudio() {
  safeDisconnect(micSource);
  safeDisconnect(vocalNode);
  safeDisconnect(shifterNode);
  safeDisconnect(analyserNode);
  safeDisconnect(monitorGainNode);

  if (stream) {
    stream.getTracks().forEach(track => {
      try {
        track.stop();
      } catch (_) {}
    });
    stream = null;
  }

  if (audioCtx) {
    try {
      if (audioCtx.state !== "closed") {
        await audioCtx.close();
      }
    } catch (_) {}
    audioCtx = null;
  }

  micSource = null;
  vocalNode = null;
  shifterNode = null;
  analyserNode = null;
  monitorGainNode = null;
  usingFallback = false;
}

export function getLiveAudioState() {
  return {
    audioCtx,
    stream,
    micSource,
    vocalNode,
    shifterNode,
    analyserNode,
    monitorGainNode,
    usingFallback,
    isRunning: !!audioCtx && audioCtx.state !== "closed" && hasActiveAudioStream(stream)
  };
}

export function setMonitoringEnabled(enabled) {
  if (monitorGainNode) {
    monitorGainNode.gain.value = enabled ? 1 : 0;
  }
}
