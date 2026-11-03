package com.enrconnect.app;

/** État partagé : true quand l'appli est affichée (pas de notification dans ce cas). */
final class Watch {
    private Watch() {}
    static volatile boolean premierPlan = true;
}
