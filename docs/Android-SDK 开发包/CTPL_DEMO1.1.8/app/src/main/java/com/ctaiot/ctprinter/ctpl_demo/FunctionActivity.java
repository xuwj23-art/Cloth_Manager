package com.ctaiot.ctprinter.ctpl_demo;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapRegionDecoder;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Point;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.os.Process;
import android.text.TextUtils;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.DrawableRes;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.ActionBarDrawerToggle;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.widget.Toolbar;
import androidx.core.widget.NestedScrollView;
import androidx.drawerlayout.widget.DrawerLayout;

import com.ctaiot.ctprinter.ctpl.CTPL;
import com.ctaiot.ctprinter.ctpl.Device;
import com.ctaiot.ctprinter.ctpl.RespCallback;
import com.ctaiot.ctprinter.ctpl.param.BarCode;
import com.ctaiot.ctprinter.ctpl.param.Direction;
import com.ctaiot.ctprinter.ctpl.param.Mirror;
import com.ctaiot.ctprinter.ctpl.param.PaperType;
import com.ctaiot.ctprinter.ctpl.param.PrintMode;
import com.ctaiot.ctprinter.ctpl.param.QREncodeMode;
import com.ctaiot.ctprinter.ctpl.param.QRLevel;
import com.ctaiot.ctprinter.ctpl.param.Rotate;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * @Author Jaco
 * @Date 2022/10/21
 * @Desc
 */
public class FunctionActivity extends AppCompatActivity {
    public static final String TAG = "CTPL";

    Toolbar toolbar;
    TextView title;
    DrawerLayout drawerLayout;

    ViewGroup drawerContent, queryContainer, settingContainer, printContainer, upgradeContainer, escContainer;

    ViewGroup prepareContainer, sendContainer, respContainer, renderContainer;

    TextView searchSelected;

    EditText input;

    View send, prepareClear, sendClear, respClear, mask, inputEnter, inputCancel;

    String bluetoothType, bluetoothName, bluetoothMac;

    public static FunctionActivity instance;

