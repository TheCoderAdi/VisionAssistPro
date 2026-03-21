import { useEffect, useRef, useCallback } from 'react';
import Tts from 'react-native-tts';
import { Detection, AppSettings } from '../types';
import { debug, warn, error } from '../utils/logger';
import { directionLabel } from '../utils/spatialAnalyzer';
import { distanceLabel } from '../utils/distanceEstimator';
import { buildAlert } from '../utils/urgencyClassifier';

export function useTTS(settings: AppSettings) {
  const queue = useRef<string[]>([]);
  const isSpeaking = useRef(false);
  const lastSpoken = useRef<Record<string, number>>({});
  const isReady = useRef(false);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enabledRef = useRef(settings.ttsEnabled);
  enabledRef.current = settings.ttsEnabled;

  const alertIntervalRef = useRef(settings.alertInterval);
  alertIntervalRef.current = settings.alertInterval;

  useEffect(() => {
    let startSub: any;
    let finishSub: any;
    let cancelSub: any;
    let errorSub: any;

    const init = async () => {
      try {
        await new Promise<void>(resolve => {
          startSub = Tts.addEventListener('tts-start', () => {
            isSpeaking.current = true;
          });

          finishSub = Tts.addEventListener('tts-finish', () => {
            isSpeaking.current = false;
            flushTimer.current = setTimeout(() => {
              flushQueue();
            }, 300);
          });

          cancelSub = Tts.addEventListener('tts-cancel', () => {
            isSpeaking.current = false;
          });

          errorSub = Tts.addEventListener('tts-error', err => {
            warn('[TTS Error]', err);
            isSpeaking.current = false;
            setTimeout(() => flushQueue(), 500);
          });

          isReady.current = true;
          resolve();
        });

        await Tts.setDefaultLanguage('en-US');
        await Tts.setDefaultRate(settings.ttsRate);
        await Tts.setDefaultPitch(settings.ttsPitch);
      } catch (e) {
        error('[TTS Init Error]', e);
      }
    };

    init();

    return () => {
      try {
        startSub?.remove();
        finishSub?.remove();
        cancelSub?.remove();
        errorSub?.remove();
        if (flushTimer.current) clearTimeout(flushTimer.current);
        Tts.stop();
      } catch (e) {
        warn('[TTS Cleanup Error]', e);
      }
    };
  }, [settings.ttsRate, settings.ttsPitch]);

  // ─── Update rate/pitch when settings change ───────────────────────────────
  useEffect(() => {
    try {
      Tts.setDefaultRate(settings.ttsRate);
      Tts.setDefaultPitch(settings.ttsPitch);
    } catch (e) {
      warn('[TTS Update Error]', e);
    }
  }, [settings.ttsRate, settings.ttsPitch]);

  // ─── Flush Queue ──────────────────────────────────────────────────────────
  // ✅ NOT a useCallback - plain function using refs only
  // This avoids stale closure problem completely
  const flushQueue = () => {
    if (!enabledRef.current) return;
    if (isSpeaking.current) return;
    if (queue.current.length === 0) return;

    const next = queue.current.shift()!;

    debug('[TTS] Speaking:', next);

    try {
      isSpeaking.current = true;
      Tts.speak(next);
    } catch (e) {
      warn('[TTS Speak Error]', e);
      isSpeaking.current = false;
    }
  };

  // ─── Speak ────────────────────────────────────────────────────────────────
  const speak = useCallback((text: string, interrupt = false) => {
    if (!enabledRef.current) return;
    if (!text || text.trim().length === 0) return;

    debug('[TTS] Queue:', text, '| interrupt:', interrupt);

    if (interrupt) {
      // ✅ Clear everything and speak immediately
      try {
        Tts.stop();
      } catch (e) {
        warn('[TTS Stop Error]', e);
      }
      if (flushTimer.current) clearTimeout(flushTimer.current);
      queue.current = [];
      isSpeaking.current = false;

      // Small delay after stop before speaking
      setTimeout(() => {
        queue.current.push(text);
        flushQueue();
      }, 150);
      return;
    }

    queue.current.push(text);

    // Start flushing if not already speaking
    if (!isSpeaking.current) {
      flushQueue();
    }
  }, []);

  // ─── Announce Detections ──────────────────────────────────────────────────
  const announceDetections = useCallback(
    (detections: Detection[]) => {
      if (!enabledRef.current) return;
      if (detections.length === 0) return;

      const now = Date.now();

      // ✅ Only speak high urgency to prevent queue flood
      const toSpeak = detections
        .filter(d => {
          // Skip low urgency entirely
          if (d.urgency === 'low') return false;

          const key = `${d.label}-${d.direction}`;
          const interval =
            d.urgency === 'high'
              ? alertIntervalRef.current / 2
              : alertIntervalRef.current;

          // Deduplicate - same object in same direction
          const lastTime = lastSpoken.current[key] ?? 0;
          if (now - lastTime < interval) return false;

          lastSpoken.current[key] = now;
          return true;
        })
        .sort((a, b) => {
          const order = { high: 0, medium: 1, low: 2 };
          return order[a.urgency] - order[b.urgency];
        })
        // ✅ Limit to 2 announcements max per cycle
        // prevents queue from building up
        .slice(0, 2);

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
    [speak],
  );

  // ─── Stop ─────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    try {
      Tts.stop();
    } catch (e) {
      warn('[TTS Stop Error]', e);
    }
    if (flushTimer.current) clearTimeout(flushTimer.current);
    queue.current = [];
    isSpeaking.current = false;
  }, []);

  return { speak, announceDetections, stop };
}
