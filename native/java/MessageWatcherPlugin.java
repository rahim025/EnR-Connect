package com.enrconnect.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;
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
        try {
            Intent i = new Intent(c, WatcherService.class);
            ContextCompat.startForegroundService(c, i);
        } catch (Exception ex) {
            // Le téléphone refuse le service en arrière-plan : l'appli continue sans notifications
            android.util.Log.w("EnR", "Démarrage du service refusé : " + ex);
        }
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

    @PluginMethod
    public void microGranted(PluginCall call) {
        boolean ok = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        com.getcapacitor.JSObject r = new com.getcapacitor.JSObject();
        r.put("granted", ok);
        call.resolve(r);
    }

    /* Ouvre la page des réglages de l'appli (utile si le micro a été refusé définitivement) */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}
