import { getAudioController } from './audio-controller.js';
import { $ } from './utils.js';

const state = { isRecording: false };

let afinadorVisual = null;
let pitchDetectionInterval = null;
let renderRafId = null;
let audioContext = null;
// Verifica si todas las funcioneses del módulo están definidas

let stream = null;
let recordingSession = Date.now();

const PITCH_BUFFER_POOL = [];
const POOL_SIZE = 4;
const BUFFER_LENGTH = 2048;
function getPitchBuffer() { if (PITCH_BUFFER_POOL.length > 0) return PITCH_BUFFER_POOL.pop(); return new Float32Array(BUFFER_LENGTH); }
function releasePitchBuffer(buf) { if (PITCH_BUFFER_POOL.length < POOL_SIZE) PITCH_BUFFER_POOL.push(buf); }

function frequencyToCentsOff(freq, targetFreq) { return 1200 * Math.log2(freq / targetFreq); }
/**
 * @param {string|null|undefined} noteName - Note name in the format 'A#4'
 * @returns {number} - Frequency of the note in Hz
 * @throws {Error} - If the note name is invalid or null
 */
/**
 * Converts a note name to its corresponding frequency in Hz.
 * @param {string} noteName - Note name in the format 'A#4'
 * @returns {number} - Frequency of the note in Hz
 * @throws {Error} - If the note name is invalid or null
 */
  if (typeof noteName !== 'string' || noteName === null || noteName === undefined) {
    throw new Error('noteToFrequency expects a non-null string argument');
  }
  const notes: { [key: string]: number } = {
    C: 0, // El objeto notes necesita tener al menos un par de clave-valor para no lanzar un error.
    'C#': 1,
    D: 2,
    'D#': 3,
    E: 4,
    F: 5,
    'F#': 6,
    G: 7,
    'G#': 8,
    A: 9,
    'A#': 10,
    B: 11,
  };

  const matchResult = noteName.match(/^([A-G]#?)(\d+)$/);
  if (!matchResult) {
    throw new Error(`noteToFrequency: invalid note name '${noteName}'`);
  }

  const [_, note, octave] = matchResult;
  const semitonesFromA4 = (notes[note] - 9) + (parseInt(octave, 10) - 4) * 12;
  try {
    return 440 * Math.pow(2, semitonesFromA4 / 12);
  } catch (e) {
    console.error('noteToFrequency failed:', e);
    throw e;
  }
  if (!match) {
    throw new Error(`noteToFrequency: invalid note name '${noteName}'`);
  }

  const semitonesFromA4 = (notes[match[1]] - 9) + (parseInt(match[2], 10) - 4) * 12;
  try {
    return 440 * Math.pow(2, semitonesFromA4 / 12);
  } catch (e) {
    console.error('noteToFrequency failed:', e);
    throw e;
  }

  const semitonesFromA4 = (notes[match[1]] - 9) + (parseInt(match[2], 10) - 4) * 12;
  try {
    return 440 * Math.pow(2, semitonesFromA4 / 12);
  } catch (e) {
    console.error('noteToFrequency failed:', e);
    throw e;
  }
}

export async function toggleRecording() {
  const recordButton = document.querySelector('#recordBtn');
  if (!recordButton) return;

  const buttonTextElement = recordButton.querySelector('.btn-text');
  if (!buttonTextElement) return;

  try {
    if (!state.isRecording) {
      state.isRecording = true;
      buttonTextElement.textContent = 'Detener';
      recordButton.classList.add('recording');
      recordButton.setAttribute('aria-pressed', 'true');
      await startAfinador();
    } else {
      state.isRecording = false;
      buttonTextElement.textContent = 'Iniciar';
      recordButton.classList.remove('recording');
      recordButton.setAttribute('aria-pressed', 'false');
      await stopAfinador();
      resetAfinadorUI();
    }
  } catch (error) {
    console.error('Error toggling recording:', error);
    state.isRecording = false;
    buttonTextElement.textContent = 'Iniciar';
    recordButton.classList.remove('recording');
    recordButton.setAttribute('aria-pressed', 'false');
    alert(`Error toggling recording: ${error.message}`);
    await stopAfinador();
    resetAfinadorUI();

function resetAfinadorUIElements() {
  const currentNoteDisplay = document.getElementById('currentNoteDisplay');
  const centsDisplay = document.getElementById('centsDisplay');
  const guideText = document.getElementById('guideText');

  if (currentNoteDisplay) {
    currentNoteDisplay.textContent = '--';
    currentNoteDisplay.className = 'current-note state-idle';
  }

  if (centsDisplay) {
    centsDisplay.textContent = '';
    centsDisplay.className = 'cents-display';
  }

  if (guideText) {
    guideText.textContent = 'Esperando voz...';
    guideText.className = 'guide-text';
  }
}

async function startAfinador() {
  const session = recordingSession;
  const pitchBuffer = getPitchBuffer();

  if (afinadorVisual) {
    afinadorVisual.destroy();
    afinadorVisual = null;
  }

  const canvas = $('agujaCanvas');
  if (canvas) {
    afinadorVisual = new AfinadorVisual(canvas);
    const targetNoteEl = $('targetNote');
    const difficultyEl = $('afinadorDifficulty');
    if (targetNoteEl) afinadorVisual.setTargetNote(targetNoteEl.value);
    if (difficultyEl) afinadorVisual.setDifficulty(difficultyEl.value);
    if (targetNoteEl) {
    targetNoteElement.addEventListener('change', () => {
      if (afinadorVisual) afinadorVisual.setTargetNote(targetNoteElement.value);
    });
    }
    if (difficultyEl) {
    difficultyElement.addEventListener('change', () => {
      if (afinadorVisual) afinadorVisual.setDifficulty(difficultyElement.value);
    });
    }
    afinadorVisual.start();
  }

  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  try {
    if (session !== recordingSession) { audioContext.close().catch(() => {}); audioContext = null; return; }
    if (audioContext.state === 'suspended') await audioContext.resume();
    if (session !== recordingSession) { audioContext.close().catch(() => {}); audioContext = null; return; }
  } catch (error) {
    console.error('Error inicando el AudioContext:', error);
    return;
  }

  try {
    if (session !== recordingSession) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
      if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
      return;
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
  } catch (error) {
    console.error('Error obteniendo el stream:', error);
    return;
  }

  const mic = audioContext.createMediaStreamSource(stream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  mic.connect(analyser);

  let frameCount = 0;
  const detectPitchFrame = async () => {
    if (!state.isRecording || session !== recordingSession || !analyser) {
      releasePitchBuffer(pitchBuffer);
      return;
    }

    try {
      analyser.getFloatTimeDomainData(pitchBuffer);
      const frameCopy = new Float32Array(pitchBuffer);
      const pitchResult = await getAudioController().detectPitch(frameCopy, audioContext.sampleRate);
      if (!state.isRecording || session !== recordingSession || !analyser) return;

      const noteDisplayElement = $('currentNoteDisplay');
      const centsDisplayElement = $('centsDisplay');
      const guideTextElement = $('guideText');

      if (typeof pitchResult === 'number' && pitchResult > 0) {
        const detectedNoteName = frequencyToNoteName(pitchResult);
        const targetNoteName = ($('targetNote') || {}).value || 'E2';
        const targetFrequency = noteToFrequency(targetNoteName);
        const centsOff = frequencyToCentsOff(pitchResult, targetFrequency);

        if (noteDisplayElement) {
          noteDisplayElement.textContent = detectedNoteName;
          noteDisplayElement.className = 'current-note state-active';
        }
        if (centsDisplayElement) {
          const roundedCents = Math.round(centsOff);
          centsDisplayElement.textContent = (roundedCents > 0 ? '+' : '') + roundedCents + '¢';
          centsDisplayElement.className = 'cents-display';
        }
        if (guideTextElement) {
          const level = ($('afinadorDifficulty') || {}).value || 'medio';
          const tolerances = { facil: 50, medio: 30, dificil: 15, experto: 5 };
          const tolerance = tolerances[level] || 30;
          if (Math.abs(centsOff) <= Math.max(6, tolerance * 0.35)) {
            guideTextElement.textContent = 'Afinado';
            guideTextElement.className = 'guide-text state-good';
          } else if (centsOff < 0) {
            guideTextElement.textContent = 'Sube la voz';
            guideTextElement.className = 'guide-text state-low';
          } else {
            guideTextElement.textContent = 'Baja la voz';
            guideTextElement.className = 'guide-text state-high';
          }
        }
      } else {
        if (noteDisplayElement) {
          noteDisplayElement.textContent = '--';
          noteDisplayElement.className = 'current-note state-idle';
        }
        if (centsDisplayElement) {
          centsDisplayElement.textContent = '';
          centsDisplayElement.className = 'cents-display';
        }
        if (guideTextElement) {
          guideTextElement.textContent = 'Esperando voz...';
          guideTextElement.className = 'guide-text';
        }
      }
    } catch (error) {
      console.error('Error deteccion:', error);
    }

    frameCount++;
    if (state.isRecording && session === recordingSession) {
      pitchDetectionInterval = setTimeout(detectPitchFrame, 33);
    }
  }
  setTimeout(detectFrame, 200);

function stopAfinador() {
  if (pitchDetectionInterval) { clearTimeout(pitchDetectionInterval); pitchDetectionInterval = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
  analyser = null;
  if (afinadorVisual) { afinadorVisual.destroy(); afinadorVisual = null; }
