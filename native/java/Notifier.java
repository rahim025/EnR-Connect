package com.enrconnect.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RadialGradient;
import android.graphics.Shader;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;
import androidx.core.content.LocusIdCompat;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;

import java.util.ArrayList;
import java.util.List;

/** Notification de conversation : bulle flottante (Android 11+) et réponse rapide. */
final class Notifier {
    private Notifier() {}

    static final String CANAL_MSG = "messages";
    static final String CANAL_SERVICE = "veille";
    static final int ID_MSG = 1001;
    static final String RACCOURCI = "enr_groupe";
    static final String CLE_REPONSE = "reponse";

    private static final List<Api.Msg> RECENTS = new ArrayList<>();

    static void canaux(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel m = new NotificationChannel(CANAL_MSG, "Messages du groupe", NotificationManager.IMPORTANCE_HIGH);
        m.setDescription("Nouveaux messages d'EnR Connect");
        m.setAllowBubbles(true);
        nm.createNotificationChannel(m);
        NotificationChannel s = new NotificationChannel(CANAL_SERVICE, "Réception des messages", NotificationManager.IMPORTANCE_MIN);
        s.setDescription("Icône discrète qui garde la réception des messages active");
        nm.createNotificationChannel(s);
    }

    static Notification pourService(Context c) {
        canaux(c);
        return new NotificationCompat.Builder(c, CANAL_SERVICE)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("EnR Connect")
                .setContentText("Réception des messages activée")
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setOngoing(true)
                .build();
    }

    static Bitmap soleil() {
        Bitmap b = Bitmap.createBitmap(192, 192, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(b);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(0xFF0B2327);
        cv.drawRect(0, 0, 192, 192, p);
        p.setShader(new RadialGradient(80, 76, 70, 0xFFFFD98A, 0xFFF5A623, Shader.TileMode.CLAMP));
        cv.drawCircle(96, 96, 52, p);
        return b;
    }

    static synchronized void clear(Context c) {
        RECENTS.clear();
        NotificationManagerCompat.from(c).cancel(ID_MSG);
    }

    static synchronized void show(Context c, List<Api.Msg> nouveaux, boolean silencieux) {
        RECENTS.addAll(nouveaux);
        while (RECENTS.size() > 8) RECENTS.remove(0);
        publier(c, silencieux);
    }

    /** Ajoute ma propre réponse (envoyée depuis la notification) et met la notification à jour sans bruit. */
    static synchronized void reponse(Context c, String texte, boolean ok) {
        Api.Msg m = new Api.Msg();
        m.mine = true;
        m.kind = "text";
        m.text = ok ? texte : "⚠️ Non envoyé : " + texte;
        m.ms = System.currentTimeMillis();
        RECENTS.add(m);
        while (RECENTS.size() > 8) RECENTS.remove(0);
        publier(c, true);
    }

    private static void publier(Context c, boolean silencieux) {
        canaux(c);
        IconCompat icone = IconCompat.createWithAdaptiveBitmap(soleil());

        Person moi = new Person.Builder().setName("Moi").build();
        NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(moi)
                .setConversationTitle("EnR Connect")
                .setGroupConversation(true);
        for (Api.Msg m : RECENTS) {
            Person qui = m.mine ? moi : new Person.Builder().setName(m.name).setKey(m.uid).build();
            style.addMessage(m.label(), m.ms, qui);
        }

        Intent ouvrir = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent piOuvrir = PendingIntent.getActivity(c, 0, ouvrir, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        RemoteInput ri = new RemoteInput.Builder(CLE_REPONSE).setLabel("Répondre").build();
        Intent rep = new Intent(c, ReplyReceiver.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        PendingIntent piRep = PendingIntent.getBroadcast(c, 2, rep, flags);
        NotificationCompat.Action action = new NotificationCompat.Action.Builder(R.drawable.ic_stat, "Répondre", piRep)
                .addRemoteInput(ri)
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
                .setAllowGeneratedReplies(true)
                .build();

        // Raccourci de conversation : obligatoire pour que la bulle s'affiche
        Intent racc = new Intent(c, BubbleActivity.class).setAction(Intent.ACTION_VIEW);
        ShortcutInfoCompat sc = new ShortcutInfoCompat.Builder(c, RACCOURCI)
                .setLongLived(true)
                .setShortLabel("EnR Connect")
                .setIntent(racc)
                .setIcon(icone)
                .setLocusId(new LocusIdCompat(RACCOURCI))
                .build();
        ShortcutManagerCompat.pushDynamicShortcut(c, sc);

        Intent bulleIntent = new Intent(c, BubbleActivity.class);
        int fb = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        PendingIntent piBulle = PendingIntent.getActivity(c, 1, bulleIntent, fb);
        NotificationCompat.BubbleMetadata bulle = new NotificationCompat.BubbleMetadata.Builder(piBulle, icone)
                .setDesiredHeight(640)
                .setSuppressNotification(false)
                .build();

        Notification n = new NotificationCompat.Builder(c, CANAL_MSG)
                .setSmallIcon(R.drawable.ic_stat)
                .setColor(0xFFF5A623)
                .setStyle(style)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(piOuvrir)
                .setAutoCancel(true)
                .addAction(action)
                .setShortcutId(RACCOURCI)
                .setLocusId(new LocusIdCompat(RACCOURCI))
                .setBubbleMetadata(bulle)
                .setOnlyAlertOnce(silencieux)
                .build();
        try {
            NotificationManagerCompat.from(c).notify(ID_MSG, n);
        } catch (SecurityException e) {
            // permission de notification refusée par l'utilisateur
        }
    }
}
