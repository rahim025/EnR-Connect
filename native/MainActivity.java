package com.enrconnect.app;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private volatile float hautDp = 0f;

    /** Permet à la page de lire la hauteur de la barre d'état au démarrage. */
    private class PontInsets {
        @JavascriptInterface
        public float haut() { return hautDp; }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MessageWatcherPlugin.class);
        super.onCreate(savedInstanceState);
        activerPleinEcran();
    }

    @Override
    public void onResume() {
        super.onResume();
        // Capacitor peut remettre sa propre marge : on reprend la main à chaque retour.
        activerPleinEcran();
    }

    /** L'appli passe sous la barre d'état (en haut), comme Messenger. */
    private void activerPleinEcran() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);

        boolean nuit = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        WindowInsetsControllerCompat ctrl =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        ctrl.setAppearanceLightStatusBars(!nuit);

        final WebView wv = getBridge().getWebView();
        // Plus de noir derrière : couleur de l'appli sous la barre d'état
        int fond = Color.parseColor("#0B2327");
        getWindow().getDecorView().setBackgroundColor(fond);
        View parent = (View) wv.getParent();
        parent.setBackgroundColor(fond);
        parent.setPadding(0, 0, 0, 0);
        ViewCompat.setOnApplyWindowInsetsListener(parent, (v, i) -> i);
        wv.addJavascriptInterface(new PontInsets(), "EnrInsets");
        final float densite = getResources().getDisplayMetrics().density;

        ViewCompat.setOnApplyWindowInsetsListener(wv, (v, windowInsets) -> {
            Insets barres = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets clavier = windowInsets.getInsets(WindowInsetsCompat.Type.ime());

            // Haut : aucune marge (la page passe sous la barre d'état).
            // Bas / côtés / clavier : on garde une marge pour ne pas passer sous la barre de navigation.
            ViewGroup.MarginLayoutParams lp = (ViewGroup.MarginLayoutParams) v.getLayoutParams();
            lp.topMargin = 0;
            lp.leftMargin = barres.left;
            lp.rightMargin = barres.right;
            lp.bottomMargin = Math.max(barres.bottom, clavier.bottom);
            v.setLayoutParams(lp);

            hautDp = barres.top / densite;
            final String js = "document.documentElement.style.setProperty('--safe-top','" + hautDp + "px')";
            v.post(() -> ((WebView) v).evaluateJavascript(js, null));
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(wv);
    }
}
