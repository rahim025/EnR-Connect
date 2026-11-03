package com.enrconnect.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;

/** Accès à Firestore par l'API REST, sans serveur : on réutilise la session de l'utilisateur (jeton de rafraîchissement). */
final class Api {
    private Api() {}

    static final Set<String> VUS = new LinkedHashSet<>();

    static class Msg {
        String id, uid, name, kind, text;
        long ms;
        boolean mine;

        String label() {
            if ("image".equals(kind)) return "📷 Photo";
            if ("announce".equals(kind)) return "📢 " + text;
            return text == null ? "" : text;
        }
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("enr_watch", Context.MODE_PRIVATE);
    }

    static synchronized String idToken(Context c) throws Exception {
        SharedPreferences p = prefs(c);
        String tok = p.getString("idToken", null);
        long exp = p.getLong("idExp", 0);
        if (tok != null && System.currentTimeMillis() < exp - 60000) return tok;
        String body = "grant_type=refresh_token&refresh_token=" + URLEncoder.encode(p.getString("refresh", ""), "UTF-8");
        String res = http("https://securetoken.googleapis.com/v1/token?key=" + p.getString("apiKey", ""),
                "application/x-www-form-urlencoded", body, null);
        JSONObject j = new JSONObject(res);
        tok = j.getString("id_token");
        p.edit().putString("idToken", tok)
                .putString("refresh", j.getString("refresh_token"))
                .putLong("idExp", System.currentTimeMillis() + Long.parseLong(j.getString("expires_in")) * 1000L)
                .apply();
        return tok;
    }

    static String http(String url, String type, String body, String bearer) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(15000);
        c.setReadTimeout(20000);
        if (bearer != null) c.setRequestProperty("Authorization", "Bearer " + bearer);
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", type);
        try (OutputStream o = c.getOutputStream()) {
            o.write(body.getBytes(StandardCharsets.UTF_8));
        }
        int code = c.getResponseCode();
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        String s = read(in);
        if (code >= 400) throw new IOException("HTTP " + code + " " + s);
        return s;
    }

    private static String read(InputStream in) throws IOException {
        if (in == null) return "";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toString("UTF-8");
    }

    static String iso(long ms) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date(ms));
    }

    static long parse(String s) throws Exception {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        long base = f.parse(s.substring(0, 19)).getTime();
        int dot = s.indexOf('.');
        if (dot > 0) {
            String frac = s.substring(dot + 1).replaceAll("[^0-9]", "");
            frac = (frac + "000").substring(0, 3);
            base += Long.parseLong(frac);
        }
        return base;
    }

    private static String champ(JSONObject fields, String k) {
        JSONObject o = fields.optJSONObject(k);
        return o == null ? "" : o.optString("stringValue", "");
    }

    /** Messages créés après « since » (en ms), du plus ancien au plus récent. */
    static List<Msg> fetchSince(Context c, long since) throws Exception {
        SharedPreferences p = prefs(c);
        String url = "https://firestore.googleapis.com/v1/projects/" + p.getString("project", "")
                + "/databases/(default)/documents:runQuery";
        String q = "{\"structuredQuery\":{\"from\":[{\"collectionId\":\"messages\"}],"
                + "\"where\":{\"fieldFilter\":{\"field\":{\"fieldPath\":\"createdAt\"},\"op\":\"GREATER_THAN\","
                + "\"value\":{\"timestampValue\":\"" + iso(since) + "\"}}},"
                + "\"orderBy\":[{\"field\":{\"fieldPath\":\"createdAt\"},\"direction\":\"ASCENDING\"}],\"limit\":20}}";
        String res = http(url, "application/json", q, idToken(c));
        JSONArray arr = new JSONArray(res);
        List<Msg> out = new ArrayList<>();
        String moi = p.getString("uid", "");
        for (int i = 0; i < arr.length(); i++) {
            JSONObject d = arr.getJSONObject(i).optJSONObject("document");
            if (d == null) continue;
            JSONObject f = d.getJSONObject("fields");
            Msg m = new Msg();
            String nom = d.getString("name");
            m.id = nom.substring(nom.lastIndexOf('/') + 1);
            m.uid = champ(f, "uid");
            m.name = champ(f, "name");
            m.kind = champ(f, "kind");
            m.text = champ(f, "text");
            m.mine = m.uid.equals(moi);
            JSONObject ts = f.optJSONObject("createdAt");
            m.ms = ts == null ? System.currentTimeMillis() : parse(ts.getString("timestampValue"));
            out.add(m);
        }
        return out;
    }

    static void sendMessage(Context c, String text) throws Exception {
        SharedPreferences p = prefs(c);
        String url = "https://firestore.googleapis.com/v1/projects/" + p.getString("project", "")
                + "/databases/(default)/documents/messages";
        JSONObject f = new JSONObject();
        f.put("uid", new JSONObject().put("stringValue", p.getString("uid", "")));
        f.put("name", new JSONObject().put("stringValue", p.getString("name", "")));
        f.put("kind", new JSONObject().put("stringValue", "text"));
        f.put("text", new JSONObject().put("stringValue", text));
        f.put("createdAt", new JSONObject().put("timestampValue", iso(System.currentTimeMillis())));
        http(url, "application/json", new JSONObject().put("fields", f).toString(), idToken(c));
    }
}
