package com.ctaiot.ctprinter.ctpl_demo;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * @Author Jaco
 * @Date 2024/7/1
 * @Desc
 */
public class MainActivity extends AppCompatActivity {

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);


        findViewById(R.id.tv_funcition).setOnClickListener(v -> {
            if(checkError())
                return;
            startActivity(new Intent(this, FunctionActivity.class));
        });
        findViewById(R.id.tv_upgrade).setOnClickListener(v -> {
            if(checkError())
                return;
            startActivity(new Intent(this, UpgradeActivity.class));
        });
        try {
            File f = new File(getExternalCacheDir(),"test.txt");
            FileOutputStream fos = new FileOutputStream(f);
            fos.write("TEST".getBytes(StandardCharsets.UTF_8));
            fos.flush();
            fos.close();
        } catch (Exception e) {
        }
    }

    private boolean checkError(){
        if(BluetoothAdapter.getDefaultAdapter() == null || !BluetoothAdapter.getDefaultAdapter().isEnabled()){
            Toast.makeText(this, "蓝牙功能未开启", Toast.LENGTH_SHORT).show();
            return true;
        }

        if (!App.getInstance().checkBLEPermission() || !App.getInstance().checkSPPPermission()) {
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
            Toast.makeText(this, "蓝牙权限未开启", Toast.LENGTH_SHORT).show();
            return true;
        }
        return false;
    }

}
