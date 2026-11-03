package com.enrconnect.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/** Fenêtre affichée dans la bulle flottante : c'est la même appli, en petit. */
public class BubbleActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MessageWatcherPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
