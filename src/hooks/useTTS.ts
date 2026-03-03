import { useEffect, useRef, useCallback } from 'react';
import Tts from 'react-native-tts';
import { Detection, AppSettings } from '../types';
import { directionLabel } from '../utils/spatialAnalyzer';
import { distanceLabel } from '../utils/distanceEstimator';
import { buildAlert } from '../utils/urgencyClassifier';

export function useTTS(settings: AppSettings) {
  const queue = useRef<string[]>([]);
  const isSpeaking = useRef(false);
  const lastSpoken = useRef<Record<string, number>>({});
  const enabled = settings.ttsEnabled;

  useEffect(() => {
    Tts.setDefaultLanguage('en-US');
    Tts.setDefaultRate(settings.ttsRate);
    Tts.setDefaultPitch(settings.ttsPitch);

    const finishSub = Tts.addEventListener('tts-finish', () => {
      isSpeaking.current = false;
      flush();
    });
    const cancelSub = Tts.addEventListener('tts-cancel', () => {
      isSpeaking.current = false;
    });

    return () => {
      finishSub.remove();
      cancelSub.remove();
      Tts.stop();
    };
  }, [settings.ttsRate, settings.ttsPitch]);

  const flush = useCallback(() => {
    if (!enabled || isSpeaking.current || queue.current.length === 0) return;
    const next = queue.current.shift()!;
    isSpeaking.current = true;
    Tts.speak(next);
  }, [enabled]);

  const speak = useCallback(
    (text: string, interrupt = false) => {
      if (!enabled) return;
      if (interrupt) {
        Tts.stop();
        queue.current = [];
        isSpeaking.current = false;
      }
      queue.current.push(text);
      flush();
    },
    [enabled, flush],
  );

  const announceDetections = useCallback(
    (detections: Detection[]) => {
      if (!enabled || detections.length === 0) return;

      const now = Date.now();

      const toSpeak = detections
        .filter(d => {
          if (d.urgency === 'low') return false;
          const key = `${d.label}-${d.direction}`;
          const interval =
            d.urgency === 'high'
              ? settings.alertInterval / 2
              : settings.alertInterval;
          if (now - (lastSpoken.current[key] ?? 0) < interval) return false;
          lastSpoken.current[key] = now;
          return true;
        })
        .sort((a, b) => {
          const order = { high: 0, medium: 1, low: 2 };
          return order[a.urgency] - order[b.urgency];
        });

      toSpeak.forEach(d => {
        const text = buildAlert(
          d.label,
          d.urgency,
          directionLabel(d.direction),
          distanceLabel(d.distance),
        );
        speak(text);
      });
    },
    [enabled, settings.alertInterval, speak],
  );

  const stop = useCallback(() => {
    Tts.stop();
    queue.current = [];
    isSpeaking.current = false;
  }, []);

  return { speak, announceDetections, stop };
}
