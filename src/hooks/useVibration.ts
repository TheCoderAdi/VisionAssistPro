// src/hooks/useVibration.ts

import { useCallback, useRef } from 'react';
import { Vibration } from 'react-native';
import { Detection, UrgencyLevel } from '../types';
import { isCritical } from '../utils/distanceEstimator';

export function useVibration(enabled: boolean) {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const lastVibrated = useRef<Record<string, number>>({});
  const isVibratingRef = useRef(false);
  const vibrateEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const COOLDOWN_MS = 1500;

  // patternDuration removed; single-duration vibrations used instead

  // Simplified rawVibrate: use a single short vibration for reliability.
  // The previous implementation used patterns from VIBRATION_PATTERNS which
  // proved unreliable on some devices. We'll comment out pattern usage and
  // fall back to a single 200ms vibration when an object is detected.
  const rawVibrate = useCallback((_pattern: number[] | null, label: string) => {
    // Clear any existing end timer
    if (vibrateEndTimer.current) clearTimeout(vibrateEndTimer.current);

    const SIMPLE_MS = 200;
    console.log('[Vibration] rawVibrate (simple):', label, SIMPLE_MS);
    isVibratingRef.current = true;
    Vibration.vibrate(SIMPLE_MS);

    // Release the lock after vibration finishes + small buffer
    vibrateEndTimer.current = setTimeout(() => {
      isVibratingRef.current = false;
    }, SIMPLE_MS + 150);
  }, []);

  const vibrate = useCallback(
    (urgency: UrgencyLevel, key: string) => {
      if (!enabledRef.current) return;
      const now = Date.now();
      if (now - (lastVibrated.current[key] ?? 0) < COOLDOWN_MS) return;
      lastVibrated.current[key] = now;
      // Use a simple vibration instead of complex patterns
      rawVibrate(null, urgency);
    },
    [rawVibrate],
  );

  const vibrateOnce = useCallback(
    (urgency: UrgencyLevel) => {
      if (!enabledRef.current) return;
      rawVibrate(null, urgency);
    },
    [rawVibrate],
  );

  const processDetections = useCallback(
    (detections: Detection[]) => {
      if (!enabledRef.current) return;
      if (detections.length === 0) return;

      const critical = detections.find(d =>
        isCritical(d.boundingBox, d.modelName ?? 'yolov8n_float16.tflite'),
      );

      if (critical) {
        const key = `crit-${critical.label}`;
        const now = Date.now();
        if (now - (lastVibrated.current[key] ?? 0) < COOLDOWN_MS) return;
        lastVibrated.current[key] = now;
        console.log('[Vibration] CRITICAL:', critical.label);
        // Simple single vibration for critical events
        rawVibrate(null, 'obstacle');
        return;
      }

      const high = detections.find(d => d.urgency === 'high');
      const medium = detections.find(d => d.urgency === 'medium');
      if (high) vibrate('high', `${high.label}-${high.direction}`);
      else if (medium) vibrate('medium', `${medium.label}-${medium.direction}`);
    },
    [rawVibrate, vibrate],
  );

  // Only cancels if no pattern is currently playing
  const cancel = useCallback(() => {
    if (isVibratingRef.current) {
      console.log('[Vibration] cancel() ignored — pattern playing');
      return;
    }
    Vibration.cancel();
  }, []);

  return { processDetections, vibrateOnce, cancel };
}
