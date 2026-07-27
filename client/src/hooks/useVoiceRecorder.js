import { useCallback, useEffect, useRef, useState } from 'react';

function pickMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  if (typeof MediaRecorder === 'undefined') return '';
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function useVoiceRecorder() {
  const [status, setStatus] = useState('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');

  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const mimeRef = useRef('audio/webm');
  const timerRef = useRef(null);
  const startedAtRef = useRef(0);

  const cleanupStream = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  useEffect(() => () => cleanupStream(), [cleanupStream]);

  const start = useCallback(async () => {
    setError('');
    cleanupStream();
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Браузер не поддерживает запись с микрофона');
      setStatus('error');
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;
      const mime = pickMimeType();
      mimeRef.current = mime || 'audio/webm';
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data?.size) chunksRef.current.push(e.data);
      };
      recorderRef.current = recorder;
      recorder.start(1000);
      startedAtRef.current = Date.now();
      setSeconds(0);
      timerRef.current = setInterval(() => {
        setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 500);
      setStatus('recording');
      return true;
    } catch (err) {
      cleanupStream();
      const msg =
        err.name === 'NotAllowedError'
          ? 'Разрешите доступ к микрофону в настройках браузера'
          : 'Не удалось начать запись';
      setError(msg);
      setStatus('error');
      return false;
    }
  }, [cleanupStream]);

  const stop = useCallback(() => {
    return new Promise((resolve, reject) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        reject(new Error('Запись не активна'));
        return;
      }
      recorder.onstop = () => {
        const durationSec = Math.max(1, Math.floor((Date.now() - startedAtRef.current) / 1000));
        const blob = new Blob(chunksRef.current, { type: mimeRef.current });
        cleanupStream();
        setStatus('stopped');
        setSeconds(durationSec);
        resolve({ blob, durationSec, mime: mimeRef.current });
      };
      recorder.onerror = () => {
        cleanupStream();
        setStatus('error');
        reject(new Error('Ошибка записи'));
      };
      if (recorder.state !== 'inactive') recorder.stop();
    });
  }, [cleanupStream]);

  const reset = useCallback(() => {
    cleanupStream();
    setStatus('idle');
    setSeconds(0);
    setError('');
  }, [cleanupStream]);

  return {
    status,
    seconds,
    formattedDuration: formatDuration(seconds),
    error,
    start,
    stop,
    reset,
    isRecording: status === 'recording',
  };
}
