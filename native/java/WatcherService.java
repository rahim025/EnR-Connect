package com.enrconnect.app;

import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;

/** Service au premier plan : vérifie les nouveaux messages et déclenche la notification. */
public class WatcherService extends Service {
    private volatile boolean actif = false;
    private Thread boucle;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(2, Notifier.pourService(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(2, Notifier.pourService(this));
        }
        if (!actif) {
            actif = true;
            boucle = new Thread(this::tourner, "enr-veille");
            boucle.start();
        }
        return START_STICKY;
    }

    private void tourner() {
        while (actif) {
            try {
                verifier();
            } catch (Exception e) {
                Log.w("EnR", "Vérification impossible : " + e.getMessage());
            }
            int s = Math.max(20, Api.prefs(this).getInt("seconds", 60));
            try {
                Thread.sleep(s * 1000L);
            } catch (InterruptedException e) {
                return;
            }
        }
    }

    private void verifier() throws Exception {
        SharedPreferences p = Api.prefs(this);
        if (p.getString("refresh", "").isEmpty()) { stopSelf(); return; }
        long depuis = p.getLong("since", 0);
        if (depuis == 0) {
            depuis = System.currentTimeMillis();
            p.edit().putLong("since", depuis).apply();
        }
        List<Api.Msg> liste = Api.fetchSince(this, depuis);
        if (liste.isEmpty()) return;
        long max = depuis;
        List<Api.Msg> frais = new ArrayList<>();
        for (Api.Msg m : liste) {
            if (m.ms > max) max = m.ms;
            if (m.mine || !Api.VUS.add(m.id)) continue;
            frais.add(m);
        }
        while (Api.VUS.size() > 200) Api.VUS.remove(Api.VUS.iterator().next());
        p.edit().putLong("since", max + 1).apply();
        if (!frais.isEmpty() && !Watch.premierPlan) Notifier.show(this, frais, false);
    }

    @Override
    public void onDestroy() {
        actif = false;
        if (boucle != null) boucle.interrupt();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
