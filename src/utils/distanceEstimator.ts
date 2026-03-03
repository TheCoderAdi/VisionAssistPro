import { BoundingBox, DistanceLevel } from '../types';

export function estimateDistance(box: BoundingBox): DistanceLevel {
  const area = box.width * box.height; // Normalized 0-1
  if (area > 0.2) return 'near';
  if (area > 0.06) return 'medium';
  return 'far';
}

export function isCritical(box: BoundingBox): boolean {
  return box.width * box.height > 0.35;
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
