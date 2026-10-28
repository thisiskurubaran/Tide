package dev.tide.pythonruntime

import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PythonRuntimeModule : Module() {
  private fun runner(): com.chaquo.python.PyObject {
    if (!Python.isStarted()) {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      Python.start(AndroidPlatform(context))
    }
    return Python.getInstance().getModule("tide_runner")
  }

  override fun definition() = ModuleDefinition {
    Name("PythonRuntime")

    AsyncFunction("version") {
      runner().callAttr("version").toString()
    }

    AsyncFunction("run") { code: String ->
      runner().callAttr("run", code).toString()
    }
  }
}
