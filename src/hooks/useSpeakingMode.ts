import { useState, useRef, useCallback } from 'react';
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
  error: string | null;
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
  // Use a ref to access current state in async callbacks (avoids stale closure)
  const stateRef = useRef<SpeakingState | null>(null);
  stateRef.current = speakingState;
  // Guard: prevent onstop handler from firing after manual cleanup
  const recordingActiveRef = useRef(false);

  function open(cueIdx: number) {
    const cue = cues[cueIdx];
    if (!cue) return;
    setSpeakingState({
      cue, cueIdx, phase: 'ready', result: null, recordingBlob: null, micStream: null, error: null,
      wordMode: false, targetWord: null, wordResult: null,
    });
  }

  function close() {
    cleanupRecording();
    setSpeakingState(null);
  }

  function goToCue(idx: number) {
    const cue = cues[idx];
    if (!cue) return;
    cleanupRecording();
    setSpeakingState({
      cue, cueIdx: idx, phase: 'ready', result: null, recordingBlob: null, micStream: null, error: null,
      wordMode: false, targetWord: null, wordResult: null,
    });
  }

  function openWord(word: string) {
    cleanupRecording();
    setSpeakingState((prev) =>
      prev ? {
        ...prev, phase: 'ready', result: null, recordingBlob: null, micStream: null, error: null,
        wordMode: true, targetWord: word, wordResult: null,
      } : null,
    );
  }

  function exitWordMode() {
    cleanupRecording();
    setSpeakingState((prev) =>
      prev ? {
        ...prev, phase: 'ready', result: null, recordingBlob: null, micStream: null, error: null,
        wordMode: false, targetWord: null, wordResult: null,
      } : null,
    );
  }

  /**
   * Hard cleanup: kill recorder + stream without triggering onstop submission.
   * Used when navigating away, switching modes, etc.
   */
  function cleanupRecording() {
    recordingActiveRef.current = false;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      // Remove onstop handler BEFORE stopping to prevent ghost submissions
      recorder.onstop = null;
      recorder.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }

  const startRecording = useCallback(async () => {
    // Clean up any leftover recording state
    cleanupRecording();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      console.error('Microphone access denied:', err);
      const msg = err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Microphone access denied. Please allow microphone permission in your browser settings.'
        : err instanceof DOMException && err.name === 'NotFoundError'
          ? 'No microphone found. Please connect a microphone and try again.'
          : 'Could not access microphone. Please check your browser settings.';
      setSpeakingState((prev) =>
        prev ? { ...prev, error: msg } : null,
      );
      return;
    }

    // Verify the stream has active audio tracks
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0 || !audioTracks[0].enabled) {
      console.error('No active audio tracks in stream');
      stream.getTracks().forEach((t) => t.stop());
      setSpeakingState((prev) =>
        prev ? { ...prev, error: 'Microphone stream has no active audio tracks.' } : null,
      );
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    recordingActiveRef.current = true;

    // Pick a supported mimeType: webm (Chrome/Firefox) or mp4 (Safari)
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4;codecs=aac')
          ? 'audio/mp4;codecs=aac'
          : MediaRecorder.isTypeSupported('audio/mp4')
            ? 'audio/mp4'
            : undefined;

    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch (err) {
      console.error('MediaRecorder creation failed:', err);
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recordingActiveRef.current = false;
      setSpeakingState((prev) =>
        prev ? { ...prev, error: 'Could not start recording. Your browser may not support audio recording.' } : null,
      );
      return;
    }

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      // Guard: if recording was cleaned up (navigation, mode switch), don't submit
      if (!recordingActiveRef.current) return;
      recordingActiveRef.current = false;

      const actualType = recorder.mimeType || mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type: actualType });

      // Guard: don't send empty recordings to the backend
      if (blob.size < 100) {
        console.warn('Recording produced empty or tiny blob, skipping submission');
        setSpeakingState((prev) =>
          prev ? { ...prev, phase: 'ready', error: 'Recording was too short or empty. Please try again and speak clearly.' } : null,
        );
        return;
      }

      setSpeakingState((prev) =>
        prev ? { ...prev, phase: 'scoring', recordingBlob: blob, error: null } : null,
      );

      // Read state from ref to avoid stale closure
      const currentState = stateRef.current;
      if (!currentState) return;

      const submit = async () => {
        try {
          if (currentState.wordMode && currentState.targetWord) {
            const wordResult = await transcribeAndScoreWord(blob, currentState.targetWord);
            setSpeakingState((prev) =>
              prev ? { ...prev, phase: 'result', wordResult } : null,
            );
          } else {
            const result = await transcribeAndScore(blob, currentState.cue.text);
            setSpeakingState((prev) =>
              prev ? { ...prev, phase: 'result', result } : null,
            );
          }
        } catch (err) {
          console.error('Scoring failed:', err);
          setSpeakingState((prev) =>
            prev ? { ...prev, phase: 'ready', error: 'Scoring failed. Please try recording again.' } : null,
          );
        }
      };
      void submit();
    };

    // Handle unexpected recorder errors
    recorder.onerror = (event) => {
      console.error('MediaRecorder error:', event);
      cleanupRecording();
      setSpeakingState((prev) =>
        prev ? { ...prev, phase: 'ready', error: 'Recording error occurred. Please try again.' } : null,
      );
    };

    mediaRecorderRef.current = recorder;

    try {
      // Use timeslice to collect chunks periodically (avoids empty blob on some browsers)
      recorder.start(250);
    } catch (err) {
      console.error('recorder.start() failed:', err);
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      mediaRecorderRef.current = null;
      recordingActiveRef.current = false;
      setSpeakingState((prev) =>
        prev ? { ...prev, error: 'Could not start recording.' } : null,
      );
      return;
    }

    setSpeakingState((prev) =>
      prev ? { ...prev, phase: 'recording', recordingBlob: null, result: null, wordResult: null, micStream: stream, error: null } : null,
    );
  }, []);

  /**
   * User-initiated stop: stop the recorder and let onstop handle submission.
   * Stream tracks are kept alive until onstop fires.
   */
  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state === 'recording') {
      // Request final data chunk before stopping
      try {
        recorder.requestData();
      } catch {
        // requestData may throw if recorder is in wrong state; ignore
      }
      recorder.stop();
    }
    // Stop stream tracks AFTER recorder.stop() so onstop can still access the data
    // Use a small delay to ensure the final ondataavailable fires
    const stream = streamRef.current;
    if (stream) {
      setTimeout(() => {
        stream.getTracks().forEach((t) => t.stop());
      }, 100);
    }
    streamRef.current = null;
    mediaRecorderRef.current = null;
  }

  function retry() {
    cleanupRecording();
    setSpeakingState((prev) =>
      prev ? { ...prev, phase: 'ready', result: null, wordResult: null, recordingBlob: null, error: null } : null,
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
