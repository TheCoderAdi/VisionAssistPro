export type FeedbackMode = 'tts' | 'vibration';

export interface RawDetection {
  label: string;
  confidence: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface BoundingBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Detection {
  id: string;
  label: string;
  confidence: number;
  boundingBox: BoundingBox;
  direction: Direction;
  distance: DistanceLevel;
  urgency: UrgencyLevel;
  modelName: string;
  lastSeen?: number;
}

export interface DetectionResponse {
  detections: RawDetection[];
  inferenceTime: number;
  totalTime: number;
  count: number;
}

export interface ModelInfo {
  isLoaded: boolean;
  currentModel: string;
  lastInferenceTime: number;
}

export type Direction = 'left' | 'center' | 'right';
export type DistanceLevel = 'near' | 'medium' | 'far';
export type UrgencyLevel = 'high' | 'medium' | 'low';
export type ModelName = 'yolov8n_float16.tflite' | 'yolo26n_float16.tflite';

export interface AppSettings {
  feedbackMode: FeedbackMode;
  ttsEnabled: boolean;
  vibrationEnabled: boolean;
  overlayEnabled: boolean;
  ttsRate: number;
  ttsPitch: number;
  alertInterval: number;
  detectionThreshold: number;
  selectedModel: ModelName;
  maxDetections: number;
  numThreads: number;
  torchEnabled?: boolean;
}

export interface PerformanceMetrics {
  inferenceTime: number;
  totalTime: number;
  fps: number;
  detectionCount: number;
}

export interface SpatialReport {
  hasObstacleAhead: boolean;
  criticalObjects: Detection[];
  safeDirections: Direction[];
  closestObject: Detection | null;
}
