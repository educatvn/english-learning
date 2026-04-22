import { useState, useRef } from 'react';
import type { CaptionCue } from '@/utils/captionParser';
import { transcribeAndScore, transcribeAndScoreWord } from '@/services/speechScoring';
import type { SpeakingScore, WordScore } from '@/services/speechScoring';

export type SpeakingPhase = 'ready' | 'recording' | 'scoring' | 'result';

export interface SpeakingState {
  cue: CaptionCue;
  cueIdx: number;
  phase: SpeakingPhase;
  result: SpeakingScore | null;
  recordingBlob: Blob | null;
  micStream: MediaStream | null;
  // Word practice mode
  wordMode: boolean;
  targetWord: string | null;
  wordResult: WordScore | null;
}

export function useSpeakingMode(cues: CaptionCue[]) {
  const [speakingState, setSpeakingState] = useState<SpeakingState | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  function open(cueIdx: number) {
    const cue = cues[cueIdx];
    if (!cue) return;
    setSpeakingState({
      cue, cueIdx, phase: 'ready', result: null, recordingBlob: null, micStream: null,
      wordMode: false, targetWord: null, wordResult: null,
    });
  }

  function close() {
    stopRecording();
    setSpeakingState(null);
  }

  function goToCue(idx: number) {
    const cue = cues[idx];
    if (!cue) return;
    stopRecording();
    setSpeakingState({
      cue, cueIdx: idx, phase: 'ready', result: null, recordingBlob: null, micStream: null,
      wordMode: false, targetWord: null, wordResult: null,
    });
  }

  function openWord(word: string) {
    setSpeakingState((prev) =>
      prev ? {
        ...prev, phase: 'ready', result: null, recordingBlob: null, micStream: null,
        wordMode: true, targetWord: word, wordResult: null,
      } : null,
    );
  }

  function exitWordMode() {
    stopRecording();
    setSpeakingState((prev) =>
      prev ? {
        ...prev, phase: 'ready', result: null, recordingBlob: null, micStream: null,
        wordMode: false, targetWord: null, wordResult: null,
      } : null,
    );
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setSpeakingState((prev) =>
          prev ? { ...prev, phase: 'scoring', recordingBlob: blob } : null,
        );
        void submitRecording(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();

      setSpeakingState((prev) =>
        prev ? { ...prev, phase: 'recording', recordingBlob: null, result: null, wordResult: null, micStream: stream } : null,
      );
    } catch (err) {
      console.error('Microphone access denied:', err);
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
  }

  async function submitRecording(blob: Blob) {
    const state = speakingState;
    if (!state) return;

    try {
      if (state.wordMode && state.targetWord) {
        const wordResult = await transcribeAndScoreWord(blob, state.targetWord);
        setSpeakingState((prev) =>
          prev ? { ...prev, phase: 'result', wordResult } : null,
        );
      } else {
        const result = await transcribeAndScore(blob, state.cue.text);
        setSpeakingState((prev) =>
          prev ? { ...prev, phase: 'result', result } : null,
        );
      }
    } catch (err) {
      console.error('Scoring failed:', err);
      setSpeakingState((prev) =>
        prev ? { ...prev, phase: 'ready' } : null,
      );
    }
  }

  function retry() {
    setSpeakingState((prev) =>
      prev ? { ...prev, phase: 'ready', result: null, wordResult: null, recordingBlob: null } : null,
    );
  }

  return {
    speakingState,
    open,
    close,
    goToCue,
    openWord,
    exitWordMode,
    startRecording,
    stopRecording,
    retry,
  };
}
