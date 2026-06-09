package com.ctaiot.ctprinter.ctpl_demo;

import android.util.Log;

import com.google.gson.Gson;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.UnsupportedEncodingException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * @Author Jaco
 * @Date 2022/11/21
 * @Desc
 */
class UpgradeHttp {

    protected static final int API_OK = 100;
    protected static final int DOWNLOAD_START = 0X10000;

    protected static final int DOWNLOAD_OK = 0X10001;
    protected static final int DOWNLOAD_ERR = 0X10002;

    protected static final int DOWNLOAD_FONT_START = 0X10010;
    protected static final int DOWNLOAD_FONT_OK = 0X10011;
    protected static final int DOWNLOAD_FONT_ERR = 0X10012;


    protected static final String HOST = "https://chitengapi.ctaiot.com";

    protected static final String[] apiPath = {
            "/api/firmware/firmware_upgrade.json",
            "/api/firmware/firmware_upgrades.json",
    };

    public static final String BINARY_FILE_NAME = "upgrade.bin";


    protected static HttpURLConnection createUrlConnection(int index, HashMap<String, String> map, Gson converter) {
        HttpURLConnection httpURLConnection;
        String type = "GET";
        String accessToken = map.remove("accessToken");

        URL mUrl;
        StringBuilder sb = new StringBuilder();
        Iterator<Map.Entry<String, String>> it = map.entrySet().iterator();

        boolean isPost = "POST".equals(type);
        if (!isPost)
            sb.append("?");

        while (it.hasNext()) {
            Map.Entry<String, String> next = it.next();
            if (next.getValue() == null)
                continue;
            if (isPost || (sb.length() > 0))
                sb.append("&");
            try {
                sb.append(URLEncoder.encode(next.getKey(), "UTF-8"));
                sb.append("=");
                sb.append(URLEncoder.encode(next.getValue(), "UTF-8"));
            } catch (UnsupportedEncodingException e) {
                e.printStackTrace();
            }
        }
        try {
            mUrl = new URL(isPost ? HOST + apiPath[index] : HOST + apiPath[index] + sb);
            Log.d(App.TAG, "path = " + mUrl);
            httpURLConnection = (HttpURLConnection) mUrl.openConnection();
            if (accessToken != null)
                httpURLConnection.setRequestProperty("accessToken", accessToken);
            //设置连接超时时间
            httpURLConnection.setConnectTimeout(15 * 1000);
            httpURLConnection.setReadTimeout(15 * 1000);
            httpURLConnection.setRequestMethod(type);
            httpURLConnection.setRequestProperty("Connection", "Keep-Alive");
            httpURLConnection.setDoInput(true);
            httpURLConnection.setDoOutput(isPost);

            BufferedWriter bufferedWriter = null;
            if (isPost) {
                try {
                    bufferedWriter = new BufferedWriter(new OutputStreamWriter(
                            httpURLConnection.getOutputStream(), StandardCharsets.UTF_8));
                    bufferedWriter.write(sb.toString());
                } catch (IOException e1) {
                    e1.printStackTrace();
                } finally {
                    try {
                        if (bufferedWriter != null) {
                            bufferedWriter.close();
                        }
                    } catch (IOException e) {
                        e.printStackTrace();
                    }
                }
            }

            SSLContext sc = SSLContext.getInstance("TLS");
            sc.init(null, new TrustManager[]{new X509TrustManager() {
                public X509Certificate[] getAcceptedIssuers() {
                    return new X509Certificate[0];
                }

                @Override
                public void checkClientTrusted(X509Certificate[] certs, String authType) {
                }

                @Override
                public void checkServerTrusted(X509Certificate[] certs, String authType) {
                }
            }}, new SecureRandom());
            HttpsURLConnection.setDefaultSSLSocketFactory(sc.getSocketFactory());
            HttpsURLConnection.setDefaultHostnameVerifier((hostname, session) -> true);
        } catch (Exception e) {
            e.printStackTrace();
            httpURLConnection = null;
        }
        return httpURLConnection;
    }

    public static String readInputStreamString(InputStream is) throws IOException {
        StringBuilder sb = new StringBuilder();
        BufferedReader br = new BufferedReader(new InputStreamReader(is));
        String readLine = null;
        while ((readLine = br.readLine()) != null) {
            sb.append(readLine);
        }
        return sb.toString();
    }
}
