# 本地打包环境部署指南（Windows · 0 基础保姆级）

> 目的：在你自己电脑上把 App 打成安卓 APK，**不用排队等云构建**。
> 适用：Windows 10/11 + 本项目（`e:\Project\cloth_scan`）。
> 预计耗时：第一次装环境约 **40~90 分钟**（主要在下载）；装好后每次打包只要几分钟。

---

## 0. 先搞清楚：本地打包能产出两种东西

| 产物 | 命令 | 特点 | 用在哪 |
|---|---|---|---|
| **调试版**（debug） | `npx expo run:android` | 装到**数据线连着的手机**上，**需要电脑开着 Metro**，改 JS 秒级生效 | 我俩一起调界面/标签时 |
| **独立版 APK**（release） | `npx expo run:android --variant release` | JS 全打包进去，**不用电脑、装一次随便用**，可拷给别的手机装 | 店里日常用、测打印机 |

两种都**自带蓝牙打印模块**（云构建也是），打印机到货后都能测。

> 提醒：本地打的 release 包用的是"调试签名"，**自用/试运行完全没问题**，但不能上架应用商店（你也不打算上架，无所谓）。

---

## 1. 安装 Android Studio（含 SDK 和 JDK，一次搞定）

1. 打开下载页：<https://developer.android.com/studio>
2. 点 **Download Android Studio**，勾选同意，下载 `.exe`（约 1GB+）。
3. 双击安装，**一路 Next 用默认值**即可：
   - Install Type 选 **Standard**。
   - 它会自动下载 Android SDK、平台工具、和**内置 JDK**（省得你单独装 Java）。
4. 安装结束后**先打开一次** Android Studio，等它把初始组件下载完（看到欢迎界面即可）。

> Android Studio 自带的 JDK 在：`C:\Program Files\Android\Android Studio\jbr`
> SDK 默认装在：`C:\Users\a1508\AppData\Local\Android\Sdk`

---

## 2. 用 SDK Manager 确认/补齐组件

在 Android Studio 欢迎界面：右上角 **More Actions ▸ SDK Manager**（或菜单 `Settings ▸ Languages & Frameworks ▸ Android SDK`）。

### SDK Platforms 标签页
- 勾选 **Android 15.0 (API 35)**（本项目用的是 API 35）。

### SDK Tools 标签页（点右下角 "Show Package Details" 可看版本）
确保下面这些已勾选（已装会显示 Installed）：
- ☑ **Android SDK Build-Tools**（最新即可）
- ☑ **Android SDK Platform-Tools**
- ☑ **Android SDK Command-line Tools (latest)**

点 **Apply ▸ OK**，等它下载安装完。

---

## 3. 配置环境变量（关键一步）

让命令行能找到 SDK 和 Java。两种方式，**任选其一**。

### 方式 A：图形界面（推荐 0 基础）
1. 按 `Win` 键搜索"**编辑系统环境变量**"，打开 ▸ 点"**环境变量(N)…**"。
2. 在**上半区"用户变量"**点"**新建(N)…**"，加两条：
   - 变量名 `ANDROID_HOME`，变量值 `C:\Users\a1508\AppData\Local\Android\Sdk`
   - 变量名 `JAVA_HOME`，变量值 `C:\Program Files\Android\Android Studio\jbr`
3. 在"用户变量"里找到 **`Path`** ▸ 双击 ▸ "新建" ▸ 加这一行：
   - `%ANDROID_HOME%\platform-tools`
4. 一路"确定"保存。

### 方式 B：PowerShell 命令（快，但 Path 要小心）
打开 PowerShell，前两条安全：
```powershell
setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
setx JAVA_HOME "C:\Program Files\Android\Android Studio\jbr"
```
Path 建议还是用**方式 A 的图形界面**手动加 `%ANDROID_HOME%\platform-tools`（用 setx 改 Path 容易把原有内容覆盖，风险大）。

> ⚠️ 改完环境变量后，**必须关掉所有终端（含 Cursor 里的终端）重新打开**才会生效。

---

## 4. 验证环境（照着敲，逐条核对）

**重开一个 PowerShell**，依次运行：

```powershell
java -version
```
期望：显示 `openjdk version "17.x"`（17 即可）。

```powershell
adb --version
```
期望：显示 `Android Debug Bridge version ...`（说明 platform-tools 在 PATH 里了）。