    boolean isAutoConnFirst = true;


    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        instance = this;
        setContentView(R.layout.activity_function);
        toolbar = findViewById(R.id.header);
        title = findViewById(R.id.title);
        drawerLayout = findViewById(R.id.content);
        drawerContent = drawerLayout.findViewById(R.id.drawer_content);
        prepareContainer = drawerLayout.findViewById(R.id.prepareContent);
        send = drawerLayout.findViewById(R.id.send);
        prepareClear = drawerLayout.findViewById(R.id.clear);
        sendClear = drawerLayout.findViewById(R.id.sendClear);
        respClear = drawerLayout.findViewById(R.id.respClear);
        sendContainer = drawerLayout.findViewById(R.id.sendContent);
        respContainer = drawerLayout.findViewById(R.id.respContent);
        renderContainer = findViewById(R.id.renderGroup);
        mask = findViewById(R.id.mask);
        input = findViewById(R.id.input);
        input.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                inputEnter.performClick();
                return true;
            }
            return false;
        });
        inputEnter = findViewById(R.id.input_enter);
        inputCancel = findViewById(R.id.input_cancel);
        CTPL.getInstance().init(App.getInstance(), new RespCallback() {
            @Override
            public void onConnectRespsonse(int port, int reason) {
                Log.d(App.TAG, "端口=" + port + ",结果=" + reason);
                Toast.makeText(FunctionActivity.instance, "连接结果=" + reason, Toast.LENGTH_SHORT).show();
                if(reason == 256 || reason == 257 || reason == 258) {
                    findViewById(android.R.id.content).postDelayed(()->{
                        CTPL.getInstance().clean();
                        CTPL.getInstance().queryHardwareModel();
                        CTPL.getInstance().queryBinaryInfo();
                        CTPL.getInstance().queryVidAndPid();
                        CTPL.getInstance().execute();
                    },500);
                }
            }

            public void onDataResponse(HashMap<String, String> result) {
                Iterator<Map.Entry<String, String>> it = result.entrySet().iterator();
                while (it.hasNext()) {
                    Map.Entry<String, String> next = it.next();
                    insertItem(respContainer, next.getKey() + " = " + next.getValue());
                }
                if (respContainer.getParent() instanceof NestedScrollView) {
                    NestedScrollView parent = (NestedScrollView) respContainer.getParent();
                    parent.post(() -> parent.fullScroll(View.FOCUS_DOWN));
                }
            }

            @Override
            public boolean autoSPPBond() {
                return false;
            }
        });

        mask.setOnClickListener(v -> {

        });

        inputCancel.setOnClickListener(v -> {
            InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            View focusView = getCurrentFocus();
            if (focusView == null || imm == null)
                return;
            imm.hideSoftInputFromWindow(focusView.getWindowToken(), InputMethodManager.HIDE_NOT_ALWAYS);
            input.setText("");
            mask.setVisibility(View.GONE);
        });

        send.setOnClickListener(v -> {
            if (!CTPL.getInstance().isConnected()) {
                Toast.makeText(this, "设备未连接", Toast.LENGTH_SHORT).show();
                return;
            }

            while (prepareContainer.getChildCount() > 0) {
                View childAt = prepareContainer.getChildAt(0);
                prepareContainer.removeViewAt(0);
                sendContainer.addView(childAt);
            }
            NestedScrollView scrollView = (NestedScrollView) sendContainer.getParent();
            scrollView.post(() -> scrollView.fullScroll(View.FOCUS_DOWN));
            CTPL.getInstance().execute();
        });

        prepareClear.setOnClickListener(v -> {
            prepareContainer.removeAllViews();
            CTPL.getInstance().clean();
        });
        sendClear.setOnClickListener(v -> {
            sendContainer.removeAllViews();
        });
        respClear.setOnClickListener(v -> {
            respContainer.removeAllViews();
        });

        queryContainer = new LinearLayout(this);
        ((LinearLayout) queryContainer).setOrientation(LinearLayout.VERTICAL);
        TextView tv = (TextView) getLayoutInflater().inflate(R.layout.item_drawer_menu, null);
        tv.setBackgroundColor(0x80259B24);
        tv.setText("查询指令");
        queryContainer.addView(tv);

        settingContainer = new LinearLayout(this);
        ((LinearLayout) settingContainer).setOrientation(LinearLayout.VERTICAL);
        tv = (TextView) getLayoutInflater().inflate(R.layout.item_drawer_menu, null);
        tv.setBackgroundColor(0x80259B24);
        tv.setText("设置指令");
        settingContainer.addView(tv);

        printContainer = new LinearLayout(this);
        ((LinearLayout) printContainer).setOrientation(LinearLayout.VERTICAL);
        tv = (TextView) getLayoutInflater().inflate(R.layout.item_drawer_menu, null);
        tv.setBackgroundColor(0x80259B24);
        tv.setText("打印指令");
        printContainer.addView(tv);

        upgradeContainer = new LinearLayout(this);
        ((LinearLayout) upgradeContainer).setOrientation(LinearLayout.VERTICAL);
        tv = (TextView) getLayoutInflater().inflate(R.layout.item_drawer_menu, null);
        tv.setBackgroundColor(0x80259B24);
        tv.setText("固件升级");
        upgradeContainer.addView(tv);

        escContainer = new LinearLayout(this);
        ((LinearLayout) escContainer).setOrientation(LinearLayout.VERTICAL);
        tv = (TextView) getLayoutInflater().inflate(R.layout.item_drawer_menu, null);
        tv.setBackgroundColor(0x80259B24);
        tv.setText("ESC指令打印");
        escContainer.addView(tv);

        SharedPreferences cache = getSharedPreferences("cache", MODE_PRIVATE);
        bluetoothType = cache.getString("defaultType", "无");
        bluetoothMac = cache.getString("defaultMac", "无");
        bluetoothName = cache.getString("defaultName", "无");

        boolean isConnectDefault = (!TextUtils.isEmpty(bluetoothType) && !"无".equals(bluetoothType));
        isConnectDefault &= (!TextUtils.isEmpty(bluetoothMac) && !"无".equals(bluetoothMac));

        initToolBar();
        initDrawerItem();
        if (!App.getInstance().checkBLEPermission()) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                requestPermissions(new String[]{
                        Manifest.permission.BLUETOOTH,
                        Manifest.permission.BLUETOOTH_ADMIN,
                        Manifest.permission.BLUETOOTH_ADVERTISE,
                        Manifest.permission.BLUETOOTH_SCAN,
                        Manifest.permission.BLUETOOTH_CONNECT,
                        Manifest.permission.ACCESS_COARSE_LOCATION,
                        Manifest.permission.ACCESS_FINE_LOCATION,
                }, 0);
            } else {
                requestPermissions(new String[]{
                        Manifest.permission.BLUETOOTH,
                        Manifest.permission.BLUETOOTH_ADMIN,
                        Manifest.permission.ACCESS_COARSE_LOCATION,
                        Manifest.permission.ACCESS_FINE_LOCATION,
                }, 0);
            }
        } else if (isConnectDefault && isAutoConnFirst && !CTPL.getInstance().isConnected()) {//记录默认值,下次启动时连接
            isAutoConnFirst = false;
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

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        boolean isConnectDefault = (!TextUtils.isEmpty(bluetoothType) && !"无".equals(bluetoothType));
        isConnectDefault &= (!TextUtils.isEmpty(bluetoothMac) && !"无".equals(bluetoothMac));
        if (App.getInstance().checkBLEPermission() && (isConnectDefault && isAutoConnFirst && !CTPL.getInstance().isConnected())) {
            isAutoConnFirst = false;
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

    private void initToolBar() {
        setSupportActionBar(toolbar);
        getSupportActionBar().setHomeButtonEnabled(true);
        getSupportActionBar().setDisplayHomeAsUpEnabled(true);
        ActionBarDrawerToggle toggle = new ActionBarDrawerToggle(
                this, drawerLayout, toolbar, 0, 0) {
            @Override
            public void onDrawerOpened(View drawerView) {
                super.onDrawerOpened(drawerView);
                if (drawerContent.getParent() instanceof NestedScrollView && !CTPL.getInstance().isConnected()) {
                    NestedScrollView parent = (NestedScrollView) drawerContent.getParent();
                    parent.post(() -> parent.fullScroll(View.FOCUS_UP));
                }
            }
        };
        toggle.syncState();
        drawerLayout.addDrawerListener(toggle);
        ((TextView)findViewById(R.id.title)).setText(String.format("%s : %s", getTitle(), CTPL.getInstance().getSdkVersion()));
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == 100 && resultCode == RESULT_OK) {
            bluetoothType = data.getStringExtra("searchType");
            bluetoothName = data.getStringExtra("searchName");
            bluetoothMac = data.getStringExtra("searchMac");

            StringBuilder sb = new StringBuilder();
            sb.append("默认蓝牙:")
                    .append(bluetoothType)
                    .append("\n")
                    .append(bluetoothName)
                    .append("\n")
                    .append(bluetoothMac);
            searchSelected.setGravity(Gravity.LEFT | Gravity.CENTER_VERTICAL);
            searchSelected.setText(sb.toString());

            SharedPreferences.Editor editor = getSharedPreferences("cache", MODE_PRIVATE).edit();
            editor.putString("defaultType", bluetoothType);
            editor.putString("defaultName", bluetoothName);
            editor.putString("defaultMac", bluetoothMac);
            editor.commit();
        }
    }

    private void initDrawerItem() {
        drawerContent.removeAllViews();
        TextView tv = (TextView) getLayoutInflater().inflate(R.layout.item_drawer_menu, null);
        StringBuilder sb = new StringBuilder();
        sb.append("默认蓝牙:")
                .append(bluetoothType)
                .append("\n")
                .append(bluetoothName)
                .append("\n")
                .append(bluetoothMac);
        tv.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        tv.setBackgroundColor(0x40_00_00_00);
        tv.setText(sb.toString());
        drawerContent.addView(searchSelected = tv);

        tv = (TextView) getLayoutInflater().inflate(R.layout.item_drawer_menu, null);
        tv.setText("蓝牙SPP搜索");
        tv.setOnClickListener(this::onFuncClick);
        drawerContent.addView(tv);

        tv = (TextView) getLayoutInflater().inflate(R.layout.item_drawer_menu, null);
        tv.setOnClickListener(this::onFuncClick);
        tv.setText("蓝牙BLE搜索");
        drawerContent.addView(tv);

        tv = (TextView) getLayoutInflater().inflate(R.layout.item_drawer_menu, null);
        tv.setOnClickListener(this::onFuncClick);
        tv.setText("蓝牙连接");
        drawerContent.addView(tv);

        tv = (TextView) getLayoutInflater().inflate(R.layout.item_drawer_menu, null);
        tv.setOnClickListener(this::onFuncClick);
        tv.setText("USB连接");
        drawerContent.addView(tv);

        tv = (TextView) getLayoutInflater().inflate(R.layout.item_drawer_menu, null);
        tv.setOnClickListener(this::onFuncClick);
        tv.setText("断开连接");
        drawerContent.addView(tv);


        tv = (TextView) getLayoutInflater().inflate(R.layout.item_drawer_menu, null);
        tv.setOnClickListener(this::onFuncClick);
        tv.setText("示例打印");
        drawerContent.addView(tv);

        tv = (TextView) getLayoutInflater().inflate(R.layout.item_drawer_menu, null);
        tv.setOnClickListener(this::onFuncClick);
        tv.setText("连续打印多张");
        drawerContent.addView(tv);

        int dp48 = DensityUtil.dp2px(this, 48);

        queryContainer.setTag(null);
        queryContainer.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp48));
        queryContainer.setOnClickListener(this::onContainerClick);
        drawerContent.addView(queryContainer);

        settingContainer.setTag(null);
        settingContainer.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp48));
        settingContainer.setOnClickListener(this::onContainerClick);
        drawerContent.addView(settingContainer);

        printContainer.setTag(null);
        printContainer.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp48));
        printContainer.setOnClickListener(this::onContainerClick);
        drawerContent.addView(printContainer);

        upgradeContainer.setTag(null);
        upgradeContainer.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp48));
        upgradeContainer.setOnClickListener(this::onContainerClick);
        drawerContent.addView(upgradeContainer);

        escContainer.setTag(null);
        escContainer.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp48));
        escContainer.setOnClickListener(this::onContainerClick);
        drawerContent.addView(escContainer);

