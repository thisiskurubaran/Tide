package dev.tide.pythonruntime

import android.os.Handler
import android.os.Looper
import com.chaquo.python.PyObject
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PythonRuntimeModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private val pending = mutableListOf<Triple<String, String, String>>()
  private var flushScheduled = false

  private fun runner(): PyObject {
    if (!Python.isStarted()) {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      Python.start(AndroidPlatform(context))
    }
    return Python.getInstance().getModule("tide_runner")
  }

  // Merges consecutive chunks for the same run and stream into one event per frame.
  private fun flush() {
    val chunks: List<Triple<String, String, String>>
    synchronized(pending) {
      flushScheduled = false
      chunks = pending.toList()
      pending.clear()
    }
    val merged = mutableListOf<Triple<String, String, String>>()
    for (c in chunks) {
      val last = merged.lastOrNull()
      if (last != null && last.first == c.first && last.second == c.second) {
        merged[merged.size - 1] = Triple(last.first, last.second, last.third + c.third)
      } else {
        merged.add(c)
      }
    }
    for ((id, kind, text) in merged) sendEvent("onOutput", mapOf("id" to id, "kind" to kind, "data" to text))
  }

  // Called from Python as emit(run_id, kind, text).
  inner class Emitter {
    fun emit(runId: String, kind: String, text: String) {
      synchronized(pending) {
        pending.add(Triple(runId, kind, text))
        if (!flushScheduled) {
          flushScheduled = true
          main.postDelayed({ flush() }, FLUSH_MS)
        }
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("PythonRuntime")

    Events("onOutput", "onExit")

    AsyncFunction("version") {
      runner().callAttr("version").toString()
    }

    AsyncFunction("snippet") { code: String ->
      runner().callAttr("snippet", code).toString()
    }

    AsyncFunction("run") { id: String, entry: String, cwd: String, args: List<String>, extraPaths: List<String>, purgeRoot: String ->
      val module = runner()
      val emit = PyObject.fromJava(Emitter()).get("emit")
      Thread(null, {
        var code = 1
        var killed = false
        try {
          val result = module.callAttr("run", emit, id, entry, cwd, args.toTypedArray(), extraPaths.toTypedArray(), purgeRoot).asList()
          code = result[0].toInt()
          killed = result[1].toBoolean()
        } catch (e: Throwable) {
          Emitter().emit(id, "stderr", "Python runner failed: ${e.message}\n")
        }
        // Deliver the run's last output before its exit.
        main.post {
          flush()
          sendEvent("onExit", mapOf("id" to id, "code" to code, "killed" to killed))
        }
      }, "python-run-$id", STACK_SIZE).start()
    }

    AsyncFunction("write") { id: String, data: String ->
      runner().callAttr("feed", id, data)
    }

    AsyncFunction("eof") { id: String ->
      runner().callAttr("eof", id)
    }

    AsyncFunction("kill") { id: String ->
      runner().callAttr("kill", id)
    }
  }

  companion object {
    private const val FLUSH_MS = 16L
    // Python recursion needs more than the default thread stack.
    private const val STACK_SIZE = 8L * 1024 * 1024
  }
}