```powershell
echo $env:ANDROID_HOME
```
期望：打印出 `C:\Users\a1508\AppData\Local\Android\Sdk`。

> 任意一条不对：回到第 3 步检查变量拼写，并确认**重开了终端**。

---

## 5. 准备一台安卓手机（用于安装/调试）

1. 手机进入 **设置 ▸ 关于手机**，连续点 **版本号** 7 次，开启"开发者模式"。
2. 进 **设置 ▸ 系统 ▸ 开发者选项**，打开 **USB 调试**。
3. 数据线连接手机和电脑，手机弹"是否允许 USB 调试"选 **允许**。
4. 在电脑验证已识别：
```powershell
adb devices
```
期望：列出一行设备号 + `device`（不是 `unauthorized`）。

> 没有数据线 / 不想连手机也行：可以只打 release APK（第 7 步），把 APK 文件拷到手机里点击安装。

---

## 6. 第一次本地打包：调试版（连手机、秒改）

在项目里运行：

```powershell
cd e:\Project\cloth_scan\apps\mobile
npx expo run:android
```

第一次会比较久（几分钟到十几分钟），它会自动做这些事：
- `prebuild` 生成 `android\` 原生工程（已自动接入蓝牙打印模块）
- 用 Gradle 编译
- 安装到你连着的手机
- 启动 Metro，App 打开后改 JS 立即热更新

> 如果中途提示 **接受 SDK 许可**，运行一次：
> ```powershell
> & "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat" --licenses
> ```
> 一路按 `y` 回车同意。

---

## 7. 出"独立版 APK"（不用电脑、能拷给别的手机）

```powershell
cd e:\Project\cloth_scan\apps\mobile
npx expo run:android --variant release
```

打完后 APK 文件在：

```
e:\Project\cloth_scan\apps\mobile\android\app\build\outputs\apk\release\app-release.apk
```

把这个 `app-release.apk` 拷到任意安卓手机点击安装即可（首次装允许"未知来源"）。

> 想只打包、不自动装手机，也可以直接用 Gradle：
> ```powershell
> cd e:\Project\cloth_scan\apps\mobile\android
> .\gradlew assembleRelease
> ```

---

## 8. 常见报错排查

| 报错 | 原因 / 解决 |
|---|---|
| `'adb' 不是内部或外部命令` | Path 没加 `platform-tools`，或没重开终端（第 3、4 步） |
| `JAVA_HOME is not set` / Java 版本不对 | `JAVA_HOME` 没设或指错；应指向 `...\Android Studio\jbr`（第 3 步） |
| `Failed to install ... INSTALL_FAILED` / 设备 `unauthorized` | 手机没允许 USB 调试，重插数据线点"允许"（第 5 步） |
| `License ... not accepted` | 运行 `sdkmanager --licenses` 全部同意（第 6 步注） |
| Gradle 第一次卡很久 | 正常，在下载依赖；保持联网耐心等，别中断 |
| 端口/Metro 冲突 | 关掉多余的 Metro 终端再跑 |

> 卡住时把**完整报错**截图发我，我帮你定位。

---

## 9. 本地打包 vs 云构建 vs OTA —— 怎么选

| 场景 | 用什么 | 速度 |
|---|---|---|
| 改了 **JS**（界面/标签/价格/修 bug，占 95%） | `eas update --channel preview`（OTA 热更新） | 秒级，手机重开即更新，**最优先** |
| 改了 **原生**（蓝牙模块/权限/加原生库） | 本地 `npx expo run:android --variant release` | 几分钟，不排队 |
| 想要 Expo 云端帮你签名/分发 | `eas build -p android --profile preview` | 要排队（免费版） |

**结论**：日常走 OTA；要重打原生包时用本地打包（不排队）；云构建留作备用。

---

## 10. 每次本地更新的标准流程（存着照做）

```powershell
# 1) 拉最新代码改动后
cd e:\Project\cloth_scan\apps\mobile

# 2) 只改了 JS：直接热更新（不用重打包）
eas update --channel preview -m "本次说明"

# 3) 改了原生：本地重打独立 APK
npx expo run:android --variant release
#   产物：android\app\build\outputs\apk\release\app-release.apk
```

---

有任何一步卡住，把命令和报错原样发我即可。