//        insertItem(drawerContent,"图片测试");
//        drawerContent.getChildAt(drawerContent.getChildCount() - 1).setOnClickListener(v->{
//            if(!CTPL.getInstance().isConnected()){
//                Toast.makeText(MainActivity.this, "需要预先连接打印机", Toast.LENGTH_SHORT).show();
//                return;
//            }
//            startActivity(new Intent(MainActivity.this,PicTestActivity.class));
//        });

        String[] strArray = getResources().getStringArray(R.array.queryArray);
        for (int i = 0; i < strArray.length; i++) {
            tv = (TextView) getLayoutInflater().inflate(R.layout.item_drawer_menu, null);
            tv.setOnClickListener(this::onQueryClick);
            tv.setText(strArray[i]);
            tv.setTag(i);
            queryContainer.addView(tv);
        }

        strArray = getResources().getStringArray(R.array.settingArray);
        for (int i = 0; i < strArray.length; i++) {
            tv = (TextView) getLayoutInflater().inflate(R.layout.item_drawer_menu, null);
            tv.setOnClickListener(this::onSettingClick);
            tv.setText(strArray[i]);
            tv.setTag(i);

            if("设置标签的打印份数".equals(strArray[i])){
                tv.setVisibility(View.GONE);
            }
            settingContainer.addView(tv);
        }

        strArray = getResources().getStringArray(R.array.printArray);
        for (int i = 0; i < strArray.length; i++) {
            tv = (TextView) getLayoutInflater().inflate(R.layout.item_drawer_menu, null);
            tv.setOnClickListener(this::onPrintClick);
            tv.setText(strArray[i]);
            tv.setTag(i);
            printContainer.addView(tv);
        }

        strArray = getResources().getStringArray(R.array.upgradeArray);
        for (int i = 0; i < strArray.length; i++) {
            tv = (TextView) getLayoutInflater().inflate(R.layout.item_drawer_menu, null);
            tv.setOnClickListener(this::onUpgradeClick);
            tv.setText(strArray[i]);
            tv.setTag(i);
            upgradeContainer.addView(tv);
        }

        strArray = getResources().getStringArray(R.array.escArray);
        for (int i = 0; i < strArray.length; i++) {
            tv = (TextView) getLayoutInflater().inflate(R.layout.item_drawer_menu, null);
            tv.setOnClickListener(this::onEscCommandClick);
            tv.setText(strArray[i]);
            tv.setTag(i);
            escContainer.addView(tv);
        }
    }

    private void onContainerClick(View v) {
        int dp48 = DensityUtil.dp2px(this, 48);
        if (v instanceof ViewGroup) {
            ViewGroup.LayoutParams p = v.getLayoutParams();
            v.setTag(v.getTag() == null ? 1 : null);
            p.height = v.getTag() == null ? dp48 : LinearLayout.LayoutParams.WRAP_CONTENT;
            v.setBackgroundColor(v.getTag() == null ? Color.TRANSPARENT : 0X20_00_00_00);
            v.setLayoutParams(p);
        }
    }

    private void onFuncClick(View v) {
        int index = drawerContent.indexOfChild(v);
        if (index < 0)
            return;
        switch (index) {
            case 1: {//蓝牙SPP搜索
                Intent intent = new Intent(this, SearchBluetoothActivity.class);
                intent.putExtra("search", "SPP");
                startActivityForResult(intent, 100);
                break;
            }
            case 2: {//蓝牙BLE搜索
                Intent intent = new Intent(this, SearchBluetoothActivity.class);
                intent.putExtra("search", "BLE");
                startActivityForResult(intent, 100);
                break;
            }
            case 3: {//蓝牙连接
                Device d = new Device();
                CTPL.Port port = "SPP".equals(bluetoothType) ? CTPL.Port.SPP : CTPL.Port.BLE;
                d.setPort(port);
                d.setBluetoothMacAddr(bluetoothMac);
                if (port == CTPL.Port.BLE) {
                    d.setBleServiceUUID("49535343-fe7d-4ae5-8fa9-9fafd205e455");
                }
                CTPL.getInstance().connect(d);
                break;
            }
            case 4: {//USB连接
                Device d = new Device();
                d.setPort(CTPL.Port.USB);
                //CT220B
//                d.setUsbDeviceVendorId(1155);
//                d.setUsbDeviceProductId(22304);

                //CT320B
//                d.setUsbDeviceVendorId(10473);
//                d.setUsbDeviceProductId(644);

                //CT320D
//                d.setUsbDeviceVendorId(10473);
//                d.setUsbDeviceProductId(664);
                CTPL.getInstance().connect(d);
                break;
            }
            case 5: {//断开连接
                if(!CTPL.getInstance().isConnected()){
                    Toast.makeText(this, "当前未连接打印机", Toast.LENGTH_SHORT).show();
                    break;
                }
                CTPL.getInstance().disconnect();
                break;
            }
            case 6: {//示例打印
                if (!CTPL.getInstance().isConnected())
                    break;
                int dpi203 = 8, widthMM = 40, heightMM = 30;
                int left = 0, top = 0;
                Bitmap b = BitmapFactory.decodeResource(getResources(), R.drawable.test_4);
                if (b.getWidth() == widthMM * dpi203 && b.getHeight() == heightMM * dpi203) {
                    CTPL.getInstance().clean();
                    CTPL.getInstance()
                            .setSize(widthMM, heightMM)
                            .drawBitmap(new Rect(left, top, left + b.getWidth(), top + b.getHeight()),
                                    b, true, null)
                            .print(1)
                            .execute();
                }
                insertItem(sendContainer, "示例打印");
                break;
            }
            case 7: {//示例多张打印
                if (!CTPL.getInstance().isConnected())
                    break;
                @DrawableRes int[] resArray = new int[]{
                        //可以替换为自己下载的webImage,或者生成view并截图为Bitmap,需注意图片尺寸大小
                        R.drawable.multiple_001,
                        R.drawable.multiple_002,
                        R.drawable.multiple_003,
                        R.drawable.multiple_004,
                        R.drawable.multiple_005,

                        R.drawable.multiple_001,
                        R.drawable.multiple_002,
                        R.drawable.multiple_003,
                        R.drawable.multiple_004,
                        R.drawable.multiple_005,

                };
                Bitmap b;
                int dpiDot = 8;/*200dpi*/
                int left = 0, top = 0;//unit:px
                boolean isSupportCompress = true;
                CTPL.getInstance().clean();
                Paint p = new Paint();
                p.setColor(Color.BLACK);
                p.setTextSize(24 * 3);
                CTPL.getInstance().setBackpressure(true);
                for (int j = 0; j < resArray.length; j++) {
                    b = BitmapFactory.decodeResource(getResources(), resArray[j]);
                    b = b.copy(Bitmap.Config.RGB_565, true);
                    Canvas c = new Canvas(b);
                    c.drawText((j + 1) + "", 20 * dpiDot, 25 * dpiDot, p);
                    CTPL.getInstance()
                            .setSize((b.getWidth() % 8 == 0 ? b.getWidth() : b.getWidth() + 8 - (b.getWidth() % 8)) / dpiDot,
                                    b.getHeight() / dpiDot)
                            .drawBitmap(new Rect(left, top, left + b.getWidth(), top + b.getHeight()),
                                    b, isSupportCompress, null)
                            .print(1)
                            .execute();
                    try {
                        Thread.sleep(80L);
                    } catch (InterruptedException e) {
                        throw new RuntimeException(e);
                    }
                }
            }
        }
    }

    private void onQueryClick(View v) {
        Object tag = v.getTag();
        if (!(tag instanceof Number)) {
            return;
        }
        int index = (int) tag;
        String[] strArray = getResources().getStringArray(R.array.queryArray);

        StringBuilder sb = new StringBuilder();
        sb.append("查询:").append(strArray[index]);
        Log.d(App.TAG, sb.toString());

        switch (index) {
            case 0: {//查询打印机状态
                CTPL.getInstance().queryPrintState();
                insertItem(prepareContainer, sb.toString());
                break;
            }
            case 1: {//查询硬件配置(合并)
                CTPL.getInstance().queryHardwareConfig();
                insertItem(prepareContainer, sb.toString());
                break;
            }
            case 2: {//查询打印机型号
                CTPL.getInstance().queryHardwareModel();
                insertItem(prepareContainer, sb.toString());
                break;
            }
            case 3: {//查询是否支持压缩算法
                CTPL.getInstance().queryCompressPrint();
                insertItem(prepareContainer, sb.toString());
                break;
            }
            case 4: {//查询固件信息(合并)
                CTPL.getInstance().queryFirmwareInfo();
                insertItem(prepareContainer, sb.toString());
                break;
            }
            case 5: {//查询纸张类型
                CTPL.getInstance().queryPaperType();
                insertItem(prepareContainer, sb.toString());
                break;
            }
            case 6: {//查询记忆打印状态
                CTPL.getInstance().queryMemoryPrint();
                insertItem(prepareContainer, sb.toString());
                break;
            }
            case 7: {//查询打印浓度
                CTPL.getInstance().queryDensity();
                insertItem(prepareContainer, sb.toString());
                break;
            }
            case 8: {//查询打印速度
                CTPL.getInstance().querySpeed();
                insertItem(prepareContainer, sb.toString());
                break;
            }
            case 9: {//查询自动关机(分钟)
                CTPL.getInstance().queryAutoShutdown();
                insertItem(prepareContainer, sb.toString());
                break;
            }
            case 10: {//查询展示参数(合并)
                CTPL.getInstance().queryDisplayInfo();
                insertItem(prepareContainer, sb.toString());
                break;
            }
            case 11: {//查询硬件版本号
                CTPL.getInstance().queryHardwareVersion();
                insertItem(prepareContainer, sb.toString());
                break;
            }
            case 12: {//查询固件版本号
                CTPL.getInstance().queryBinaryInfo();
                insertItem(prepareContainer, sb.toString());
                break;
            }
            case 13: {//查询当前电量
                CTPL.getInstance().queryBattery();
                insertItem(prepareContainer, sb.toString());
                break;
            }
            case 14: {//查询打印模式
                CTPL.getInstance().queryPrintMode();
                insertItem(prepareContainer, sb.toString());
                break;
            }
            case 15: {//查询USB信息
                CTPL.getInstance().queryVidAndPid();
                insertItem(prepareContainer, sb.toString());
                break;
            }
            case 16: {//打印自检页
                CTPL.getInstance().selfTest();
                insertItem(prepareContainer, sb.toString());
                break;
            }
        }
    }

    private void onSettingClick(View v) {
        Object tag = v.getTag();
        if (!(tag instanceof Number)) {
            return;
        }
        int index = (int) tag;
        String[] strArray = getResources().getStringArray(R.array.settingArray);
        if (index > strArray.length - 1)
            return;
        StringBuilder sb = new StringBuilder();
        sb.append("设置:").append(strArray[index]);
        Log.d(App.TAG, sb.toString());

        switch (index) {
            case 0: {//设置打印模式
                showInputEditText("0", str -> {
                    Matcher isNum = Pattern.compile("\\d").matcher(str);
                    if (!isNum.matches()) {
                        Toast.makeText(this, "纯数字0~3", Toast.LENGTH_SHORT).show();
                        return false;
                    }
                    sb.append(str);
                    CTPL.getInstance().setPrintMode(PrintMode.valueOf(Integer.parseInt(str.charAt(0) + "")));
                    insertItem(prepareContainer, sb.toString());
                    return true;
                });
                break;
            }
            case 1: {//设置纸张类型
                showInputEditText("0", str -> {
                    Matcher isNum = Pattern.compile("\\d").matcher(str);
                    if (!isNum.matches()) {
                        Toast.makeText(this, "纯数字0~2", Toast.LENGTH_SHORT).show();
                        return false;
                    }
                    sb.append(str);
                    CTPL.getInstance().setPaperType(PaperType.valueOf(Integer.parseInt(str.charAt(0) + "")));
                    insertItem(prepareContainer, sb.toString());
                    return true;
                });
                break;
            }
            case 2: {//设置记忆打印
                showInputEditText("1", str -> {
                    boolean toggle = "1".equals(str);
                    sb.append(toggle ? "开" : "关");
                    CTPL.getInstance().setMemoryPrint(toggle);
                    insertItem(prepareContainer, sb.toString());
                    return true;
                });
                break;
            }
            case 3: {//设置自动关机时间
                showInputEditText("10", str -> {
                    Matcher isNum = Pattern.compile("\\d{1,2}").matcher(str);
                    if (!isNum.matches()) {
                        Toast.makeText(this, "纯数字0~60", Toast.LENGTH_SHORT).show();
                        return false;
                    }
                    sb.append(str);
                    CTPL.getInstance().setAutoShutdown(Math.max(0, Math.min(60, Integer.parseInt(str))));
                    insertItem(prepareContainer, sb.toString());
                    return true;
                });
                break;
            }
            case 4: {//设置恢复出厂设置
                CTPL.getInstance().resetFirmware();
                insertItem(prepareContainer, sb.toString());
                break;
            }

            case 5: {//设置标签的打印份数
                Toast.makeText(this, "无效功能,执行打印功能包含此选项", Toast.LENGTH_SHORT).show();
//                CTPL.getInstance().setPrintSize(40,40);
//                insertItem(prepareContainer, sb.toString());
                break;
            }
            case 6: {//设置打印速度
                showInputEditText("5", str -> {
                    Matcher isNum = Pattern.compile("\\d{1,2}").matcher(str);
                    if (!isNum.matches()) {
                        Toast.makeText(this, "纯数字1~8", Toast.LENGTH_SHORT).show();
                        return false;
                    }
                    sb.append(str);
                    CTPL.getInstance().setPrintSpeed(Integer.parseInt(str));
                    insertItem(prepareContainer, sb.toString());
                    return true;
                });
                break;
            }
            case 7: {//设置打印浓度
                showInputEditText("8", str -> {
                    Matcher isNum = Pattern.compile("\\d{1,2}").matcher(str);
                    if (!isNum.matches()) {
                        Toast.makeText(this, "纯数字-~15", Toast.LENGTH_SHORT).show();
                        return false;
                    }
                    sb.append(str);
                    CTPL.getInstance().setPrintDensity(Integer.parseInt(str));
                    insertItem(prepareContainer, sb.toString());
                    return true;
                });
                break;
            }
            case 8: {//设置打印方向和镜像
                showInputEditText("1", str -> {
                    Matcher isNum = Pattern.compile("\\d{1,4}").matcher(str);
                    if (!isNum.matches()) {
                        Toast.makeText(this, "纯数字1普通,2旋转,3镜像,4旋转+镜像", Toast.LENGTH_LONG).show();
                        return false;
                    }
                    int input = Integer.parseInt(str);
                    Direction d;
                    Mirror m;


                    if (input == 1) {
                        d = Direction.Degree0;
                        m = Mirror.Normal;
                    } else if (input == 2) {
                        d = Direction.Degree180;
                        m = Mirror.Normal;
                    } else if (input == 3) {
                        d = Direction.Degree0;
                        m = Mirror.Flip;
                    } else if (input == 4) {
                        d = Direction.Degree180;
                        m = Mirror.Flip;
                    } else {
                        Toast.makeText(this, "纯数字1普通,2旋转,3镜像,4旋转+镜像", Toast.LENGTH_LONG).show();
                        return false;
                    }

                    sb.append(d + "," + m);
                    CTPL.getInstance().setOrientation(d, m);
                    insertItem(prepareContainer, sb.toString());
                    return true;
                });
                break;
            }
            case 9: {//设置偏移
                showInputEditText("24,24", str -> {
                    Matcher isNum = Pattern.compile("\\d{1,2},\\d{1,2}").matcher(str);
                    if (!isNum.matches()) {
                        Toast.makeText(this, "纯数字{左偏移,上偏移}", Toast.LENGTH_SHORT).show();
                        return false;
                    }

                    String[] split = str.split(",");

                    sb.append(Integer.parseInt(split[0]) + "," + Integer.parseInt(split[1]));
                    CTPL.getInstance().setShift(Integer.parseInt(split[0]), Integer.parseInt(split[1]));
                    insertItem(prepareContainer, sb.toString());
                    return true;
                });
                break;
            }
            case 10:{
                CTPL.getInstance().clean();
                CTPL.getInstance().setFormFeed().execute();
                break;
            }
        }
    }

    private void onPrintClick(View v) {
        Object tag = v.getTag();
        if (!(tag instanceof Number)) {
            return;
        }
        int index = (int) tag;
        String[] strArray = getResources().getStringArray(R.array.printArray);
        if (index > strArray.length - 1)
            return;
        StringBuilder sb = new StringBuilder();
        sb.append("打印:").append(strArray[index]);
        Log.d(App.TAG, sb.toString());

        switch (index) {
            case 0: {//设置纸张的宽度及高度
                showInputEditText("60,40", str -> {
                    Matcher isNum = Pattern.compile("\\d{1,3},\\d{1,3}").matcher(str);
                    if (!isNum.matches()) {
                        Toast.makeText(this, "参数必须包含{宽,高}数字", Toast.LENGTH_SHORT).show();
                        return false;
                    }
                    sb.append(str);
                    String[] split = str.split(",");
                    CTPL.getInstance().setSize(Integer.parseInt(split[0]), Integer.parseInt(split[1]));
                    insertItem(prepareContainer, sb.toString());
                    return true;
                });
                break;
            }

            case 1: {//绘制矩形
                showInputEditText("10,10,100,50,1,1", str -> {
                    Matcher isNum = Pattern.compile("\\d{1,3},\\d{1,3},\\d{1,3},\\d{1,3},\\d{1,1},\\d{1,2}").matcher(str);
                    if (!isNum.matches()) {
                        Toast.makeText(this, "纯数字{左,上,右,下,0~1空心/实心,0~99空心边框粗细}", Toast.LENGTH_LONG).show();
                        return false;
                    }
                    String[] split = str.split(",");
                    CTPL.getInstance().drawRect(new Rect(
                                    Integer.parseInt(split[0]),
                                    Integer.parseInt(split[1]),
                                    Integer.parseInt(split[2]),
                                    Integer.parseInt(split[3])),
                            Integer.parseInt(split[4]) > 0, Integer.parseInt(split[5]));
                    sb.append(str);
                    insertItem(prepareContainer, sb.toString());
                    return true;
                });
                break;
            }

            case 2: {//绘制线条
//                CTPL.getInstance().drawLine(new Point())
                showInputEditText("10,10,100,50", str -> {
                    Matcher isNum = Pattern.compile("\\d{1,3},\\d{1,3},\\d{1,3},\\d{1,3}").matcher(str);
                    if (!isNum.matches()) {
                        Toast.makeText(this, "纯数字{左,上,宽,高}", Toast.LENGTH_LONG).show();
                        return false;
                    }
                    String[] split = str.split(",");

                    CTPL.getInstance().drawLine(new Point(Integer.parseInt(split[0]),
                                    Integer.parseInt(split[1])), Integer.parseInt(split[2]),
                            Integer.parseInt(split[3]));
                    sb.append(str);
                    insertItem(prepareContainer, sb.toString());
                    return true;
                });
                break;
            }
            case 3: {//绘制文本
                showInputEditText("10,10,1,1,1,这是文本内容", str -> {
                    Matcher isNum = Pattern.compile("^\\d{1,3},\\d{1,3},\\d{1,2},\\d{1,2},\\d,(.*?)$").matcher(str);
                    if (!isNum.matches()) {
                        Toast.makeText(this, "{左,上,水平1~10,垂直1~10,旋转1~4,文本}", Toast.LENGTH_LONG).show();
                        return false;
                    }

                    String[] split = str.split(",");

                    int rotate = Integer.parseInt(split[4]);
                    Rotate r;
                    if (rotate == 2)
                        r = Rotate.Degree90;
                    else if (rotate == 3)
                        r = Rotate.Degree180;
                    else if (rotate == 4)
                        r = Rotate.Degree270;
                    else
                        r = Rotate.Degree0;

                    CTPL.getInstance().drawText(
                            new Point(Integer.parseInt(split[0]), Integer.parseInt(split[1])),
                            r, Integer.parseInt(split[2]), Integer.parseInt(split[3]),
                            split[5]);

                    sb.append(split[0] + "," + split[1]).append(",");
                    sb.append("xScale:").append(Integer.parseInt(split[2])).append(",");
                    sb.append("yScale:").append(Integer.parseInt(split[3])).append(",");
                    sb.append("Rotate:").append(r).append(",");
                    sb.append(split[5]);

                    insertItem(prepareContainer, sb.toString());
                    return true;
                });

                break;
            }
            case 4: {//绘制条码
                showInputEditText("10,10,80,4,1,1,123456", str -> {
                    Matcher isNum = Pattern.compile("^\\d{1,3},\\d{1,3},\\d{1,3},\\d{1,2},\\d,\\d,(.*?)$").matcher(str);
                    if (!isNum.matches()) {
                        Toast.makeText(this, "纯数字{左,上,高度10~255,条码类型1~10,排版1~3,旋转1~4,内容}", Toast.LENGTH_LONG).show();
                        return false;
                    }
                    String[] split = str.split(",");
                    Point p = new Point(Integer.parseInt(split[0]), Integer.parseInt(split[1]));
                    int heightDot = Integer.parseInt(split[2]);
                    int type = Integer.parseInt(split[3]);
                    BarCode b;
                    switch (type) {
                        case 1:
                            b = BarCode.CODE_BAR;
                            break;
                        case 2:
                            b = BarCode.CODE_39;
                            break;
                        case 3:
                            b = BarCode.CODE_93;
                            break;
                        case 5:
                            b = BarCode.UPC_A;
                            break;
                        case 6:
                            b = BarCode.UPC_E;
                            break;
                        case 7:
                            b = BarCode.EAN_8;
                            break;
                        case 8:
                            b = BarCode.EAN_13;
                            break;
                        case 9:
                            b = BarCode.EAN_128;
                            break;
                        case 10:
                            b = BarCode.ITF;
                            break;
                        case 4:
                        default:
                            b = BarCode.CODE_128;
                            break;
                    }
                    Paint.Align pa;
                    int align = Integer.parseInt(split[4]);
                    if (align == 1)
                        pa = Paint.Align.LEFT;
                    else if (align == 2)
                        pa = Paint.Align.CENTER;
                    else if (align == 3)
                        pa = Paint.Align.RIGHT;
                    else
                        pa = null;

                    int rotate = Integer.parseInt(split[5]);
                    Rotate r;
                    if (rotate == 2)
                        r = Rotate.Degree90;
                    else if (rotate == 3)
                        r = Rotate.Degree180;
                    else if (rotate == 4)
                        r = Rotate.Degree270;
                    else
                        r = Rotate.Degree0;

                    String content = split[6];
                    CTPL.getInstance().drawBarCode(p, heightDot, b, pa, r, 2, 2, content);

                    sb.append(split[0] + "," + split[1]).append(",");
                    sb.append("高:").append(heightDot).append(",");
                    sb.append(b).append(",");
                    sb.append(pa).append(",");
                    sb.append(r).append(",");
                    sb.append(split[6]);
                    insertItem(prepareContainer, sb.toString());
                    return true;
                });
                break;
            }
            case 5: {//绘制QR
                showInputEditText("10,10,2,3,这是文本内容", str -> {
                    Matcher isNum = Pattern.compile("^\\d{1,3},\\d{1,3},\\d,\\d{1,2},(.*?)$").matcher(str);
                    if (!isNum.matches()) {
                        Toast.makeText(this, "纯数字{左,上,二维码等级1~4,单元尺寸1~10,文本}", Toast.LENGTH_LONG).show();
                        return false;
                    }
                    String[] split = str.split(",");
                    Point p = new Point(Integer.parseInt(split[0]), Integer.parseInt(split[1]));
                    int level = Integer.parseInt(split[2]);
                    int cellWidth = Integer.parseInt(split[3]);
                    QRLevel l;
                    if (level == 2)
                        l = QRLevel.ECC_M;
                    else if (level == 3)
                        l = QRLevel.ECC_Q;
                    else if (level == 4)
                        l = QRLevel.ECC_H;
                    else
                        l = QRLevel.ECC_L;
                    String content = split[4];
                    CTPL.getInstance().drawQRCode(p, l, cellWidth, QREncodeMode.AUTO, content);
                    sb.append(split[0] + "," + split[1]).append(",");
                    sb.append("单元大小:").append(cellWidth).append(",");
                    sb.append("纠错等级:").append(l).append(",");
                    sb.append(content);
                    insertItem(prepareContainer, sb.toString());
                    return true;
                });
                break;
            }
            case 6: {//绘制图片
                showInputEditText("10,10,150,1", str -> {
                    Matcher isNum = Pattern.compile("\\d{1,3},\\d{1,3},\\d{1,3},\\d").matcher(str);
                    if (!isNum.matches()) {
                        Toast.makeText(this, "纯数字{左,上,黑度0~255,示例图片1~3}", Toast.LENGTH_LONG).show();
                        return false;
                    }
                    @DrawableRes
                    int[] bmpArray = new int[]{
                            R.drawable.test_big,
                            R.drawable.test_2,
                            R.drawable.test_4,
                    };
                    String[] split = str.split(",");
                    int bmpIndex = Math.max(0, Math.min(Integer.parseInt(split[3]) - 1, bmpArray.length - 1));
                    Bitmap b = BitmapFactory.decodeResource(getResources(), bmpArray[bmpIndex]);
                    sb.append(str);
                    int left = Integer.parseInt(split[0]);
                    int top = Integer.parseInt(split[1]);
                    int quality = Integer.parseInt(split[2]);
                    CTPL.getInstance().drawBitmap(new Rect(left,
                            top, left + b.getWidth(), top + b.getHeight()), b, false, quality);
                    insertItem(prepareContainer, sb.toString());
                    return true;
                });
                break;
            }
            case 7: {//绘制压缩图片
                showInputEditText("10,10,150,4", str -> {
                    Matcher isNum = Pattern.compile("\\d{1,3},\\d{1,3},\\d{1,3},\\d").matcher(str);
                    if (!isNum.matches()) {
                        Toast.makeText(this, "纯数字{左,上,清晰度0~255,示例图片1~4}", Toast.LENGTH_LONG).show();
                        return false;
                    }
                    @DrawableRes
                    int[] bmpArray = new int[]{
                            R.drawable.test_big,
                            R.drawable.test_2,
                            R.drawable.test_4,
                            R.drawable.test_5,
                            R.drawable.test_6,
                    };
                    String[] split = str.split(",");
                    sb.append(str);
                    int left = Integer.parseInt(split[0]);
                    int top = Integer.parseInt(split[1]);
                    int quality = Integer.parseInt(split[2]);

                    int bmpIndex = Math.max(0, Math.min(Integer.parseInt(split[3]) - 1, bmpArray.length - 1));
                    if (bmpIndex != 4) {
                        Bitmap b = BitmapFactory.decodeResource(getResources(), bmpArray[bmpIndex]);
                        CTPL.getInstance().drawBitmap(new Rect(left,
                                top, left + b.getWidth() % 8 == 0 ? b.getWidth() : b.getWidth() + 8 - (b.getWidth() % 8),
                                top + b.getHeight()), b, true, quality);
                        insertItem(prepareContainer, sb.toString());
                        return true;
                    }
                    //----------------------------------------------------------------------------------------------
                    //R.drawable.test_6 超长图,需要特定固件支持
                    BitmapFactory.Options opts = new BitmapFactory.Options();
                    opts.inJustDecodeBounds = true;
                    BitmapFactory.decodeResource(getResources(), bmpArray[bmpIndex], opts);
                    final TypedValue value = new TypedValue();
                    InputStream is = getResources().openRawResource(bmpArray[bmpIndex], value);
                    ByteArrayOutputStream baos = new ByteArrayOutputStream(1024 * 512);
                    try {
                        byte[] buffer = new byte[1024];
                        int len = -1;
                        while ((len = is.read(buffer)) > 0) {
                            baos.write(buffer, 0, len);
                        }
                    } catch (IOException e) {
                        Log.wtf(TAG, e);
                    } finally {
                        try {
                            is.close();
                        } catch (IOException e) {
                            Log.wtf(TAG, e);
                        }
                    }

                    int dpiDot = 8;/*200dpi*/
                    final int PRINT_FILE_HEIGHT_LIMIT = dpiDot * 150/*mm*/;

                    if (opts.outHeight <= PRINT_FILE_HEIGHT_LIMIT) {
                        Bitmap b = BitmapFactory.decodeResource(getResources(), bmpArray[bmpIndex]);
                        CTPL.getInstance().clean();
                        CTPL.getInstance().setSize((b.getWidth() % 8 == 0 ? b.getWidth() : b.getWidth() + 8 - (b.getWidth() % 8)) / dpiDot,
                                b.getHeight() / dpiDot);
                        CTPL.getInstance().drawBitmap(new Rect(left,
                                top, left + b.getWidth() % 8 == 0 ? b.getWidth() : b.getWidth() + 8 - (b.getWidth() % 8),
                                top + b.getHeight()), b, true, quality);
                        CTPL.getInstance().print(1);
                        CTPL.getInstance().execute();
                    }

                    int size = opts.outHeight / PRINT_FILE_HEIGHT_LIMIT;
                    if (opts.outHeight % PRINT_FILE_HEIGHT_LIMIT != 0) {
                        size += 1;
                    }

                    BitmapRegionDecoder decoder = null;
                    try {
                        byte[] data = baos.toByteArray();
                        decoder = BitmapRegionDecoder.newInstance(data, 0, data.length, false);

                    } catch (IOException e) {
                        Log.wtf(TAG, e);
                    }
                    if (decoder == null) {
                        return true;
                    }

                    int count = 5;
                    int cutY;
                    Bitmap cutBmp;
                    CTPL.getInstance().clean();
                    for (int j = 0; j < count; j++) {
                        for (int i = 0; i < size; i++) {
                            cutY = i * PRINT_FILE_HEIGHT_LIMIT;
                            cutBmp = decoder.decodeRegion(new Rect(left, top + cutY,
                                    opts.outWidth, Math.min(top + cutY + PRINT_FILE_HEIGHT_LIMIT, opts.outHeight)), null);
                            CTPL.getInstance().setSize((cutBmp.getWidth() % 8 == 0 ? cutBmp.getWidth() :
                                    cutBmp.getWidth() + 8 - (cutBmp.getWidth() % 8)) / dpiDot, cutBmp.getHeight() / dpiDot);
                            CTPL.getInstance().drawBitmapSplit(new Rect(left,
                                    top, left + cutBmp.getWidth() % 8 == 0 ? cutBmp.getWidth() : cutBmp.getWidth() + 8 - (cutBmp.getWidth() % 8),
                                    top + cutBmp.getHeight()), cutBmp, true, i < size - 1, quality);
                            CTPL.getInstance().print(1);
                            CTPL.getInstance().execute();
                        }
                        try {
                            Thread.sleep(80);
                        } catch (InterruptedException e) {
                            Log.wtf(TAG, e);
                        }
                    }
                    return true;
                });
                break;
            }
            case 8: {//设置指定区域反色
                showInputEditText("0,0,100,100", str -> {
                    Matcher isNum = Pattern.compile("\\d{1,3},\\d{1,3},\\d{1,3},\\d{1,3}").matcher(str);
                    if (!isNum.matches()) {
                        Toast.makeText(this, "纯数字{左,上,宽,高}", Toast.LENGTH_LONG).show();
                        return false;
                    }
                    String[] split = str.split(",");


                    CTPL.getInstance().setReverse(new Rect(Integer.parseInt(split[0]), Integer.parseInt(split[1]),
                            Integer.parseInt(split[2]), Integer.parseInt(split[3])));
                    sb.append("反色:").append(str);
                    insertItem(prepareContainer, sb.toString());
                    drawerLayout.closeDrawer(Gravity.LEFT, false);
                    return true;
                });
                break;
            }
            case 9: {//执行打印
                showInputEditText("1", str -> {
                    Matcher isNum = Pattern.compile("\\d{1,2}").matcher(str);
                    if (!isNum.matches()) {
                        Toast.makeText(this, "纯数字{份数1~99}", Toast.LENGTH_LONG).show();
                        return false;
                    }
                    CTPL.getInstance().print(Integer.parseInt(str));
                    sb.append("份数:").append(Integer.parseInt(str));
                    insertItem(prepareContainer, sb.toString());
                    drawerLayout.closeDrawer(Gravity.LEFT, false);
                    return true;
                });
                break;
            }
        }
    }

    private void onUpgradeClick(View v) {
        Object tag = v.getTag();
        if (!(tag instanceof Number)) {
            return;
        }
        int index = (int) tag;
        switch (index) {
            case 0: {
//                boolean hasFilePermission = hasFilePermission(this);
                boolean hasFilePermission = true;
                String name = "test_upgrade.bin";

                File binFile = new File(getExternalCacheDir(), name);
                if (!hasFilePermission) {
                    Toast.makeText(this, "权限不可用", Toast.LENGTH_SHORT).show();
                    requestPermissions(new String[]{
                            Manifest.permission.READ_EXTERNAL_STORAGE,
                            Manifest.permission.WRITE_EXTERNAL_STORAGE,
                            Manifest.permission.MANAGE_EXTERNAL_STORAGE,
                    }, 0);
                    break;
                }
                if (!binFile.exists() || !binFile.isFile() || binFile.length() <= 0) {
                    Toast.makeText(this, name + "文件不可用", Toast.LENGTH_LONG).show();
                    break;
                }

                if (!CTPL.getInstance().isConnected()) {
                    Toast.makeText(this, "设备未连接", Toast.LENGTH_SHORT).show();
                    break;
                }

                FileInputStream fis = null;
                byte[] fileData = null;
                try {
                    fis = new FileInputStream(binFile);
                    int fileSize = fis.available();
                    if (fileSize > 3 * 1024 * 1024) {
                        return;
                    }
                    fileData = new byte[fileSize];
                    fis.read(fileData);
                } catch (IOException e) {
                    e.printStackTrace();
                } finally {
                    try {
                        if (fis != null)
                            fis.close();
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
                CTPL.getInstance().requestOTA(fileData);
                break;
            }
            case 1:{
                boolean hasFilePermission = true;
                String name = "test_font_upgrade.bin";
                File binFile = new File(getExternalCacheDir(), name);
                if (!hasFilePermission) {
                    Toast.makeText(this, "权限不可用", Toast.LENGTH_SHORT).show();
                    requestPermissions(new String[]{
                            Manifest.permission.READ_EXTERNAL_STORAGE,
                            Manifest.permission.WRITE_EXTERNAL_STORAGE,
                            Manifest.permission.MANAGE_EXTERNAL_STORAGE,
                    }, 0);
                    break;
                }
                if (!binFile.exists() || !binFile.isFile() || binFile.length() <= 0) {
                    Toast.makeText(this, name + "文件不可用", Toast.LENGTH_LONG).show();
                    break;
                }

                if (!CTPL.getInstance().isConnected()) {
                    Toast.makeText(this, "设备未连接", Toast.LENGTH_SHORT).show();
                    break;
                }

                FileInputStream fis = null;
                byte[] fileData = null;
                try {
                    fis = new FileInputStream(binFile);
                    int fileSize = fis.available();
                    if (fileSize > 3 * 1024 * 1024) {
                        return;
                    }
                    fileData = new byte[fileSize];
                    fis.read(fileData);
                } catch (IOException e) {
                    e.printStackTrace();
                } finally {
                    try {
                        if (fis != null)
                            fis.close();
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
                CTPL.getInstance().requestOTAFont(fileData);
                break;
            }
        }
    }

    private void onEscCommandClick(View v) {
        if (!CTPL.getInstance().isConnected()) {
            Toast.makeText(this, "设备未连接", Toast.LENGTH_SHORT).show();
            return;
        }

        Object tag = v.getTag();
        if (!(tag instanceof Number)) {
            return;
        }
        int index = (int) tag;
        Log.d(App.TAG, ((TextView) v).getText().toString());


        switch (index) {
            case 0: {//打印文字
                showInputEditText("这是ESC打印文本", str -> {
                    if (TextUtils.isEmpty(str))
                        return false;

                    CTPL.getInstance().clean();
                    CTPL.getInstance().append(new byte[]{
                            27, 64,
                            27, 97, 1,//0居左,1居中,2居右
                    });
                    CTPL.getInstance().append(str.getBytes(Charset.forName("gb2312")));
                    CTPL.getInstance().append(new byte[]{0X0D, 0X0A});
                    CTPL.getInstance().execute();
                    insertItem(sendContainer, "ESC打印文字");
                    return true;
                });
                break;
            }
            case 1: {//打印条码
                showInputEditText("12345678", str -> {
                    if (TextUtils.isEmpty(str))
                        return false;
                    int dpi = 8;
                    CTPL.getInstance().clean();
                    CTPL.getInstance().append(new byte[]{
                            27, 64,
                            29, 119, 3,/*3:条码宽度1~6*/
                            29, 104, (byte) (5 * dpi),/*5:条码高度*/
                            29, 72, 48 + 1,/*0:条码内容0隐藏,1显示*/
                            29, 107,
                    });
                    int type = 0;
                    BarCode b;
                    switch (type) {
                        case 1:
                            b = BarCode.UPC_A;
                            CTPL.getInstance().append(new byte[]{65});
                            break;
                        case 2:
                            b = BarCode.UPC_E;
                            CTPL.getInstance().append(new byte[]{66});
                            break;
                        case 3:
                            b = BarCode.EAN_13;
                            CTPL.getInstance().append(new byte[]{67});
                            break;
                        case 4:
                            b = BarCode.EAN_8;
                            CTPL.getInstance().append(new byte[]{68});
                            break;
                        case 5:
                            b = BarCode.CODE_39;
                            CTPL.getInstance().append(new byte[]{69});
                            break;
                        case 6:
                            b = BarCode.ITF;
                            CTPL.getInstance().append(new byte[]{70});
                            break;
                        case 7:
                            b = BarCode.CODE_BAR;
                            CTPL.getInstance().append(new byte[]{71});
                            break;
                        case 8:
                            b = BarCode.CODE_93;
                            CTPL.getInstance().append(new byte[]{72});
                            break;
                        case 0:
                        default:
                            b = BarCode.CODE_128;
                            CTPL.getInstance().append(new byte[]{73});
                            break;
                    }
                    byte[] content = str.getBytes(Charset.forName("gb2312"));
                    CTPL.getInstance().append(new byte[]{(byte) (content.length + 2), 123, 65});
                    CTPL.getInstance().append(content);
                    CTPL.getInstance().append(new byte[]{0X0A});
                    CTPL.getInstance().execute();
                    insertItem(sendContainer, "ESC打印条码code128,其他码制请查阅代码");
                    return true;
                });
                break;
            }
            case 2: {//打印二维码
                showInputEditText("https://dlabel.cn", str -> {
                    if (TextUtils.isEmpty(str))
                        return false;

                    byte[] content = str.getBytes(Charset.forName("gb2312"));

                    CTPL.getInstance().clean();
                    CTPL.getInstance().append(new byte[]{
                            27, 64,
                            29, 40, 107, 3, 0, 49, 67, 12,/*3:单元格大小1~9*/
                            29, 40, 107, (byte) ((content.length + 3) % 256), (byte) ((content.length + 3) / 256), 49, 80, 48,
                    });
                    CTPL.getInstance().append(content);
                    CTPL.getInstance().append(new byte[]{
                            29, 40, 107, 3, 0, 49, 81, 48
                    });
                    CTPL.getInstance().append(new byte[]{0X0A});
                    CTPL.getInstance().execute();
                    insertItem(sendContainer, "ESC打印二维码QRcode");
                    return true;
                });
                break;
            }
            case 3: {//打印线条
                Log.d(App.TAG, ((TextView) v).getText().toString());
                showInputEditText("58,2", str -> {
                    Matcher isNum = Pattern.compile("\\d{1,3},\\d{1,3}").matcher(str);
                    if (!isNum.matches()) {
                        Toast.makeText(this, "参数必须包含{宽,高}数字", Toast.LENGTH_SHORT).show();
                        return false;
                    }
                    String[] split = str.split(",");
                    int dpi = 8;//打印机分辨率 决定清晰度
                    int width = Integer.parseInt(split[0]) * dpi;
                    int height = Integer.parseInt(split[1]) * dpi;

                    CTPL.getInstance().clean();
                    CTPL.getInstance().append(new byte[]{
                            29, 40, 82, (byte) (width / 256), (byte) (width % 256),
                            (byte) (height / 256), (byte) (height % 256)
                    });
                    CTPL.getInstance().append(new byte[]{0X0A});
                    CTPL.getInstance().execute();
                    insertItem(sendContainer, "ESC打印线条");
                    return true;
                });
                break;
            }
            case 4: {//打印图片
                showInputEditText("1", str -> {
                    Matcher isNum = Pattern.compile("[12345]").matcher(str);
                    if (!isNum.matches()) {
                        Toast.makeText(this, "示例图片1~5}", Toast.LENGTH_LONG).show();
                        return false;
                    }

                    Toast.makeText(this, "示例图片发送中...", Toast.LENGTH_LONG).show();

                    int idx = Integer.parseInt(str) - 1;
                    int[] resArr = new int[]{
                            R.drawable.multiple_001,
                            R.drawable.multiple_002,
                            R.drawable.multiple_003,
                            R.drawable.multiple_004,
                            R.drawable.multiple_005,
                    };
                    Bitmap b = BitmapFactory.decodeResource(getResources(), resArr[idx]);
                    int bitw = ((b.getWidth() + 7) / 8) * 8;
                    int bith = b.getHeight();
                    int pitch = bitw / 8;
                    CTPL.getInstance().append(new byte[]{
                            29, 118, 48, 0,
                            (byte) (pitch % 256), (byte) (pitch / 256),
                            (byte) (bith % 256), (byte) (bith / 256)
                    });

                    byte[] data = new byte[(bith * pitch)];
                    Arrays.fill(data, (byte) 0);

                    for (int y = 0; y < b.getHeight(); y++) {
                        for (int x = 0; x < b.getWidth(); x++) {
                            int pixel = b.getPixel(x, y);
                            int R = ((pixel & 0x00FF0000) >> 16);
                            int G = ((pixel & 0x0000FF00) >> 8);
                            int B = (pixel & 0x000000FF);
                            int gray = (int) (0.29900 * R + 0.58700 * G + 0.11400 * B);
                            if (gray < 150) {
                                data[y * pitch + x / 8] |= (0x80 >> (x % 8));
                            }
                        }
                    }
                    CTPL.getInstance().append(data);
                    CTPL.getInstance().execute();
                    insertItem(sendContainer, "ESC打印示例图片");
                    return true;
                });
                break;
            }
        }
    }

    public static boolean hasFilePermission(Context c) {
        boolean read = PackageManager.PERMISSION_GRANTED == c.checkPermission(
                Manifest.permission.READ_EXTERNAL_STORAGE, Process.myPid(), Process.myUid());
        boolean write = PackageManager.PERMISSION_GRANTED == c.checkPermission(
                Manifest.permission.WRITE_EXTERNAL_STORAGE, Process.myPid(), Process.myUid());
        return read && write;
    }

    public static Bitmap fitXYCropBitmap(Bitmap cache, int newWidth, int newHeight, Rect cropTargetRect) {
        int transferHeight = cropTargetRect == null ? cache.getHeight() : cropTargetRect.height();

        Bitmap bmp = Bitmap.createBitmap(newWidth, newHeight, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        c.drawColor(Color.WHITE);
        c.drawBitmap(cache,
                new Rect(0, 0, cache.getWidth(), cache.getHeight()),
                new Rect(0, 0, cache.getWidth(), transferHeight),
                null);
        return bmp;
    }


    private void showInputEditText(String def, @NonNull App.InputListener listener) {
        input.setText(def == null ? "" : def);
        mask.setVisibility(View.VISIBLE);
        InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);

        inputEnter.setOnClickListener(v -> {
            View focusView = getCurrentFocus();
            if (focusView == null || imm == null)
                return;

            if (!listener.onInputEnter(input.getText().toString()))
                return;

            imm.hideSoftInputFromWindow(focusView.getWindowToken(), InputMethodManager.HIDE_NOT_ALWAYS);
            mask.setVisibility(View.GONE);

        });
        input.requestFocus();
        imm.showSoftInput(getCurrentFocus(), 0);
    }

    private void insertItem(ViewGroup container, String text) {
        int dp48 = DensityUtil.dp2px(this, 48);

        TextView tv = (TextView) getLayoutInflater().inflate(R.layout.item_drawer_menu, null);
        tv.setText(text);
        tv.setTextColor(Color.BLACK);
        tv.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        tv.setMinHeight(dp48);
        container.addView(tv);

        if (container.getParent() instanceof NestedScrollView) {
            NestedScrollView parent = (NestedScrollView) container.getParent();
            parent.post(() -> parent.fullScroll(View.FOCUS_DOWN));
        }
    }
}
