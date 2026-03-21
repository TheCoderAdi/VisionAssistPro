// src/hooks/useVibration.ts

import { useCallback, useRef } from 'react';
import { Vibration } from 'react-native';
import { Detection, UrgencyLevel } from '../types';
import { VIBRATION_PATTERNS } from '../constants/labels';
import { debug } from '../utils/logger';
import { isCritical } from '../utils/distanceEstimator';

export function useVibration(enabled: boolean) {
  const lastVibrated = useRef<Record<string, number>>({});
  const COOLDOWN = 1500;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // ─── Core vibrate function ────────────────────────────────────────────────
  const vibrate = useCallback((urgency: UrgencyLevel, key: string) => {
    if (!enabledRef.current) return;

    const now = Date.now();
    if (now - (lastVibrated.current[key] ?? 0) < COOLDOWN) return;
    lastVibrated.current[key] = now;

    debug('[Vibration] Triggering:', urgency, key);

    // ✅ Use Vibration API directly - most reliable on Android
    // react-native-haptic-feedback is iOS-only primarily
    const pattern = VIBRATION_PATTERNS[urgency];
    Vibration.vibrate(pattern);
  }, []);

  // ─── Single vibrate call ──────────────────────────────────────────────────
  const vibrateOnce = useCallback((urgency: UrgencyLevel) => {
    if (!enabledRef.current) return;
    const pattern = VIBRATION_PATTERNS[urgency];
    Vibration.vibrate(pattern);
  }, []);

  // ─── Process all detections ───────────────────────────────────────────────
  const processDetections = useCallback(
    (detections: Detection[]) => {
      if (!enabledRef.current) return;
      if (detections.length === 0) return;

      // ✅ Pass modelName to isCritical for correct threshold
      const critical = detections.find(d =>
        isCritical(d.boundingBox, d.modelName ?? 'ssd'),
      );

      if (critical) {
        debug('[Vibration] CRITICAL obstacle:', critical.label);
        // Cancel any ongoing vibration first
        Vibration.cancel();
        // Small delay then obstacle pattern
        setTimeout(() => {
          Vibration.vibrate(VIBRATION_PATTERNS.obstacle);
        }, 50);
        return;
      }

      // Find highest urgency detection
      const high = detections.find(d => d.urgency === 'high');
      const medium = detections.find(d => d.urgency === 'medium');

      if (high) {
        vibrate('high', `${high.label}-${high.direction}`);
      } else if (medium) {
        vibrate('medium', `${medium.label}-${medium.direction}`);
      }
    },
    [vibrate],
  );

  // ─── Cancel ───────────────────────────────────────────────────────────────
  const cancel = useCallback(() => {
    Vibration.cancel();
  }, []);

  return { processDetections, vibrateOnce, cancel };
}
