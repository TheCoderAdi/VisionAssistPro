import { useCallback, useRef } from 'react';
import { Vibration } from 'react-native';
import { Detection, UrgencyLevel } from '../types';
import { VIBRATION_PATTERNS } from '../constants/labels';
import { isCritical } from '../utils/distanceEstimator';

export function useVibration(enabled: boolean) {
  const lastVibrated = useRef<Record<string, number>>({});
  const COOLDOWN = 1200;

  const vibrate = useCallback(
    (urgency: UrgencyLevel, key: string) => {
      if (!enabled) return;
      const now = Date.now();
      if (now - (lastVibrated.current[key] ?? 0) < COOLDOWN) return;
      lastVibrated.current[key] = now;
      Vibration.vibrate(VIBRATION_PATTERNS[urgency]);
    },
    [enabled],
  );

  const processDetections = useCallback(
    (detections: Detection[]) => {
      if (!enabled || detections.length === 0) return;

      // Critical obstacle takes priority
      const critical = detections.find(d => isCritical(d.boundingBox));
      if (critical) {
        Vibration.vibrate(VIBRATION_PATTERNS.obstacle);
        return;
      }

      const high = detections.find(d => d.urgency === 'high');
      const medium = detections.find(d => d.urgency === 'medium');

      if (high) {
        vibrate('high', `${high.label}-${high.direction}`);
      } else if (medium) {
        vibrate('medium', `${medium.label}-${medium.direction}`);
      }
    },
    [enabled, vibrate],
  );

  const cancel = useCallback(() => Vibration.cancel(), []);

  return { processDetections, cancel };
}
