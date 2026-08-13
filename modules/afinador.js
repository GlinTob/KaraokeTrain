async function startAfinador() {
  const canvas = $("agujaCanvas");
  if (canvas) {
    agujaVivaInstance = new AgujaViva(canvas);
    const targetNoteEl = $("targetNote");
    const difficultyEl = $("afinadorDifficulty");

    if (targetNoteEl) agujaVivaInstance.setTargetNote(targetNoteEl.value);
    if (difficultyEl) agujaVivaInstance.setDifficulty(difficultyEl.value);

    if (targetNoteEl) {
      targetNoteEl.onchange = () => agujaVivaInstance.setTargetNote(targetNoteEl.value);
    }
    if (difficultyEl) {
      difficultyEl.onchange = () => agujaVivaInstance.setDifficulty(difficultyEl.value);
    }
    agujaVivaInstance.start();
  }

  audioContext = new (window.AudioContext || window.webkitAudioContext)();

  // 1. Reactivar el audio si el navegador lo dejó suspendido
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  });

  const mic = audioContext.createMediaStreamSource(stream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  mic.connect(analyser);

  setTimeout(() => {
    runPitchDetectionLoop();
  }, 300);
}

async function runPitchDetectionLoop() {
  if (!state.isRecording || !analyser || !audioContext) return;
  analyser.getFloatTimeDomainData(pitchBuffer);

  try {
    const audioController = getAudioController();
    const result = await audioController.detectPitch(pitchBuffer, audioContext.sampleRate);

    const guideText = $("guideText");
    const noteDisplay = $("currentNoteDisplay");
    const centsDisplay = $("centsDisplay");

    if (agujaVivaInstance) {
      if (result && result.pitch && result.pitch > 0) {
        agujaVivaInstance.setPitch(result.pitch);

        // 2. Actualizar el texto en pantalla al recibir tono
        if (guideText) guideText.textContent = `🎤 Escuchando (${Math.round(result.pitch)} Hz)`;
        if (noteDisplay && result.note) noteDisplay.textContent = result.note;
        if (centsDisplay && result.cents !== undefined) {
          centsDisplay.textContent = `${result.cents > 0 ? '+' : ''}${Math.round(result.cents)}¢`;
        }

      } else {
        agujaVivaInstance.setPitch(-1);
        if (guideText) guideText.textContent = "🎤 Esperando voz...";
      }
    }
  } catch (error) {
    console.error("Fallo en bucle de detección:", error);
  }

  if (state.isRecording) {
    pitchLoopTimeout = setTimeout(runPitchDetectionLoop, 16);
  }
}
