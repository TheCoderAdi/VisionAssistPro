import { UrgencyLevel, DistanceLevel } from '../types';
import {
  HIGH_URGENCY_LABELS,
  MEDIUM_URGENCY_LABELS,
} from '../constants/labels';

export function classifyUrgency(
  label: string,
  distance: DistanceLevel,
): UrgencyLevel {
  const isHigh = HIGH_URGENCY_LABELS.has(label.toLowerCase());
  const isMedium = MEDIUM_URGENCY_LABELS.has(label.toLowerCase());

  if (distance === 'near') {
    if (isHigh || isMedium) return 'high';
    return 'medium';
  }
  if (distance === 'medium') {
    if (isHigh) return 'high';
    if (isMedium) return 'medium';
    return 'low';
  }
  // far
  if (isHigh) return 'medium';
  return 'low';
}

export function buildAlert(
  label: string,
  urgency: UrgencyLevel,
  directionText: string,
  distanceText: string,
): string {
  switch (urgency) {
    case 'high':
      return `Warning! ${label} ${directionText}, ${distanceText}`;
    case 'medium':
      return `${label} ${directionText}, ${distanceText}`;
    case 'low':
      return `${label} detected ${directionText}`;
  }
}
