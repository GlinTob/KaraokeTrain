// liveAudioService.js - SERVICIO DE CAPTURA EN VIVO DE MICROFONO Y PROCESADORES

let audioCtx = null;
let stream = null;
let micSource = null;
let vocalNode = null;
let shifterNode = null;
let analyserNode = null;

export async function startLiveAudio() {
  // Evitamos duplicar el contexto de audio si ya está encendido
  if (audioCtx && audioCtx.state !== 'closed') return { analyser: analyserNode, shifter: shifterNode };

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  
  // Solicitamos acceso al hardware del micrófono
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false
    }
  });

  micSource = audioCtx.createMediaStreamSource(stream);
  analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = 2048;

  try {
    // Cargamos los módulos de los AudioWorklets que creaste
    await audioCtx.audioWorklet.addModule(new URL('./vocal-processor.js', import.meta.url));
    await audioCtx.audioWorklet.addModule(new URL('./pitch-shifter-processor.js', import.meta.url));

    vocalNode = new AudioWorkletNode(audioCtx, 'vocal-processor');
    shifterNode = new AudioWorkletNode(audioCtx, 'pitch-shifter-processor');

    // CONEXIÓN EN CADENA:
    // Micrófono -> Ecualizador/Gate (Vocal) -> Cambiador de Tono -> Analizador de Frecuencias -> Parlantes
    micSource.connect(vocalNode);
    vocalNode.connect(shifterNode);
    shifterNode.connect(analyserNode);
    analyserNode.connect(audioCtx.destination);

  } catch (error) {
    console.warn("No se pudieron cargar los AudioWorklets, usando conexión directa de respaldo:", error);
    // Respaldo en caso de que falle el registro de los procesadores
    micSource.connect(analyserNode);
    analyserNode.connect(audioCtx.destination);
  }

  return { analyser: analyserNode, shifter: shifterNode };
}

export function stopLiveAudio() {
  // Apagamos los componentes y liberamos el micrófono por completo
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }
  micSource = null;
  vocalNode = null;
  shifterNode = null;
  analyserNode = null;
}
