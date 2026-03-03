import { Direction, BoundingBox } from '../types';

const ZONES = {
  left: { max: 0.33 },
  center: { min: 0.33, max: 0.67 },
  right: { min: 0.67 },
};

export function getDirection(box: BoundingBox): Direction {
  const centerX = box.left + box.width / 2;
  if (centerX < ZONES.left.max) return 'left';
  if (centerX < ZONES.center.max) return 'center';
  return 'right';
}

export function directionLabel(dir: Direction): string {
  switch (dir) {
    case 'left':
      return 'on your left';
    case 'right':
      return 'on your right';
    case 'center':
      return 'directly ahead';
  }
}
