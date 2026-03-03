import { NativeModules, Platform } from 'react-native';
import { DetectionResponse, ModelInfo } from '../types';

const { TFLiteModule } = NativeModules;

if (!TFLiteModule) {
  throw new Error(
    'TFLiteModule is not linked.\n' +
      'Make sure TFLitePackage is registered in MainApplication.kt\n' +
      'and run: cd android && ./gradlew clean',
  );
}

export interface LoadModelParams {
  modelName: string;
  threshold: number;
  maxDetections: number;
  numThreads: number;
}

/**
 * Load TFLite model via Kotlin native module
 */
export async function loadModel(params: LoadModelParams): Promise<{
  success: boolean;
  message: string;
  modelName: string;
}> {
  if (Platform.OS !== 'android') {
    throw new Error('TFLiteModule is only supported on Android');
  }

  return TFLiteModule.loadModel(
    params.modelName,
    params.threshold,
    params.maxDetections,
    params.numThreads,
  );
}

/**
 * Run object detection on image
 */
export async function detectObjects(
  imagePath: string,
): Promise<DetectionResponse> {
  return TFLiteModule.detectObjects(imagePath);
}

/**
 * Get current model information
 */
export async function getModelInfo(): Promise<ModelInfo> {
  return TFLiteModule.getModelInfo();
}

/**
 * Close and release model from memory
 */
export async function closeModel(): Promise<boolean> {
  return TFLiteModule.closeModel();
}
