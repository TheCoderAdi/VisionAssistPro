package com.visionassistpro.tflite

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.os.SystemClock
import android.util.Log
import org.tensorflow.lite.Interpreter
import org.tensorflow.lite.gpu.CompatibilityList
import org.tensorflow.lite.gpu.GpuDelegate
import org.tensorflow.lite.support.common.FileUtil
import org.tensorflow.lite.support.image.ImageProcessor
import org.tensorflow.lite.support.image.TensorImage
import org.tensorflow.lite.support.image.ops.ResizeOp
import org.tensorflow.lite.support.image.ops.ResizeWithCropOrPadOp
import java.io.FileInputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel

class ObjectDetector(
    private val context: Context,
    private val modelName: String,
    private val threshold: Float = 0.5f,
    private val maxDetections: Int = 10,
    private val numThreads: Int = 4
) {

    companion object {
        private const val TAG = "ObjectDetector"

        // SSD MobileNet config
        private const val SSD_INPUT_SIZE = 300
        private const val SSD_NUM_DETECTIONS = 10

        // YOLOv8 config
        private const val YOLO_INPUT_SIZE = 640

        // Output tensor indices for SSD MobileNet
        private const val OUTPUT_LOCATIONS = 0
        private const val OUTPUT_CLASSES = 1
        private const val OUTPUT_SCORES = 2
        private const val OUTPUT_NUM_DETECTIONS = 3
    }

    private var interpreter: Interpreter? = null
    private var gpuDelegate: GpuDelegate? = null
    private var labels: List<String> = emptyList()
    private var isYolo: Boolean = false
    private var inputSize: Int = SSD_INPUT_SIZE
    private var lastInferenceTime: Long = 0L

    // ─── Initialization ────────────────────────────────────────────────────────

    fun initialize(): Boolean {
        return try {
            // Load labels. Try common filenames used in this repo and packages.
            labels = try {
                FileUtil.loadLabels(context, "models/coco_labels.txt").also {
                    Log.d(TAG, "Loaded labels from models/coco_labels.txt")
                }
            } catch (e: Exception) {
                try {
                    FileUtil.loadLabels(context, "models/labelmap.txt").also {
                        Log.d(TAG, "Loaded labels from models/labelmap.txt")
                    }
                } catch (e2: Exception) {
                    Log.w(TAG, "Label file not found: tried models/coco_labels.txt and models/labelmap.txt")
                    emptyList()
                }
            }

            // Determine model type
            isYolo = modelName.contains("yolo", ignoreCase = true)
            inputSize = if (isYolo) YOLO_INPUT_SIZE else SSD_INPUT_SIZE

            // Load model from assets
            val modelBuffer = loadModelFile("models/$modelName")

            // Create a simple Interpreter instance. GPU delegates and custom
            // options are skipped here to avoid compile-time dependency issues
            // with the nested Options class in this environment.
            interpreter = Interpreter(modelBuffer)

            Log.d(TAG, "Model loaded: $modelName | Input size: $inputSize")
            Log.d(TAG, "Input tensor: ${interpreter?.getInputTensor(0)?.shape()?.contentToString()}")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Initialization failed: ${e.message}", e)
            false
        }
    }

    // ─── Main Detection Function ────────────────────────────────────────────────

    fun detect(imagePath: String): List<DetectionResult> {
        val interp = interpreter ?: return emptyList()

        return try {
            // Decode image
            val bitmap = decodeBitmap(imagePath) ?: return emptyList()

            // Preprocess
            val processedBitmap = preprocessBitmap(bitmap, inputSize)

            val startTime = SystemClock.uptimeMillis()

            val results = if (isYolo) {
                runYoloInference(interp, processedBitmap)
            } else {
                runSSDInference(interp, processedBitmap)
            }

            lastInferenceTime = SystemClock.uptimeMillis() - startTime
            Log.d(TAG, "Inference time: ${lastInferenceTime}ms | Detections: ${results.size}")

            // Cleanup
            bitmap.recycle()
            processedBitmap.recycle()

            results
        } catch (e: Exception) {
            Log.e(TAG, "Detection error: ${e.message}", e)
            emptyList()
        }
    }

    // ─── SSD MobileNet Inference ────────────────────────────────────────────────

    private fun runSSDInference(
        interp: Interpreter,
        bitmap: Bitmap
    ): List<DetectionResult> {

        // Convert bitmap to ByteBuffer
        val inputBuffer = bitmapToByteBuffer(bitmap, inputSize, isQuantized = true)

        // Output tensors for SSD MobileNet
        // [1][10][4]  → bounding boxes [ymin, xmin, ymax, xmax]
        // [1][10]     → class indices
        // [1][10]     → confidence scores
        // [1]         → number of detections
        val outputBoxes = Array(1) { Array(SSD_NUM_DETECTIONS) { FloatArray(4) } }
        val outputClasses = Array(1) { FloatArray(SSD_NUM_DETECTIONS) }
        val outputScores = Array(1) { FloatArray(SSD_NUM_DETECTIONS) }
        val outputNumDetections = FloatArray(1)

        val outputMap = mapOf(
            OUTPUT_LOCATIONS to outputBoxes,
            OUTPUT_CLASSES to outputClasses,
            OUTPUT_SCORES to outputScores,
            OUTPUT_NUM_DETECTIONS to outputNumDetections
        )

        interp.runForMultipleInputsOutputs(arrayOf(inputBuffer), outputMap)

        val numDetections = minOf(
            outputNumDetections[0].toInt(),
            SSD_NUM_DETECTIONS,
            maxDetections
        )

        val detections = mutableListOf<DetectionResult>()

        for (i in 0 until numDetections) {
            val score = outputScores[0][i]
            if (score < threshold) continue

            // SSD box format: [ymin, xmin, ymax, xmax] normalized 0-1
            val ymin = outputBoxes[0][i][0].coerceIn(0f, 1f)
            val xmin = outputBoxes[0][i][1].coerceIn(0f, 1f)
            val ymax = outputBoxes[0][i][2].coerceIn(0f, 1f)
            val xmax = outputBoxes[0][i][3].coerceIn(0f, 1f)

            val classIndex = outputClasses[0][i].toInt()
            val label = if (classIndex < labels.size) labels[classIndex] else "unknown"

            detections.add(
                DetectionResult(
                    label = label,
                    confidence = score,
                    left = xmin,
                    top = ymin,
                    right = xmax,
                    bottom = ymax,
                    width = xmax - xmin,
                    height = ymax - ymin
                )
            )
        }

        return detections.sortedByDescending { it.confidence }
    }

    // ─── YOLOv8 Inference ───────────────────────────────────────────────────────

    private fun runYoloInference(
        interp: Interpreter,
        bitmap: Bitmap
    ): List<DetectionResult> {

        // YOLOv8 input: [1, 640, 640, 3] float32
        val inputBuffer = bitmapToByteBuffer(bitmap, inputSize, isQuantized = false)

        // YOLOv8 output: [1, 84, 8400]
        // 84 = 4 box coords + 80 classes
        val numAnchors = 8400
        val outputData = Array(1) { Array(84) { FloatArray(numAnchors) } }

        interp.run(inputBuffer, outputData)

        val detections = mutableListOf<DetectionResult>()

        for (i in 0 until numAnchors) {
            // Find best class
            var bestClassScore = 0f
            var bestClassIndex = 0

            for (c in 4 until 84) {
                val classScore = outputData[0][c][i]
                if (classScore > bestClassScore) {
                    bestClassScore = classScore
                    bestClassIndex = c - 4
                }
            }

            if (bestClassScore < threshold) continue

            // YOLOv8 box format: [cx, cy, w, h] normalized
            val cx = outputData[0][0][i] / inputSize
            val cy = outputData[0][1][i] / inputSize
            val w  = outputData[0][2][i] / inputSize
            val h  = outputData[0][3][i] / inputSize

            val xmin = (cx - w / 2).coerceIn(0f, 1f)
            val ymin = (cy - h / 2).coerceIn(0f, 1f)
            val xmax = (cx + w / 2).coerceIn(0f, 1f)
            val ymax = (cy + h / 2).coerceIn(0f, 1f)

            val label = if (bestClassIndex < labels.size) {
                labels[bestClassIndex]
            } else {
                "unknown"
            }

            detections.add(
                DetectionResult(
                    label = label,
                    confidence = bestClassScore,
                    left = xmin,
                    top = ymin,
                    right = xmax,
                    bottom = ymax,
                    width = xmax - xmin,
                    height = ymax - ymin
                )
            )
        }

        // Non-Maximum Suppression
        return nonMaxSuppression(
            detections.sortedByDescending { it.confidence },
            iouThreshold = 0.45f,
            maxDetections = maxDetections
        )
    }

    // ─── Non-Maximum Suppression ────────────────────────────────────────────────

    private fun nonMaxSuppression(
        detections: List<DetectionResult>,
        iouThreshold: Float,
        maxDetections: Int
    ): List<DetectionResult> {
        val selected = mutableListOf<DetectionResult>()
        val suppressed = BooleanArray(detections.size)

        for (i in detections.indices) {
            if (suppressed[i]) continue
            selected.add(detections[i])
            if (selected.size >= maxDetections) break

            for (j in i + 1 until detections.size) {
                if (suppressed[j]) continue
                if (iou(detections[i], detections[j]) > iouThreshold) {
                    suppressed[j] = true
                }
            }
        }

        return selected
    }

    private fun iou(a: DetectionResult, b: DetectionResult): Float {
        val interLeft   = maxOf(a.left, b.left)
        val interTop    = maxOf(a.top, b.top)
        val interRight  = minOf(a.right, b.right)
        val interBottom = minOf(a.bottom, b.bottom)

        val interW = maxOf(0f, interRight - interLeft)
        val interH = maxOf(0f, interBottom - interTop)
        val interArea = interW * interH

        val aArea = a.width * a.height
        val bArea = b.width * b.height
        val unionArea = aArea + bArea - interArea

        return if (unionArea <= 0f) 0f else interArea / unionArea
    }

    // ─── Image Preprocessing ────────────────────────────────────────────────────

    private fun decodeBitmap(imagePath: String): Bitmap? {
        return try {
            val cleanPath = imagePath.removePrefix("file://")
            BitmapFactory.decodeFile(cleanPath)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to decode bitmap: ${e.message}")
            null
        }
    }

    private fun preprocessBitmap(bitmap: Bitmap, size: Int): Bitmap {
        val matrix = Matrix()
        val scale = size.toFloat() / maxOf(bitmap.width, bitmap.height)
        matrix.postScale(scale, scale)
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
            .let { scaled ->
                // Ensure exact size
                Bitmap.createScaledBitmap(scaled, size, size, true)
            }
    }

    private fun bitmapToByteBuffer(
        bitmap: Bitmap,
        inputSize: Int,
        isQuantized: Boolean
    ): ByteBuffer {
        val bytesPerChannel = if (isQuantized) 1 else 4
        val buffer = ByteBuffer.allocateDirect(
            1 * inputSize * inputSize * 3 * bytesPerChannel
        )
        buffer.order(ByteOrder.nativeOrder())
        buffer.rewind()

        val pixels = IntArray(inputSize * inputSize)
        bitmap.getPixels(pixels, 0, inputSize, 0, 0, inputSize, inputSize)

        for (pixel in pixels) {
            val r = (pixel shr 16) and 0xFF
            val g = (pixel shr 8) and 0xFF
            val b = pixel and 0xFF

            if (isQuantized) {
                // Quantized model: uint8 values 0-255
                buffer.put(r.toByte())
                buffer.put(g.toByte())
                buffer.put(b.toByte())
            } else {
                // Float model: normalized -1 to 1
                buffer.putFloat((r - 127.5f) / 127.5f)
                buffer.putFloat((g - 127.5f) / 127.5f)
                buffer.putFloat((b - 127.5f) / 127.5f)
            }
        }

        buffer.rewind()
        return buffer
    }

    // ─── Load Model File ────────────────────────────────────────────────────────

    @Throws(IOException::class)
    private fun loadModelFile(assetPath: String): MappedByteBuffer {
        val assetFileDescriptor = context.assets.openFd(assetPath)
        val inputStream = FileInputStream(assetFileDescriptor.fileDescriptor)
        val fileChannel = inputStream.channel
        val startOffset = assetFileDescriptor.startOffset
        val declaredLength = assetFileDescriptor.declaredLength
        return fileChannel.map(FileChannel.MapMode.READ_ONLY, startOffset, declaredLength)
    }

    // ─── Getters ────────────────────────────────────────────────────────────────

    fun getLastInferenceTime(): Long = lastInferenceTime

    fun isInitialized(): Boolean = interpreter != null

    // ─── Cleanup ────────────────────────────────────────────────────────────────

    fun close() {
        interpreter?.close()
        interpreter = null
        gpuDelegate?.close()
        gpuDelegate = null
        Log.d(TAG, "ObjectDetector closed")
    }
}