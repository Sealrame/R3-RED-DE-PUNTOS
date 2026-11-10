package com.r3reddetalleres.puntos;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * R3 Puntos: contenedor nativo de la app web https://puntos.r3reddetalleres.com
 * Cámara para escanear QR, subida de imágenes, guardado de QR/CSV y navegación atrás.
 */
public class MainActivity extends Activity {
    static final String HOST = "puntos.r3reddetalleres.com";
    static final String HOME = "https://" + HOST + "/";
    static final int REQ_CAMERA = 10, REQ_FILE = 11, REQ_STORAGE = 12;

    WebView web;
    PermissionRequest pendingCamera;
    ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " R3PuntosApp/1.0");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Bridge(), "R3Android");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        Uri data = getIntent() != null ? getIntent().getData() : null;
        if (state != null) web.restoreState(state);
        else web.loadUrl(data != null && HOST.equals(data.getHost()) ? data.toString() : HOME);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri data = intent.getData();
        if (data != null && HOST.equals(data.getHost())) web.loadUrl(data.toString());
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    static boolean isOurs(Uri u) {
        return u != null && "https".equals(u.getScheme()) && HOST.equals(u.getHost());
    }

    class Client extends WebViewClient {
        boolean handle(Uri u) {
            if (isOurs(u)) return false;
            String scheme = u.getScheme() == null ? "" : u.getScheme();
            // Firebase y Google se cargan dentro; enlaces externos (WhatsApp, mapas, correo) se abren fuera.
            if (scheme.equals("https") && u.getHost() != null && (u.getHost().endsWith("googleapis.com") || u.getHost().endsWith("firebaseapp.com"))) return false;
            try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { /* sin app para abrirlo */ }
            return true;
        }
        /* API 24+ (sin @Override: se compila contra API 23) */ public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return handle(r.getUrl()); }
        @Override @SuppressWarnings("deprecation") public boolean shouldOverrideUrlLoading(WebView v, String url) { return handle(Uri.parse(url)); }
        @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            if (r.isForMainFrame()) v.loadDataWithBaseURL(HOME, offlinePage(), "text/html", "utf-8", null);
        }
    }

    static String offlinePage() {
        return "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
            + "<body style='font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;color:#0b1420'>"
            + "<div><h2>Sin conexión</h2><p>Revisa tu internet e intenta de nuevo.</p>"
            + "<a href='" + HOME + "' style='display:inline-block;margin-top:12px;padding:14px 28px;background:#f6c51b;color:#0b1420;border-radius:14px;text-decoration:none;font-weight:bold'>Reintentar</a></div></body></html>";
    }

    class Chrome extends WebChromeClient {
        @Override public void onPermissionRequest(final PermissionRequest req) {
            runOnUiThread(new Runnable() { public void run() {
                if (!isOurs(req.getOrigin())) { req.deny(); return; }
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) req.grant(req.getResources());
                else { pendingCamera = req; requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA); }
            }});
        }
        @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = cb;
            try { startActivityForResult(params.createIntent(), REQ_FILE); }
            catch (Exception e) { fileCallback = null; return false; }
            return true;
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        if (code == REQ_CAMERA && pendingCamera != null) {
            if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) pendingCamera.grant(pendingCamera.getResources());
            else { pendingCamera.deny(); toast("Permite la cámara para escanear el QR."); }
            pendingCamera = null;
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
        }
    }

    void toast(final String m) {
        runOnUiThread(new Runnable() { public void run() { Toast.makeText(MainActivity.this, m, Toast.LENGTH_LONG).show(); } });
    }

    /** Puente JavaScript (solo lo usa la app web de R3): guardar y compartir archivos generados en la página. */
    class Bridge {
        @JavascriptInterface public boolean isApp() { return true; }

        @JavascriptInterface public void saveImage(String base64, String name) {
            Uri u = storeImage(base64, name);
            toast(u != null ? "Imagen guardada en la galería (Pictures/R3 Puntos)" : "No se pudo guardar la imagen");
        }

        @JavascriptInterface public void shareImage(String base64, String name, String title) {
            Uri u = storeImage(base64, name);
            if (u == null) { toast("No se pudo compartir"); return; }
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("image/png");
            i.putExtra(Intent.EXTRA_STREAM, u);
            i.putExtra(Intent.EXTRA_TEXT, title);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(i, "Compartir"));
        }

        @JavascriptInterface public void saveFile(String base64, String name, String mime) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put("_display_name", name);
                    v.put("mime_type", mime);
                    v.put("relative_path", "Download/R3 Puntos");
                    Uri u = getContentResolver().insert(Uri.parse("content://media/external/downloads"), v);
                    OutputStream os = getContentResolver().openOutputStream(u);
                    os.write(bytes); os.close();
                } else {
                    if (!storageAllowed()) return;
                    File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "R3 Puntos");
                    dir.mkdirs();
                    FileOutputStream os = new FileOutputStream(new File(dir, name));
                    os.write(bytes); os.close();
                }
                toast("Archivo guardado en Descargas/R3 Puntos");
            } catch (Exception e) { toast("No se pudo guardar el archivo"); }
        }
    }

    boolean storageAllowed() {
        if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED) return true;
        requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
        toast("Concede el permiso y vuelve a intentarlo.");
        return false;
    }

    Uri storeImage(String base64, String name) {
        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            ContentResolver cr = getContentResolver();
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                v.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                v.put("relative_path", "Pictures/R3 Puntos");
                Uri u = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                OutputStream os = cr.openOutputStream(u);
                os.write(bytes); os.close();
                return u;
            }
            if (!storageAllowed()) return null;
            Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            String url = MediaStore.Images.Media.insertImage(cr, bmp, name, "R3 Puntos");
            return url != null ? Uri.parse(url) : null;
        } catch (Exception e) { return null; }
    }
}
