package com.ctaiot.ctprinter.ctpl_demo;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.text.Editable;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.util.Log;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

import com.ctaiot.ctprinter.ctpl.CTPL;
import com.ctaiot.ctprinter.ctpl.Device;
import com.ctaiot.ctprinter.ctpl.RespCallback;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.reflect.TypeToken;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * @Author Jaco
 * @Date 2024/7/1
 * @Desc
 */
public class UpgradeActivity extends AppCompatActivity {

    TextView textName, textConn;
    TextView textModel, textSoftVersion, textHardwareVersion, textProgress;
    TextView textEnter;

    private String bluetoothType, bluetoothName, bluetoothMac;
    private static volatile HashMap<String, String> tempMap = new HashMap<>();

    private boolean queryOnce = true;

    String vid, pid, firmwareUrlCache;


    private volatile Handler apiHandler = new Handler(Looper.getMainLooper()) {
        @Override
        public void handleMessage(@NonNull Message msg) {
            super.handleMessage(msg);
            switch (msg.what) {
                case UpgradeHttp.DOWNLOAD_FONT_START:
                    if (msg.obj != null && !TextUtils.isEmpty(msg.obj.toString())) {
                        downloadFileFont(msg.obj.toString());
                    }
                    break;
                case UpgradeHttp.DOWNLOAD_FONT_OK: {
                    if (TextUtils.isEmpty(firmwareUrlCache)) {
                        textEnter.setText("升级完成");
                        textEnter.setEnabled(false);
                        break;
                    }
                    textEnter.setText("下载中..");
                    textEnter.setEnabled(false);
                    Message msg1 = Message.obtain(apiHandler);
                    msg1.what = UpgradeHttp.DOWNLOAD_START;
                    msg1.obj = firmwareUrlCache;
                    apiHandler.sendMessage(msg1);
                    break;
                }
                case UpgradeHttp.DOWNLOAD_FONT_ERR:
                    textEnter.setText("升级");
                    textEnter.setEnabled(true);
                    break;

                case UpgradeHttp.DOWNLOAD_START:
                    if (msg.obj != null && !TextUtils.isEmpty(msg.obj.toString())) {
                        downloadFile(msg.obj.toString());
                    }
                    break;
                case UpgradeHttp.DOWNLOAD_OK:
                    break;
                case UpgradeHttp.DOWNLOAD_ERR:
                    textEnter.setText("升级");
                    textEnter.setEnabled(true);
                    break;
            }
        }
    };

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_upgrade);
        init();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == 100 && resultCode == RESULT_OK) {
            bluetoothType = data.getStringExtra("searchType");
            bluetoothName = data.getStringExtra("searchName");
            bluetoothMac = data.getStringExtra("searchMac");

            SharedPreferences.Editor editor = getSharedPreferences("cache", MODE_PRIVATE).edit();
            editor.putString("defaultType", bluetoothType);
            editor.putString("defaultName", bluetoothName);
            editor.putString("defaultMac", bluetoothMac);
            editor.commit();

            textName.setText(bluetoothName);

            if (App.getInstance().checkBLEPermission() && !CTPL.getInstance().isConnected()) {
                Device d = new Device();
                CTPL.Port port = "SPP".equals(bluetoothType) ? CTPL.Port.SPP : CTPL.Port.BLE;
                d.setPort(port);
                d.setBluetoothMacAddr(bluetoothMac);
                if (port == CTPL.Port.BLE) {
                    d.setBleServiceUUID("49535343-fe7d-4ae5-8fa9-9fafd205e455");
                }
                CTPL.getInstance().connect(d);
            }
        }
    }

    private void init() {
        textName = findViewById(R.id.upgrade_device_name);
        textConn = findViewById(R.id.upgrade_device_conn);
        textName.addTextChangedListener(new TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {
            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
            }

            @Override
            public void afterTextChanged(Editable s) {
                boolean isNameEmpty = TextUtils.isEmpty(bluetoothName) || "无".equals(bluetoothName);
                boolean isMacEmpty = TextUtils.isEmpty(bluetoothMac) || "无".equals(bluetoothMac);
                boolean isConnected = CTPL.getInstance().isConnected();

                if (isConnected) {
                    textConn.setText("断开");
                } else if (isNameEmpty || isMacEmpty) {
                    textConn.setText("搜索");
                } else {
                    textConn.setText("连接");
                }
            }
        });

        textName.setOnClickListener(v -> {
            Intent intent = new Intent(this, SearchBluetoothActivity.class);
            intent.putExtra("search", "BLE");
            startActivityForResult(intent, 100);
        });

        textConn.setOnClickListener(v -> {
            boolean isNameEmpty = TextUtils.isEmpty(bluetoothName) || "无".equals(bluetoothName);
            boolean isMacEmpty = TextUtils.isEmpty(bluetoothMac) || "无".equals(bluetoothMac);
            boolean isConnected = CTPL.getInstance().isConnected();

            if (isConnected) {
                CTPL.getInstance().disconnect();
                textModel.setText("");
                textSoftVersion.setText("");
                textHardwareVersion.setText("");
                textEnter.setText("升级");
                textEnter.setEnabled(false);
                textEnter.setOnClickListener(v1 -> {

                });
            } else if (isNameEmpty || isMacEmpty) {
                Intent intent = new Intent(this, SearchBluetoothActivity.class);
                intent.putExtra("search", "BLE");
                startActivityForResult(intent, 100);
            } else {
                Device d = new Device();
                CTPL.Port port = "SPP".equals(bluetoothType) ? CTPL.Port.SPP : CTPL.Port.BLE;
                d.setPort(port);
                d.setBluetoothMacAddr(bluetoothMac);
                if (port == CTPL.Port.BLE) {
                    d.setBleServiceUUID("49535343-fe7d-4ae5-8fa9-9fafd205e455");
                }
                CTPL.getInstance().connect(d);
            }
        });
        textModel = findViewById(R.id.upgrade_device_model);
        textSoftVersion = findViewById(R.id.upgrade_bin_version);
        textHardwareVersion = findViewById(R.id.upgrade_hardware_version);
        textProgress = findViewById(R.id.upgrade_progress);
        textEnter = findViewById(R.id.upgrade_enter);


        SharedPreferences cache = getSharedPreferences("cache", MODE_PRIVATE);
        bluetoothType = cache.getString("defaultType", "无");
        bluetoothMac = cache.getString("defaultMac", "无");
        bluetoothName = cache.getString("defaultName", "无");
        if (TextUtils.isEmpty(bluetoothName) || "无".equals(bluetoothName)) {

        } else {
            textName.setText(bluetoothName);
        }

        CTPL.getInstance().init(App.getInstance(), new RespCallback() {
            @Override
            public void onConnectRespsonse(int port, int reason) {
//                Log.d(App.TAG, "端口=" + port + ",结果=" + reason);
//                Toast.makeText(UpgradeActivity.this, "端口=" + port + ",结果=" + reason, Toast.LENGTH_SHORT).show();
                if (reason == 256 || reason == 257 || reason == 258) {
                    findViewById(android.R.id.content).postDelayed(() -> {
                        queryOnce = true;
                        textConn.setText("断开");
                        textEnter.setEnabled(true);
                        CTPL.getInstance()
                                .queryBinaryInfo()
                                .queryHardwareVersion()
                                .queryHardwareModel()
                                .queryVidAndPid()
                                .execute();
                    }, 300L);
                } else if (reason == 4) {
                    vid = null;
                    pid = null;
                    firmwareUrlCache = null;
                    textConn.setText("连接");
                    textEnter.setText("升级");
                    textEnter.setEnabled(false);
                    textEnter.setOnClickListener(null);
                }
            }

            public void onDataResponse(HashMap<String, String> result) {
                Iterator<Map.Entry<String, String>> it = result.entrySet().iterator();
                while (it.hasNext()) {
                    Map.Entry<String, String> next = it.next();
                    Log.d(App.TAG, next.getKey() + ", = " + next.getValue());
                    if ("Model".equals(next.getKey())) {
                        textModel.setText(next.getValue());
                    } else if ("BinaryVersion".equals(next.getKey())) {
                        textSoftVersion.setText(next.getValue());
                    } else if ("HardwareVersion".equals(next.getKey())) {
                        textHardwareVersion.setText(next.getValue());
                    } else if ("OTAFontProgress".equals(next.getKey())) {
                        String[] split = next.getValue().split("/");
                        if (split != null && split.length == 2) {
                            try {
                                textEnter.setText(String.format(Locale.CHINA, "字库进度:%02f%%",
                                        Integer.parseInt(split[0]) / 1F / Integer.parseInt(split[1]) * 100));
                            } catch (Exception e) {
                                textEnter.setText(next.getValue());
                            }
                        }
                    } else if ("OTA-Font".equals(next.getKey())) {
                        apiHandler.sendEmptyMessage(UpgradeHttp.DOWNLOAD_FONT_OK);
                    } else if ("OTAProgress".equals(next.getKey())) {
                        String[] split = next.getValue().split("/");
                        if (split != null && split.length == 2) {
                            try {
                                textEnter.setText(String.format(Locale.CHINA, "固件进度:%02f%%",
                                        Integer.parseInt(split[0]) / 1F / Integer.parseInt(split[1]) * 100));
                            } catch (Exception e) {
                                textEnter.setText(next.getValue());
                            }
                        }
                    } else if ("OTA".equals(next.getKey())) {
                        textEnter.setText("true".equals(next.getValue()) ? "升级完成" : "升级失败");
                        apiHandler.sendEmptyMessage(UpgradeHttp.DOWNLOAD_OK);
                    } else if ("VID".equals(next.getKey())) {
                        vid = next.getValue();
                    } else if ("PID".equals(next.getKey())) {
                        pid = next.getValue();
                    }
                }

                if (queryOnce && !TextUtils.isEmpty(textModel.getText().toString())
                        && !TextUtils.isEmpty(textSoftVersion.getText().toString())
                        && !TextUtils.isEmpty(textHardwareVersion.getText().toString())) {
                    queryOnce = false;
//                    queryBinFile("CT320D", textSoftVersion.getText().toString(),
//                            textHardwareVersion.getText().toString());
                    findViewById(android.R.id.content).postDelayed(() -> queryBinFile(
                            textModel.getText().toString(),
                            textSoftVersion.getText().toString(),
                            textHardwareVersion.getText().toString(), vid, pid), 500L);
                }
            }

            @Override
            public boolean autoSPPBond() {
                return true;
            }
        });
    }


    private void queryBinFile(@NonNull final String model,
                              @NonNull String softwareVersion,
                              @NonNull String hardwareVersion,
                              @NonNull String vid,
                              @NonNull String pid) {
        Toast.makeText(UpgradeActivity.this, "VID:" + vid + ",PID:" + pid, Toast.LENGTH_LONG).show();
        App.getInstance().getExecutor().execute(() -> {
            Gson gson = new GsonBuilder().setPrettyPrinting().create();
            String json = null;
            try {
                tempMap.clear();
                tempMap.put("model", model);
                tempMap.put("hardwareVersion", hardwareVersion);
                tempMap.put("vid", null);
                tempMap.put("pid", null);
                HttpURLConnection conn = UpgradeHttp.createUrlConnection(1, tempMap, gson);
                if (conn == null)
                    throw new ApiException("token conn null");
                conn.connect();

                if (conn.getResponseCode() == HttpURLConnection.HTTP_OK) {
                    json = UpgradeHttp.readInputStreamString(conn.getInputStream());
                    Log.d(App.TAG, json);
                    RespObj<BinModel> respObj = gson.fromJson(json, new TypeToken<RespObj<BinModel>>() {
                    }.getType());

                    if (respObj.code != UpgradeHttp.API_OK || respObj.getData() == null) {
                        throw new ApiException(UpgradeHttp.apiPath[1] + "," + respObj.message);
                    }

                    BinModel data = respObj.getData();
                    if (data == null || TextUtils.isEmpty(data.getFirmwareUrl())) {
                        Message msg = apiHandler.obtainMessage(Scene.API_SUCC);
                        msg.obj = null;
                        apiHandler.sendMessage(msg);
                        runOnUiThread(() -> {
                            runOnUiThread(() -> {
                                textEnter.setText("已是最新固件");
                                textEnter.setEnabled(false);
                            });
                        });
                    } else {
//                        String newVersion = "V1.020240329";
                        String newVersion = data.getFirmwareVersion();
                        Log.d(App.TAG, "new version = " + newVersion);
                        Date curr = null, update = null;
                        if (!TextUtils.isEmpty(newVersion)) {
                            SimpleDateFormat formatter = new SimpleDateFormat("yyyyMMdd", Locale.CHINA);
                            Matcher matcher = Pattern.compile("^.*?(20\\d{2}\\d{2}\\d{2})$").matcher(softwareVersion);
                            if (matcher.find() && matcher.groupCount() > 0) {
                                final String findStr = matcher.group(1);
                                curr = findStr == null ? null : formatter.parse(findStr);
                            }

                            matcher = Pattern.compile("^.*?(20\\d{2}\\d{2}\\d{2})$").matcher(newVersion);
                            if (matcher.find() && matcher.groupCount() > 0) {
                                final String findStr = matcher.group(1);
                                update = findStr == null ? null : formatter.parse(findStr);
                            }
                        }

                        Message msg;
//                        if (curr == null || update == null || curr.after(update)) {
                        if (update == null) {
                            runOnUiThread(() -> {
                                textEnter.setText("已是最新固件");
                                textEnter.setEnabled(false);
                            });
                        } else {
                            Runnable updateFirmware = () -> {
                                textEnter.setText("升级");
                                textEnter.setEnabled(true);
                                textEnter.setOnClickListener(v -> {
                                    if (!CTPL.getInstance().isConnected()) {
                                        Toast.makeText(this, "打印机未连接", Toast.LENGTH_SHORT).show();
                                        return;
                                    }
                                    textEnter.setText("下载中..");
                                    textEnter.setEnabled(false);
                                    Message msg1 = Message.obtain(apiHandler);
                                    msg1.what = UpgradeHttp.DOWNLOAD_START;
                                    msg1.obj = data.getFirmwareUrl();
                                    apiHandler.sendMessage(msg1);
                                });
                            };


                            if (!TextUtils.isEmpty(data.getFirmwareFontUrl())) {
                                firmwareUrlCache = data.getFirmwareUrl();
                                runOnUiThread(() -> {
                                    textEnter.setText("升级");
                                    textEnter.setEnabled(true);
                                    textEnter.setOnClickListener(v -> {
                                        if (!CTPL.getInstance().isConnected()) {
                                            Toast.makeText(this, "打印机未连接", Toast.LENGTH_SHORT).show();
                                            return;
                                        }
                                        textEnter.setText("下载中..");
                                        textEnter.setEnabled(false);
                                        Message msg1 = Message.obtain(apiHandler);
                                        msg1.what = UpgradeHttp.DOWNLOAD_FONT_START;
                                        msg1.obj = data.getFirmwareFontUrl();
                                        apiHandler.sendMessage(msg1);
                                    });
                                });
                                return;
                            }
                            runOnUiThread(updateFirmware);
                        }
                    }
                }
                conn.disconnect();
            } catch (ApiException e) {
                Log.wtf(App.TAG, e);
                Message msg = apiHandler.obtainMessage(Scene.API_ERR);
                msg.obj = e.getMessage();
                apiHandler.sendMessage(msg);
            } catch (Exception e1) {
                Log.wtf(App.TAG, e1);
            }
        });
    }

    public void downloadFile(@NonNull final String urlPath) {
        App.getInstance().getExecutor().execute(() -> {
            try {
                Log.d(App.TAG, "开始下载");
                Log.d(App.TAG, urlPath);
                URL url = new URL(urlPath);
                HttpURLConnection httpConn = (HttpURLConnection) url.openConnection();
                int respCode = httpConn.getResponseCode();
                if (respCode == HttpURLConnection.HTTP_OK) {
                    try {
                        InputStream is = httpConn.getInputStream();
                        ByteArrayOutputStream baos = new ByteArrayOutputStream();
                        byte[] buffer = new byte[4096];
                        int readIdx = -1;
                        while ((readIdx = is.read(buffer)) != -1) {
                            baos.write(buffer, 0, readIdx);
                        }
                        if (baos.size() > 0 && baos.size() < 3 * 1024 * 1024 && CTPL.getInstance().isConnected()) {
                            byte[] data = baos.toByteArray();
                            CTPL.getInstance().requestOTA(data);
                        } else {
                            Toast.makeText(UpgradeActivity.this, "文件过大!", Toast.LENGTH_SHORT).show();
                            Log.d(App.TAG, "文件过大!");
                            apiHandler.sendEmptyMessage(UpgradeHttp.DOWNLOAD_ERR);
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                } else {
                    Log.d(App.TAG, "文件下载失败. 响应码: " + respCode);
                    apiHandler.sendEmptyMessage(UpgradeHttp.DOWNLOAD_ERR);
                }
                httpConn.disconnect();
            } catch (Exception e) {
                e.printStackTrace();
                Log.d(App.TAG, "文件下载失败");
                apiHandler.sendEmptyMessage(UpgradeHttp.DOWNLOAD_ERR);
            }
        });
    }

    public void downloadFileFont(@NonNull final String urlPath) {
        App.getInstance().getExecutor().execute(() -> {
            try {
                Log.d(App.TAG, "开始下载");
                Log.d(App.TAG, urlPath);
                URL url = new URL(urlPath);
                HttpURLConnection httpConn = (HttpURLConnection) url.openConnection();
                int respCode = httpConn.getResponseCode();
                if (respCode == HttpURLConnection.HTTP_OK) {
                    try {
                        InputStream is = httpConn.getInputStream();
                        ByteArrayOutputStream baos = new ByteArrayOutputStream();
                        byte[] buffer = new byte[4096];
                        int readIdx = -1;
                        while ((readIdx = is.read(buffer)) != -1) {
                            baos.write(buffer, 0, readIdx);
                        }
                        if (baos.size() > 0 && baos.size() < 8 * 1024 * 1024 && CTPL.getInstance().isConnected()) {
                            byte[] data = baos.toByteArray();
                            CTPL.getInstance().requestOTAFont(data);
                        } else {
                            Toast.makeText(UpgradeActivity.this, "文件过大!", Toast.LENGTH_SHORT).show();
                            Log.d(App.TAG, "文件过大!");
                            apiHandler.sendEmptyMessage(UpgradeHttp.DOWNLOAD_FONT_ERR);
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                } else {
                    Log.d(App.TAG, "文件下载失败. 响应码: " + respCode);
                    apiHandler.sendEmptyMessage(UpgradeHttp.DOWNLOAD_FONT_ERR);
                }
                httpConn.disconnect();
            } catch (Exception e) {
                e.printStackTrace();
                Log.d(App.TAG, "文件下载失败");
                apiHandler.sendEmptyMessage(UpgradeHttp.DOWNLOAD_FONT_ERR);
            }
        });
    }

    static class Scene {
        public static final int API_SUCC = 0;
        public static final int API_ERR = 1;
    }
}
