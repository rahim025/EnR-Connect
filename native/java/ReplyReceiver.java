package com.enrconnect.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import androidx.core.app.RemoteInput;

/** Réponse rapide tapée directement dans la notification ou la bulle. */
public class ReplyReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        Bundle r = RemoteInput.getResultsFromIntent(intent);
        CharSequence t = r == null ? null : r.getCharSequence(Notifier.CLE_REPONSE);
        if (t == null || t.toString().trim().isEmpty()) return;
        final String texte = t.toString().trim();
        final Context app = ctx.getApplicationContext();
        final PendingResult pr = goAsync();
        new Thread(() -> {
            boolean ok = true;
            try {
                Api.sendMessage(app, texte);
            } catch (Exception e) {
                ok = false;
            }
            Notifier.reponse(app, texte, ok);
            pr.finish();
        }).start();
    }
}
