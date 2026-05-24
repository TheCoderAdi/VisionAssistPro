package com.visionassistpro.tflite

import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = TFLiteModule.NAME)
class TFLiteModule(
    private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "TFLiteModule"
        private const val TAG = "TFLiteModule"
    }

    private var detector: ObjectDetector? = null
    private var currentModelName: String = ""
    private var currentThreshold: Float = 0f

    override fun getName(): String = NAME

    // ─── Load Model ─────────────────────────────────────────────────────────────

    @ReactMethod
    fun loadModel(
        modelName: String,
        threshold: Double,
        maxDetections: Int,
        numThreads: Int,
        promise: Promise,
    ) {
        Thread {
            try {
                // Close previous detector if switching models
                if (currentModelName != modelName) {
                    detector?.close()
                    detector = null
                }

                if (detector != null && detector!!.isInitialized() && currentModelName == modelName && currentThreshold == threshold.toFloat()) {
                    promise.resolve(Arguments.createMap().apply {
                        putBoolean("success", true)
                        putString("message", "Model already loaded: $modelName")
                    })
                    return@Thread
                }

                Log.d(TAG, "Loading model: $modelName")

                detector = ObjectDetector(
                    context = reactContext,
                    modelName = modelName,
                    threshold = threshold.toFloat(),
                    maxDetections = maxDetections,
                    numThreads = numThreads
                )

                val initialized = detector!!.initialize()

                if (initialized) {
                    currentModelName = modelName
                    Log.d(TAG, "Model loaded successfully: $modelName")
                    promise.resolve(
                        Arguments.createMap().apply {
                            putBoolean("success", true)
                            putString("message", "Model loaded: $modelName")
                            putString("modelName", modelName)
                        }
                    )
                } else {
                    detector = null
                    promise.reject(
                        "MODEL_LOAD_FAILED",
                        "Failed to initialize model: $modelName"
                    )
                }
            } catch (e: Exception) {
                Log.e(TAG, "loadModel error: ${e.message}", e)
                detector = null
                promise.reject("MODEL_LOAD_ERROR", e.message ?: "Unknown error", e)
            }
        }.start()
    }

    // ─── Run Detection ───────────────────────────────────────────────────────────

    @ReactMethod
    fun detectObjects(
        imagePath: String,
        promise: Promise
    ) {
        val det = detector

        if (det == null || !det.isInitialized()) {
            promise.reject("MODEL_NOT_LOADED", "Model is not loaded. Call loadModel first.")
            return
        }

        Thread {
            try {
                val startTime = System.currentTimeMillis()
                val results = det.detect(imagePath)
                val inferenceTime = det.getLastInferenceTime()
                val totalTime = System.currentTimeMillis() - startTime

                // Convert results to JS-readable WritableArray
                val detectionsArray = Arguments.createArray()

                results.forEach { result ->
                    val item = Arguments.createMap().apply {
                        putString("label", result.label)
                        putDouble("confidence", result.confidence.toDouble())
                        putDouble("left", result.left.toDouble())
                        putDouble("top", result.top.toDouble())
                        putDouble("right", result.right.toDouble())
                        putDouble("bottom", result.bottom.toDouble())
                        putDouble("width", result.width.toDouble())
                        putDouble("height", result.height.toDouble())
                    }
                    detectionsArray.pushMap(item)
                }

                val response = Arguments.createMap().apply {
                    putArray("detections", detectionsArray)
                    putDouble("inferenceTime", inferenceTime.toDouble())
                    putDouble("totalTime", totalTime.toDouble())
                    putInt("count", results.size)
                }

                promise.resolve(response)
            } catch (e: Exception) {
                Log.e(TAG, "detectObjects error: ${e.message}", e)
                promise.reject("DETECTION_ERROR", e.message ?: "Detection failed", e)
            }
        }.start()
    }

    // ─── Get Model Info ──────────────────────────────────────────────────────────

    @ReactMethod
    fun getModelInfo(promise: Promise) {
        val info = Arguments.createMap().apply {
            putBoolean("isLoaded", detector?.isInitialized() ?: false)
            putString("currentModel", currentModelName)
            putDouble("lastInferenceTime",
                (detector?.getLastInferenceTime() ?: 0L).toDouble()
            )
        }
        promise.resolve(info)
    }

    // ─── Close Model ─────────────────────────────────────────────────────────────

    @ReactMethod
    fun closeModel(promise: Promise) {
        try {
            detector?.close()
            detector = null
            currentModelName = ""
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CLOSE_ERROR", e.message)
        }
    }

    // ─── Required for React Native New Architecture ───────────────────────────────

    override fun canOverrideExistingModule(): Boolean = false

    override fun invalidate() {
        super.invalidate()
        detector?.close()
        detector = null
    }
}