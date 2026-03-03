import { useCallback } from 'react';
import { Detection, SpatialReport, Direction } from '../types';
import { isCritical } from '../utils/distanceEstimator';

export function useSpatialAwareness() {
  const analyze = useCallback((detections: Detection[]): SpatialReport => {
    if (detections.length === 0) {
      return {
        hasObstacleAhead: false,
        criticalObjects: [],
        safeDirections: ['left', 'center', 'right'],
        closestObject: null,
      };
    }

    const critical = detections.filter(d => isCritical(d.boundingBox));

    const hasObstacleAhead = detections.some(
      d =>
        d.direction === 'center' &&
        (d.distance === 'near' || d.distance === 'medium'),
    );

    const dangerDirs = new Set<Direction>(
      detections
        .filter(d => d.urgency === 'high' && d.distance !== 'far')
        .map(d => d.direction),
    );

    const all: Direction[] = ['left', 'center', 'right'];
    const safeDirections = all.filter(d => !dangerDirs.has(d));

    const sorted = [...detections].sort((a, b) => {
      const order = { near: 0, medium: 1, far: 2 };
      return order[a.distance] - order[b.distance];
    });

    return {
      hasObstacleAhead,
      criticalObjects: critical,
      safeDirections,
      closestObject: sorted[0] ?? null,
    };
  }, []);

  const getGuidance = useCallback((report: SpatialReport): string => {
    if (report.criticalObjects.length > 0) {
      const obj = report.criticalObjects[0];
      return `Danger! ${obj.label} extremely close! Stop immediately!`;
    }
    if (report.hasObstacleAhead) {
      if (report.safeDirections.includes('right'))
        return 'Obstacle ahead. Move right.';
      if (report.safeDirections.includes('left'))
        return 'Obstacle ahead. Move left.';
      return 'Path blocked. Please stop.';
    }
    if (report.safeDirections.includes('center')) return 'Path ahead is clear.';
    return '';
  }, []);

  return { analyze, getGuidance };
}
