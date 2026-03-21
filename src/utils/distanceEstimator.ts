import { BoundingBox, DistanceLevel } from '../types';

// Simplified: app ships with only YOLOv8 Nano. Use tuned thresholds for YOLO.
const THRESHOLDS = {
  yolo: {
    near: 0.08, // YOLOv8 draws medium boxes
    medium: 0.025,
    critical: 0.15,
  },
};

function getThreshold(_modelName: string) {
  return THRESHOLDS.yolo;
}

// ─── Main distance estimator ──────────────────────────────────────────────────

export function estimateDistance(
  box: BoundingBox,
  modelName: string = 'yolov8n_float16.tflite',
): DistanceLevel {
  const area = box.width * box.height;
  const thres = getThreshold(modelName);

  if (area > thres.near) return 'near';
  if (area > thres.medium) return 'medium';
  return 'far';
}

export function isCritical(
  box: BoundingBox,
  modelName: string = 'yolov8n_float16.tflite',
): boolean {
  const area = box.width * box.height;
  const thres = getThreshold(modelName);
  // Critical = 1.5x the near threshold
  return area > thres.critical;
}

export function distanceLabel(dist: DistanceLevel): string {
  switch (dist) {
    case 'near':
      return 'very close';
    case 'medium':
      return 'nearby';
    case 'far':
      return 'in the distance';
  }
}
