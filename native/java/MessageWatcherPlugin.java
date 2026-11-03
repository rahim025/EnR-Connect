package com.enrconnect.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MessageWatcher")
public class MessageWatcherPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        Context c = getContext();
        SharedPreferences p = Api.prefs(c);
        String uid = call.getString("uid", "");
        SharedPreferences.Editor e = p.edit();
        if (!uid.equals(p.getString("uid", ""))) e.putLong("since", 0); // autre compte : on repart de maintenant
        e.putString("apiKey", call.getString("apiKey", ""))
                .putString("project", call.getString("project", ""))
                .putString("refresh", call.getString("refresh", ""))
                .putString("uid", uid)
                .putString("name", call.getString("name", ""))
                .putInt("seconds", call.getInt("seconds", 60))
                .putString("idToken", null)
                .putLong("idExp", 0)
                .apply();
        Intent i = new Intent(c, WatcherService.class);
        ContextCompat.startForegroundService(c, i);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context c = getContext();
        c.stopService(new Intent(c, WatcherService.class));
        Api.prefs(c).edit().clear().apply();
        Notifier.clear(c);
        call.resolve();
    }

    @PluginMethod
    public void setForeground(PluginCall call) {
        boolean v = call.getBoolean("value", true);
        Watch.premierPlan = v;
        if (v) Notifier.clear(getContext());
        call.resolve();
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getActivity() != null
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(getActivity(), new String[]{Manifest.permission.POST_NOTIFICATIONS}, 4242);
        }
        call.resolve();
    }
}
