package com.visionassistpro.tflite

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.os.SystemClock
import android.util.Log
import org.tensorflow.lite.Interpreter
import org.tensorflow.lite.support.common.FileUtil
import java.io.FileInputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel
import kotlin.math.roundToInt

class ObjectDetector(
    private val context: Context,
    private val modelName: String,
    private val threshold: Float = 0.5f,
    private val maxDetections: Int = 10,
    private val numThreads: Int = 4
) {

    companion object {
        private const val TAG = "ObjectDetector"

        private const val DEFAULT_INPUT_SIZE = 320

        // Naming convention: yolov8n_640_float16.tflite → 640
        //                    yolov8n_320_float16.tflite → 320
        //                    yolov8n_320_int8.tflite    → 320
        //                    yolov8n_float16.tflite     → legacy, assume 640
        fun inputSizeFromModelName(name: String): Int {
            return when {
                name.contains("_640_") -> 640
                name.contains("_320_") -> 320
                name.contains("_320")  -> 320
                name.contains("float16") && !name.contains("_320") -> 640
                else -> DEFAULT_INPUT_SIZE
            }
        }

        // INT8 models have "int8" in name. Everything else is float.
        fun isQuantizedFromModelName(name: String): Boolean {
            return name.contains("int8", ignoreCase = true)
        }
    }

    private var interpreter: Interpreter? = null
    private var labels: List<String> = emptyList()
    private var lastInferenceTime: Long = 0L

    private var inputSize: Int = DEFAULT_INPUT_SIZE
    private var isQuantized: Boolean = false
    // When quantized models are used, some models expect raw 0..255 domain, others expect normalized 0..1.
    // preferRawInput = true means use 0..255 as 'real' value before quantization; false means use 0..1.
    private var preferRawInput: Boolean = false

    private enum class ModelFormat { YOLO_STANDARD, YOLO_TRANSPOSED, SSD }
    private var modelFormat: ModelFormat = ModelFormat.YOLO_STANDARD

    // ─── Initialize ───────────────────────────────────────────────────────────

    fun initialize(): Boolean {
        return try {
            labels = try {
                FileUtil.loadLabels(context, "models/coco_labels.txt").also {
                    Log.d(TAG, "Loaded ${it.size} labels from coco_labels.txt")
                }
            } catch (e: Exception) {
                try {
                    FileUtil.loadLabels(context, "models/labelmap.txt").also {
                        Log.d(TAG, "Loaded ${it.size} labels from labelmap.txt")
                    }
                } catch (e2: Exception) {
                    Log.w(TAG, "No label file found")
                    emptyList()
                }
            }

            // Derive inputSize and isQuantized from model name
            inputSize   = inputSizeFromModelName(modelName)
            isQuantized = isQuantizedFromModelName(modelName)
            Log.d(TAG, "Model: $modelName | inputSize=$inputSize | isQuantized=$isQuantized")

            val modelBuffer = loadModelFile("models/$modelName")
            val options = Interpreter.Options().apply {
                numThreads = this@ObjectDetector.numThreads
                useXNNPACK = true
                try {
                    val gpuDelegate = org.tensorflow.lite.gpu.GpuDelegate()
                    addDelegate(gpuDelegate)
                    Log.d(TAG, "GPU delegate enabled")
                } catch (t: Throwable) {
                    Log.w(TAG, "GPU not available, using CPU: ${t.message}")
                }
            }
            interpreter = Interpreter(modelBuffer, options)

            modelFormat = detectModelFormat()
            Log.d(TAG, "Model format detected: $modelFormat")

            // If quantized by name, attempt a lightweight autodetect to choose the right input preprocessing
            // but only if the interpreter input tensor is actually quantized (not FLOAT32).
            if (isQuantized) {
                try {
                    // autodetectInputScale will inspect the input tensor dtype and skip if float
                    preferRawInput = autodetectInputScale()
                    Log.d(TAG, "Quantized model input preprocessing preferRaw=$preferRawInput")
                } catch (e: Exception) {
                    Log.w(TAG, "Auto-detect input preprocessing failed: ${e.message}")
                }
            }

            logTensorInfo()
            true
        } catch (t: Throwable) {
            Log.e(TAG, "Initialization failed: ${t.message}", t)
            false
        }
    }

    // ─── Detect model format ──────────────────────────────────────────────────

    private fun detectModelFormat(): ModelFormat {
        val interp = interpreter ?: return ModelFormat.YOLO_STANDARD
        val shape  = interp.getOutputTensor(0).shape()
        val dim1   = shape[1]
        val dim2   = shape[2]
        if (dim2 <= 6 && dim1 >= 100) return ModelFormat.SSD
        return if (dim1 > dim2) ModelFormat.YOLO_TRANSPOSED else ModelFormat.YOLO_STANDARD
    }

    // Attempt to determine whether quantized model expects raw 0..255 or normalized 0..1 inputs.
    // Returns true if raw 0..255 appears better (higher activations) otherwise false.
    private fun autodetectInputScale(): Boolean {
        val interp = interpreter ?: return false
        try {
            // Create a gray bitmap with mid-level values
            val size = inputSize
            val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
            val canvasVals = IntArray(size * size) { 127 shl 16 or (127 shl 8) or 127 }
            bmp.setPixels(canvasVals, 0, size, 0, 0, size, size)

            // Prepare two inputs: one treating pixel as 0..255 real, one normalized to 0..1
            val inputTensor = interp.getInputTensor(0)
            val inDtype = inputTensor.dataType()
            // If the model's input tensor is FLOAT, no autodetect needed (inputs are float)
            if (inDtype.name.contains("FLOAT")) {
                bmp.recycle()
                Log.d(TAG, "autodetectInputScale: input tensor dtype is FLOAT, skipping autodetect")
                return false
            }
            val inQ = inputTensor.quantizationParams()
            val inScale = inQ?.scale ?: 1.0f
            val inZero = inQ?.zeroPoint ?: 0

            // force both runs using quantized input path; set preferRawInput flag temporarily
            val savedPref = preferRawInput

            preferRawInput = true
            val bufRaw = bitmapToByteBuffer(bmp, size, /*useQuantizedInput=*/true, inScale, inZero, inDtype.name)
            val activationRaw = runSingleActivation(interp, bufRaw)

            preferRawInput = false
            val bufNorm = bitmapToByteBuffer(bmp, size, /*useQuantizedInput=*/true, inScale, inZero, inDtype.name)
            val activationNorm = runSingleActivation(interp, bufNorm)

            bmp.recycle()
            preferRawInput = savedPref

            Log.d(TAG, "Autodetect activations: raw=$activationRaw norm=$activationNorm")
            return activationRaw >= activationNorm
        } catch (e: Exception) {
            Log.w(TAG, "autodetectInputScale failed: ${e.message}")
            return false
        }
    }

    // Run the interpreter once with the given input buffer and return a simple activation metric
    private fun runSingleActivation(interp: Interpreter, input: ByteBuffer): Float {
        val outTensor = interp.getOutputTensor(0)
        val dtype = outTensor.dataType()
        val shape = outTensor.shape()
        // For simplicity, handle flattened byte outputs for quantized, or float outputs
        return try {
            return if (dtype.name.contains("FLOAT")) {
                val outFloat = Array(1) { FloatArray(shape.reduce { a, b -> a * b }) }
                interp.run(input, outFloat)
                var sum = 0f
                val arr = outFloat[0]
                for (v in arr) sum += kotlin.math.abs(v)
                sum / arr.size
            } else {
                val outBytes = Array(1) { ByteArray(shape.reduce { a, b -> a * b }) }
                interp.run(input, outBytes)
                var sum = 0f
                val arr = outBytes[0]
                for (v in arr) sum += kotlin.math.abs((v.toInt() and 0xFF))
                sum / arr.size
            }
        } catch (e: Exception) {
            Log.w(TAG, "runSingleActivation failed: ${e.message}")
            0f
        }
    }

    // ─── Log Tensor Info ──────────────────────────────────────────────────────

    private fun logTensorInfo() {
        val interp = interpreter ?: return
        Log.d(TAG, "=== INPUT TENSORS ===")
        for (i in 0 until interp.inputTensorCount) {
            val t = interp.getInputTensor(i)
            Log.d(TAG, "  Input[$i] shape=${t.shape().contentToString()} dtype=${t.dataType()}")
        }
        Log.d(TAG, "=== OUTPUT TENSORS ===")
        for (i in 0 until interp.outputTensorCount) {
            val t = interp.getOutputTensor(i)
            Log.d(TAG, "  Output[$i] shape=${t.shape().contentToString()} dtype=${t.dataType()}")
        }
    }

    // ─── Main Detect ──────────────────────────────────────────────────────────

    fun detect(imagePath: String): List<DetectionResult> {
        val interp = interpreter ?: return emptyList()
        return try {
            val bitmap    = decodeBitmap(imagePath) ?: return emptyList()
            val processed = preprocessBitmap(bitmap, inputSize)
            val startTime = SystemClock.uptimeMillis()

            val results = when (modelFormat) {
                ModelFormat.SSD             -> runSsdInference(interp, processed)
                ModelFormat.YOLO_STANDARD   -> runYoloInference(interp, processed, transposed = false)
                ModelFormat.YOLO_TRANSPOSED -> runYoloInference(interp, processed, transposed = true)
            }

            // If quantized *at runtime* (interpreter input tensor) produced no detections, try the opposite input preprocessing and retry once.
            val inputTensor = interp.getInputTensor(0)
            val inputIsQuantized = !inputTensor.dataType().name.contains("FLOAT")
            if (inputIsQuantized && results.isEmpty()) {
                Log.d(TAG, "No detections on quantized *input tensor* with preferRaw=$preferRawInput — retrying with flipped input mode (input.dtype=${inputTensor.dataType()})")
                preferRawInput = !preferRawInput
                val retryResults = when (modelFormat) {
                    ModelFormat.SSD             -> runSsdInference(interp, processed)
                    ModelFormat.YOLO_STANDARD   -> runYoloInference(interp, processed, transposed = false)
                    ModelFormat.YOLO_TRANSPOSED -> runYoloInference(interp, processed, transposed = true)
                }
                if (retryResults.isNotEmpty()) {
                    Log.d(TAG, "Retry with preferRaw=$preferRawInput produced ${retryResults.size} detections — using retry results")
                    lastInferenceTime = SystemClock.uptimeMillis() - startTime
                    bitmap.recycle()
                    processed.recycle()
                    return retryResults
                } else {
                    Log.d(TAG, "Retry also returned zero detections; keeping original empty results")
                    // revert preferRawInput back to original to avoid changing behavior permanently
                    preferRawInput = !preferRawInput
                }
            }

            lastInferenceTime = SystemClock.uptimeMillis() - startTime
            Log.d(TAG, "Inference: ${lastInferenceTime}ms | $modelFormat | ${results.size} detections")

            bitmap.recycle()
            processed.recycle()
            results
        } catch (e: Exception) {
            Log.e(TAG, "Detection error: ${e.message}", e)
            emptyList()
        }
    }

    // ─── SSD Inference ────────────────────────────────────────────────────────

    private fun runSsdInference(interp: Interpreter, bitmap: Bitmap): List<DetectionResult> {
        // Prepare input buffer using input tensor quantization params when available
        val inputTensor = interp.getInputTensor(0)
        val inDtype = inputTensor.dataType()
        val inQ = inputTensor.quantizationParams()
        val inScale = inQ?.scale ?: 1.0f
        val inZero = inQ?.zeroPoint ?: 0
        // Decide whether to feed quantized bytes or float values based on input tensor dtype
        val useQuantizedInput = !inDtype.name.contains("FLOAT")
        // Build an input buffer that exactly matches the interpreter's input tensor layout and dtype
        val inputBuffer = createInputBufferFromBitmap(bitmap, inputTensor)
        if (isQuantized) {
            try {
                Log.d(TAG, "[INT8 DEBUG] modelName=${modelName} nameIsQuantized=${isQuantized} inputTensor.dtype=${inDtype} in.scale=${inScale} in.zero=${inZero} preferRaw=$preferRawInput useQuantIn=${useQuantizedInput}")
                // peek first few bytes
                val sampleBytes = ByteArray(12)
                inputBuffer.get(sampleBytes, 0, 12)
                // reset position
                inputBuffer.rewind()
                val sampleVals = sampleBytes.map { it.toInt() and 0xFF }
                Log.d(TAG, "[INT8 DEBUG] in.sample.bytes=${sampleVals}")
            } catch (e: Exception) {
                Log.w(TAG, "[INT8 DEBUG] input logging failed: ${e.message}")
            }
        }
        val outputShape   = interp.getOutputTensor(0).shape()
        val numCandidates = outputShape[1]
    val outTensor = interp.getOutputTensor(0)
        val dtype = outTensor.dataType()

        // prepare float output container; if model output is quantized, we dequantize below
        val outputData = Array(1) { Array(numCandidates) { FloatArray(6) } }

        if (dtype.name.contains("FLOAT")) {
            interp.run(inputBuffer, outputData)
        } else {
            // quantized output (UINT8 / INT8)
            val qOutput = Array(1) { Array(numCandidates) { ByteArray(6) } }
            interp.run(inputBuffer, qOutput)
            // Debug logging for quantized outputs
            try {
                val qParamsOut = outTensor.quantizationParams()
                Log.d(TAG, "[INT8 DEBUG] out.dtype=${dtype} out.scale=${qParamsOut?.scale} out.zero=${qParamsOut?.zeroPoint}")
                // Log first candidate raw bytes and dequantized floats
                if (qOutput.isNotEmpty() && qOutput[0].isNotEmpty()) {
                    val sample = qOutput[0][0]
                    val sampleVals = sample.map { it.toInt() and 0xFF }
                    Log.d(TAG, "[INT8 DEBUG] out.sample.raw=${sampleVals}")
                }
                val activation = runSingleActivation(interp, inputBuffer)
                Log.d(TAG, "[INT8 DEBUG] activationAfterRun=$activation")
            } catch (e: Exception) {
                Log.w(TAG, "[INT8 DEBUG] output logging failed: ${e.message}")
            }
            val qParams = outTensor.quantizationParams()
            val scale = qParams?.scale ?: 1.0f
            val zeroPoint = qParams?.zeroPoint ?: 0
            for (i in 0 until numCandidates) {
                for (j in 0 until 6) {
                    val raw = qOutput[0][i][j]
                    val v = if (dtype.name.contains("UINT8")) {
                        ((raw.toInt() and 0xFF) - zeroPoint) * scale
                    } else {
                        (raw.toInt() - zeroPoint) * scale
                    }
                    outputData[0][i][j] = v
                }
            }
        }

        val detections = mutableListOf<DetectionResult>()
        for (i in 0 until numCandidates) {
            val row     = outputData[0][i]
            val xmin    = row[0].coerceIn(0f, 1f)
            val ymin    = row[1].coerceIn(0f, 1f)
            val xmax    = row[2].coerceIn(0f, 1f)
            val ymax    = row[3].coerceIn(0f, 1f)
            val score   = sigmoid(row[4])
            val classId = row[5].toInt()
            if (score < threshold) continue
            val boxW = xmax - xmin
            val boxH = ymax - ymin
            if (boxW <= 0f || boxH <= 0f) continue
            val label = if (classId < labels.size) labels[classId] else "unknown"

            Log.d(TAG, "YOLO26[$i]: $label score=${"%.3f".format(score)} " +
                    "logit=${"%.1f".format(row[4])} " +
                    "box=[${xmin.fmt()},${ymin.fmt()},${xmax.fmt()},${ymax.fmt()}]")

            detections.add(DetectionResult(
                label      = label,
                confidence = score,
                left       = xmin,
                top        = ymin,
                right      = xmax,
                bottom     = ymax,
                width      = boxW,
                height     = boxH
            ))
        }

        // YOLO26 NMS is done internally — just sort and cap
        return detections
            .sortedByDescending { it.confidence }
            .take(maxDetections)
    }

    // ─── YOLO Inference ───────────────────────────────────────────────────────

    private fun runYoloInference(
        interp: Interpreter,
        bitmap: Bitmap,
        transposed: Boolean
    ): List<DetectionResult> {
        val inputTensor = interp.getInputTensor(0)
        val inDtype = inputTensor.dataType()
        val inQ = inputTensor.quantizationParams()
        val inScale = inQ?.scale ?: 1.0f
        val inZero = inQ?.zeroPoint ?: 0
        val useQuantizedInput = !inDtype.name.contains("FLOAT")
        // Build an input buffer that exactly matches the interpreter's input tensor layout and dtype
        val inputBuffer = createInputBufferFromBitmap(bitmap, inputTensor)
        if (isQuantized) {
            try {
                Log.d(TAG, "[INT8 DEBUG] modelName=${modelName} nameIsQuantized=${isQuantized} inputTensor.dtype=${inDtype} in.scale=${inScale} in.zero=${inZero} preferRaw=$preferRawInput useQuantIn=${useQuantizedInput}")
                val sampleBytes = ByteArray(12)
                inputBuffer.get(sampleBytes, 0, 12)
                inputBuffer.rewind()
                val sampleVals = sampleBytes.map { it.toInt() and 0xFF }
                Log.d(TAG, "[INT8 DEBUG] in.sample.bytes=${sampleVals}")
            } catch (e: Exception) {
                Log.w(TAG, "[INT8 DEBUG] yolo input logging failed: ${e.message}")
            }
        }
        val outputShape = interp.getOutputTensor(0).shape()
        val numAnchors  = if (transposed) outputShape[1] else outputShape[2]
        val numFields   = if (transposed) outputShape[2] else outputShape[1]
        val detections  = mutableListOf<DetectionResult>()

        if (transposed) {
            val outTensor = interp.getOutputTensor(0)
            val dtype = outTensor.dataType()

            val outputData = Array(1) { Array(numAnchors) { FloatArray(numFields) } }

            if (dtype.name.contains("FLOAT")) {
                interp.run(inputBuffer, outputData)
            } else {
                val qOutput = Array(1) { Array(numAnchors) { ByteArray(numFields) } }
                interp.run(inputBuffer, qOutput)
                try {
                    val qParamsOut = outTensor.quantizationParams()
                    Log.d(TAG, "[INT8 DEBUG] out.dtype=${dtype} out.scale=${qParamsOut?.scale} out.zero=${qParamsOut?.zeroPoint}")
                    if (qOutput.isNotEmpty() && qOutput[0].isNotEmpty()) {
                        val sample = qOutput[0][0]
                        val sampleVals = sample.map { it.toInt() and 0xFF }
                        Log.d(TAG, "[INT8 DEBUG] yolo.out.sample.raw=${sampleVals.take(8)}")
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "[INT8 DEBUG] yolo output logging failed: ${e.message}")
                }
                val qParams = outTensor.quantizationParams()
                val scale = qParams?.scale ?: 1.0f
                val zeroPoint = qParams?.zeroPoint ?: 0
                for (i in 0 until numAnchors) {
                    for (f in 0 until numFields) {
                        val raw = qOutput[0][i][f]
                        val v = if (dtype.name.contains("UINT8")) {
                            ((raw.toInt() and 0xFF) - zeroPoint) * scale
                        } else {
                            (raw.toInt() - zeroPoint) * scale
                        }
                        outputData[0][i][f] = v
                    }
                }
            }
            for (i in 0 until numAnchors) {
                var bestScore = 0f; var bestClass = 0
                for (c in 4 until numFields) {
                    val score = sigmoid(outputData[0][i][c])
                    if (score > bestScore) { bestScore = score; bestClass = c - 4 }
                }
                if (bestScore < threshold) continue
                buildDetection(outputData[0][i][0], outputData[0][i][1],
                               outputData[0][i][2], outputData[0][i][3],
                               bestScore, bestClass, i)?.let { detections.add(it) }
            }
        } else {
            val outTensor = interp.getOutputTensor(0)
            val dtype = outTensor.dataType()

            val outputData = Array(1) { Array(numFields) { FloatArray(numAnchors) } }

            if (dtype.name.contains("FLOAT")) {
                interp.run(inputBuffer, outputData)
            } else {
                val qOutput = Array(1) { Array(numFields) { ByteArray(numAnchors) } }
                interp.run(inputBuffer, qOutput)
                try {
                    val qParamsOut = outTensor.quantizationParams()
                    Log.d(TAG, "[INT8 DEBUG] out.dtype=${dtype} out.scale=${qParamsOut?.scale} out.zero=${qParamsOut?.zeroPoint}")
                    if (qOutput.isNotEmpty() && qOutput[0].isNotEmpty()) {
                        val sample = qOutput[0][0]
                        val sampleVals = sample.map { it.toInt() and 0xFF }
                        Log.d(TAG, "[INT8 DEBUG] yolo2.out.sample.raw=${sampleVals.take(8)}")
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "[INT8 DEBUG] yolo2 output logging failed: ${e.message}")
                }
                val qParams = outTensor.quantizationParams()
                val scale = qParams?.scale ?: 1.0f
                val zeroPoint = qParams?.zeroPoint ?: 0
                for (f in 0 until numFields) {
                    for (i in 0 until numAnchors) {
                        val raw = qOutput[0][f][i]
                        val v = if (dtype.name.contains("UINT8")) {
                            ((raw.toInt() and 0xFF) - zeroPoint) * scale
                        } else {
                            (raw.toInt() - zeroPoint) * scale
                        }
                        outputData[0][f][i] = v
                    }
                }
            }
            for (i in 0 until numAnchors) {
                var bestScore = 0f; var bestClass = 0
                for (c in 4 until numFields) {
                    val score = outputData[0][c][i]
                    if (score > bestScore) { bestScore = score; bestClass = c - 4 }
                }
                if (bestScore < threshold) continue
                buildDetection(outputData[0][0][i], outputData[0][1][i],
                               outputData[0][2][i], outputData[0][3][i],
                               bestScore, bestClass, i)?.let { detections.add(it) }
            }
        }

        return nonMaxSuppression(
            detections.sortedByDescending { it.confidence },
            iouThreshold  = 0.45f,
            maxDetections = maxDetections
        )
    }

    private fun buildDetection(
        cx: Float, cy: Float, w: Float, h: Float,
        bestScore: Float, bestClass: Int, anchor: Int
    ): DetectionResult? {
        val ncx  = if (cx > 1.0f) cx / inputSize else cx
        val ncy  = if (cy > 1.0f) cy / inputSize else cy
        val nw   = if (w  > 1.0f) w  / inputSize else w
        val nh   = if (h  > 1.0f) h  / inputSize else h
        val xmin = (ncx - nw / 2).coerceIn(0f, 1f)
        val ymin = (ncy - nh / 2).coerceIn(0f, 1f)
        val xmax = (ncx + nw / 2).coerceIn(0f, 1f)
        val ymax = (ncy + nh / 2).coerceIn(0f, 1f)
        val boxW = xmax - xmin
        val boxH = ymax - ymin
        if (boxW <= 0f || boxH <= 0f) return null
        val label = if (bestClass < labels.size) labels[bestClass] else "unknown"
        return DetectionResult(label, bestScore, xmin, ymin, xmax, ymax, boxW, boxH)
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private fun sigmoid(x: Float): Float = 1f / (1f + Math.exp(-x.toDouble()).toFloat())
    private fun Float.fmt() = "%.3f".format(this)

    private fun nonMaxSuppression(
        detections: List<DetectionResult>,
        iouThreshold: Float,
        maxDetections: Int
    ): List<DetectionResult> {
        val selected   = mutableListOf<DetectionResult>()
        val suppressed = BooleanArray(detections.size)
        for (i in detections.indices) {
            if (suppressed[i]) continue
            selected.add(detections[i])
            if (selected.size >= maxDetections) break
            for (j in i + 1 until detections.size) {
                if (!suppressed[j] && iou(detections[i], detections[j]) > iouThreshold)
                    suppressed[j] = true
            }
        }
        return selected
    }

    private fun iou(a: DetectionResult, b: DetectionResult): Float {
        val iW = maxOf(0f, minOf(a.right, b.right)   - maxOf(a.left, b.left))
        val iH = maxOf(0f, minOf(a.bottom, b.bottom) - maxOf(a.top, b.top))
        val iArea = iW * iH
        val uArea = a.width * a.height + b.width * b.height - iArea
        return if (uArea <= 0f) 0f else iArea / uArea
    }

    private fun decodeBitmap(imagePath: String): Bitmap? {
        return try {
            val path = imagePath.removePrefix("file://")
            val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(path, opts)
            val targetSize = inputSize * 2
            opts.inSampleSize = maxOf(1, minOf(opts.outWidth, opts.outHeight) / targetSize)
            opts.inJustDecodeBounds = false
            opts.inPreferredConfig = Bitmap.Config.ARGB_8888
            BitmapFactory.decodeFile(path, opts)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to decode bitmap: ${e.message}")
            null
        }
    }

    private fun preprocessBitmap(bitmap: Bitmap, size: Int): Bitmap {
        if (bitmap.width == size && bitmap.height == size) return bitmap
        return Bitmap.createScaledBitmap(bitmap, size, size, true)
    }

    private fun bitmapToByteBuffer(bitmap: Bitmap, inputSize: Int, isQuantized: Boolean): ByteBuffer {
        // legacy compatibility: keep original signature by delegating with neutral quant params
        return bitmapToByteBuffer(bitmap, inputSize, isQuantized, 1.0f, 0, "FLOAT")
    }

    private fun bitmapToByteBuffer(bitmap: Bitmap, inputSize: Int, isQuantized: Boolean, inScale: Float, inZeroPoint: Int, dtypeName: String): ByteBuffer {
        // Determine bytes per channel from tensor dtype (safety) and allocate exact buffer
        val bytesPerChannel = when {
            isQuantized && dtypeName.contains("UINT8") -> 1
            isQuantized && dtypeName.contains("INT8")  -> 1
            isQuantized -> 1
            else -> 4
        }
        // Protect against degenerate scale (zero) which causes division by zero / NaN
        val safeInScale = if (inScale <= 0f || inScale.isNaN()) 1.0f else inScale
        val buffer = ByteBuffer.allocateDirect(inputSize * inputSize * 3 * bytesPerChannel)
        buffer.order(ByteOrder.nativeOrder())

        val argbBitmap = if (bitmap.config == Bitmap.Config.ARGB_8888) bitmap
                         else bitmap.copy(Bitmap.Config.ARGB_8888, false)

        val pixels = IntArray(inputSize * inputSize)
        argbBitmap.getPixels(pixels, 0, inputSize, 0, 0, inputSize, inputSize)
        if (argbBitmap !== bitmap) argbBitmap.recycle()

        for (pixel in pixels) {
            val r = (pixel shr 16) and 0xFF
            val g = (pixel shr 8)  and 0xFF
            val b =  pixel         and 0xFF
            if (isQuantized) {
                // Model expects quantized inputs. Choose real_value either as raw 0..255 or normalized 0..1
                val rf = if (preferRawInput) r.toFloat() else r / 255.0f
                val gf = if (preferRawInput) g.toFloat() else g / 255.0f
                val bf = if (preferRawInput) b.toFloat() else b / 255.0f
                // q = round(real / scale) + zeroPoint  (use safeInScale to avoid NaN/Inf)
                val rqf = (rf / safeInScale + inZeroPoint)
                val gqf = (gf / safeInScale + inZeroPoint)
                val bqf = (bf / safeInScale + inZeroPoint)
                // If any value is NaN/Infinite, fallback to zero-point
                val rq = if (rqf.isFinite()) rqf.roundToInt() else inZeroPoint
                val gq = if (gqf.isFinite()) gqf.roundToInt() else inZeroPoint
                val bq = if (bqf.isFinite()) bqf.roundToInt() else inZeroPoint
                if (dtypeName.contains("UINT8")) {
                    buffer.put((rq and 0xFF).toByte())
                    buffer.put((gq and 0xFF).toByte())
                    buffer.put((bq and 0xFF).toByte())
                } else {
                    // INT8 (signed) - clamp to -128..127
                    buffer.put(rq.coerceIn(-128, 127).toByte())
                    buffer.put(gq.coerceIn(-128, 127).toByte())
                    buffer.put(bq.coerceIn(-128, 127).toByte())
                }
            } else {
                buffer.putFloat(r / 255.0f)
                buffer.putFloat(g / 255.0f)
                buffer.putFloat(b / 255.0f)
            }
        }
        buffer.rewind()
        return buffer
    }

    // Construct an input ByteBuffer using the interpreter's input tensor as the source of truth for dtype and shape
    private fun createInputBufferFromBitmap(bitmap: Bitmap, inputTensor: org.tensorflow.lite.Tensor): ByteBuffer {
        val dtypeName = inputTensor.dataType().name
        val q = inputTensor.quantizationParams()
        val scale = q?.scale ?: 1.0f
        val zp = q?.zeroPoint ?: 0
        // Compute expected bytes from tensor shape
        return try {
            val shapeElems = inputTensor.shape().reduce { a, b -> a * b }
            val bytesPerElem = if (dtypeName.contains("FLOAT")) 4 else 1
            val expectedBytes = shapeElems * bytesPerElem
            Log.d(TAG, "createInputBufferFromBitmap: inputTensor.shape=${inputTensor.shape().contentToString()} dtype=$dtypeName expectedBytes=$expectedBytes scale=$scale zeroPoint=$zp")

            val buf = bitmapToByteBuffer(bitmap, inputSize, /*isQuantized=*/!dtypeName.contains("FLOAT"), scale, zp, dtypeName)

            if (buf.capacity() == expectedBytes) {
                Log.d(TAG, "createInputBufferFromBitmap: buffer size matches expected=$expectedBytes")
                return buf
            }

            // If sizes differ, allocate an interpreter-sized buffer and copy/pad the generated data.
            Log.w(TAG, "createInputBufferFromBitmap: built buffer size=${buf.capacity()} but interpreter expects=${expectedBytes}; creating adjusted buffer and copying data")
            val fixed = ByteBuffer.allocateDirect(expectedBytes).order(ByteOrder.nativeOrder())
            buf.rewind()
            // Copy available bytes
            val toCopy = minOf(buf.capacity(), fixed.capacity())
            val temp = ByteArray(toCopy)
            buf.get(temp, 0, toCopy)
            fixed.put(temp)

            // Pad remaining bytes with reasonable defaults
            if (fixed.hasRemaining()) {
                if (dtypeName.contains("FLOAT")) {
                    while (fixed.hasRemaining()) fixed.putFloat(0.0f)
                } else {
                    // for quantized inputs, pad with zeroPoint
                    val padByte: Byte = (zp and 0xFF).toByte()
                    while (fixed.hasRemaining()) fixed.put(padByte)
                }
                Log.d(TAG, "createInputBufferFromBitmap: padded ${fixed.capacity() - toCopy} bytes")
            }
            fixed.rewind()
            fixed
        } catch (e: Exception) {
            Log.w(TAG, "createInputBufferFromBitmap failed: ${e.message}")
            // Fallback: best-effort buffer
            bitmapToByteBuffer(bitmap, inputSize, /*isQuantized=*/false, 1.0f, 0, "FLOAT")
        }
    }

    @Throws(IOException::class)
    private fun loadModelFile(assetPath: String): MappedByteBuffer {
        val afd    = context.assets.openFd(assetPath)
        val stream = FileInputStream(afd.fileDescriptor)
        return stream.channel.map(FileChannel.MapMode.READ_ONLY, afd.startOffset, afd.declaredLength)
    }

    fun getLastInferenceTime(): Long = lastInferenceTime
    fun isInitialized(): Boolean     = interpreter != null

    fun close() {
        interpreter?.close()
        interpreter = null
        Log.d(TAG, "ObjectDetector closed")
    }
}