package com.rpsignage.app;

import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;

import androidx.annotation.NonNull;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";

    private void hideSystemBars() {
        try {
            View decorView = getWindow().getDecorView();
            int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
            decorView.setSystemUiVisibility(flags);
        } catch (Exception e) {
            Log.w(TAG, "Unable to hide system bars", e);
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }

        hideSystemBars();
    }

    @Override
    public void onResume() {
        super.onResume();
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    // Workaround: catch IllegalStateException that can occur when WebView permission
    // requests are delivered and the Chromium PermissionRequest has already been
    // granted/denied by another path. Without this the app can crash with
    // "Either grant() or deny() has been already called." — we log and ignore it.
    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        try {
            super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        } catch (IllegalStateException e) {
            Log.w(TAG, "Ignored IllegalStateException in onRequestPermissionsResult: " + e.getMessage());
        } catch (Exception e) {
            // Preserve other exceptions
            Log.e(TAG, "Unexpected exception in onRequestPermissionsResult", e);
            try {
                super.onRequestPermissionsResult(requestCode, permissions, grantResults);
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void onActivityResult(int requestCode, int resultCode, android.content.Intent data) {
        try {
            super.onActivityResult(requestCode, resultCode, data);
        } catch (IllegalStateException e) {
            Log.w(TAG, "Ignored IllegalStateException in onActivityResult: " + e.getMessage());
        } catch (Exception e) {
            Log.e(TAG, "Unexpected exception in onActivityResult", e);
            try { super.onActivityResult(requestCode, resultCode, data); } catch (Exception ignored) {}
        }
    }
}
