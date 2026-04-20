import { useState, useRef } from 'react';
import type { CaptionCue } from '@/utils/captionParser';
import { transcribeAndScore } from '@/services/speechScoring';
import type { SpeakingScore } from '@/services/speechScoring';

export type SpeakingPhase = 'ready' | 'recording' | 'scoring' | 'result';

export interface SpeakingState {
  cue: CaptionCue;
  cueIdx: number;
  phase: SpeakingPhase;
  result: SpeakingScore | null;
  recordingBlob: Blob | null;
  micStream: MediaStream | null;
}

export function useSpeakingMode(cues: CaptionCue[]) {
  const [speakingState, setSpeakingState] = useState<SpeakingState | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  function open(cueIdx: number) {
    const cue = cues[cueIdx];
    if (!cue) return;
    setSpeakingState({ cue, cueIdx, phase: 'ready', result: null, recordingBlob: null, micStream: null });
  }

  function close() {
    stopRecording();
    setSpeakingState(null);
  }

  function goToCue(idx: number) {
    const cue = cues[idx];
    if (!cue) return;
    stopRecording();
    setSpeakingState({ cue, cueIdx: idx, phase: 'ready', result: null, recordingBlob: null, micStream: null });
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
        prev ? { ...prev, phase: 'recording', recordingBlob: null, result: null, micStream: stream } : null,
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
      const result = await transcribeAndScore(blob, state.cue.text);
      setSpeakingState((prev) =>
        prev ? { ...prev, phase: 'result', result } : null,
      );
    } catch (err) {
      console.error('Scoring failed:', err);
      setSpeakingState((prev) =>
        prev ? { ...prev, phase: 'ready' } : null,
      );
    }
  }

  function retry() {
    setSpeakingState((prev) =>
      prev ? { ...prev, phase: 'ready', result: null, recordingBlob: null } : null,
    );
  }

  return {
    speakingState,
    open,
    close,
    goToCue,
    startRecording,
    stopRecording,
    retry,
  };
}
