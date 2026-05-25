package com.rpsignage.flutter_native_signage

import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.android.FlutterActivity
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
	private val kioskChannel = "rpsignage/kiosk"
	private val adminComponent by lazy {
		ComponentName(this, KioskDeviceAdminReceiver::class.java)
	}

	override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
		super.configureFlutterEngine(flutterEngine)

		MethodChannel(flutterEngine.dartExecutor.binaryMessenger, kioskChannel)
			.setMethodCallHandler { call, result ->
				when (call.method) {
					"setKioskMode" -> {
						val enabled = call.argument<Boolean>("enabled") ?: false
						try {
							result.success(applyKioskMode(enabled))
						} catch (e: Exception) {
							result.error("KIOSK_ERROR", e.message, null)
						}
					}

					"getKioskStatus" -> {
						result.success(kioskStatus())
					}

					else -> result.notImplemented()
				}
			}
	}

	private fun applyKioskMode(enabled: Boolean): Map<String, Any> {
		val dpm = getSystemService(DevicePolicyManager::class.java)
		val isDeviceOwner = dpm?.isDeviceOwnerApp(packageName) == true

		if (enabled && isDeviceOwner && dpm != null) {
			dpm.setLockTaskPackages(adminComponent, arrayOf(packageName))
		}

		val lockTaskPermitted = dpm?.isLockTaskPermitted(packageName) == true
		val strictReady = isDeviceOwner && lockTaskPermitted

		if (enabled) {
			if (strictReady) {
				startLockTask()
			}
		} else {
			try {
				stopLockTask()
			} catch (_: Exception) {
				// Ignore if lock task was not active.
			}
		}

		val active = isLockTaskActive()
		return mapOf(
			"requestedEnabled" to enabled,
			"active" to active,
			"deviceOwner" to isDeviceOwner,
			"lockTaskPermitted" to lockTaskPermitted,
			"strictReady" to strictReady,
		)
	}

	private fun kioskStatus(): Map<String, Any> {
		val dpm = getSystemService(DevicePolicyManager::class.java)
		val isDeviceOwner = dpm?.isDeviceOwnerApp(packageName) == true
		val lockTaskPermitted = dpm?.isLockTaskPermitted(packageName) == true
		return mapOf(
			"active" to isLockTaskActive(),
			"deviceOwner" to isDeviceOwner,
			"lockTaskPermitted" to lockTaskPermitted,
			"strictReady" to (isDeviceOwner && lockTaskPermitted),
		)
	}

	@Suppress("DEPRECATION")
	private fun isLockTaskActive(): Boolean {
		val am = getSystemService(ActivityManager::class.java) ?: return false
		return try {
			am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE
		} catch (_: Exception) {
			am.isInLockTaskMode
		}
	}
}
