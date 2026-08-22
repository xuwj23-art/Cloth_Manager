# 本地打包 + 局域网下载 —— 标准工作流（Windows）

> 这是我们**已跑通并固定下来**的更新方式：本地用 Gradle 打 APK（不排队），再用局域网链接让手机下载安装。
> 项目路径：`E:\Project\cloth_scan`。
> 本机环境已配好，日常更新只看 **第 3、4 节** 即可。

---

## 0. 三种更新方式怎么选（重要）

| 改动类型                                           | 用什么                                   | 耗时            | 要重装吗              |
| -------------------------------------------------- | ---------------------------------------- | --------------- | --------------------- |
| **JS / 界面 / 业务逻辑**（占绝大多数）             | `eas update`（OTA 热更新）               | 几十秒          | 否，手机重开 App 即可 |
| **原生改动**（权限、插件、原生模块、targetSdk 等） | 本地 `pnpm build:android` + 局域网下载   | 增量约 1–2 分钟 | 是，需重新下载安装    |
| 需要 Expo 云端签名/分发（备用）                    | `eas build -p android --profile preview` | 要排队          | 是                    |

**结论**：平时改 JS 走 OTA；只有动了原生才本地打包。本文档讲的就是“原生改动 → 本地打包 → 局域网装机”。

> ⚠️ **OTA 能生效的前提：APK 必须嵌入了 `preview` 频道。**
> 本地 `gradlew` 打的包默认**不带频道**，会导致 `eas update --channel preview` 永远收不到（表现：关掉重开 App 仍是旧界面）。
> 已修复：`app.json` 的 `updates.requestHeaders` 写死了 `{"expo-channel-name":"preview"}`。**改了这个配置后，必须 `npx expo prebuild -p android --no-install` 再打包**，频道才会写进 `AndroidManifest.xml`。验证：
>
> ```powershell
> Select-String -Path android\app\src\main\AndroidManifest.xml -Pattern "expo-channel-name"
> ```
>
> 看到 `{"expo-channel-name":"preview"}` 即 OK。装上这个包后，以后的 JS 改动才能真正靠 OTA 更新。

---

## 1. 一次性环境（本机已完成，存档备查）

- Android Studio 自带 SDK：`C:\Users\a1508\AppData\Local\Android\Sdk`
- 自带 JDK：`D:\APP\Android Studio\jbr`
- 环境变量：`ANDROID_HOME`、`JAVA_HOME` 已设
- 已安装 SDK 组件：
  - Platform **android-36**、Build-Tools 36.x
  - **NDK 27.1.12297006**（新架构编译 C++ 必需，约 2.2GB）
  - **CMake 3.22.1**（新架构编译必需）

> 重装环境时补 NDK/CMake 的命令：
>
> ```powershell
> & "$env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat" "ndk;27.1.12297006" "cmake;3.22.1"
> ```

---

## 2. 关键修复：monorepo 打包入口问题（已固化，勿删）

Expo SDK54 + pnpm monorepo + Windows，在 `release` 打包时会把入口 `./index.ts` 误指到仓库根目录，报：

```
Unable to resolve module ./index.ts from E:\Project\cloth_scan/.
```

**修复**：`apps/mobile/.env` 里写了一行（让 Metro 的 server root 固定为 app 目录）：

```
EXPO_NO_METRO_WORKSPACE_ROOT=1
```

> 这个 `.env` 已在本机，`expo` 打包时会自动加载，**不需要手动设任何环境变量**。`.env` 被 git 忽略，换机器需重建此文件。

---

## 3. 打包（每次原生更新照做）

```powershell
cd E:\Project\cloth_scan\apps\mobile
pnpm build:android
```

等价于 `cd android; .\gradlew.bat assembleRelease`。

产物 APK：

```
E:\Project\cloth_scan\apps\mobile\android\app\build\outputs\apk\release\app-release.apk
```

> 第一次打包久（下依赖 + 编译 C++，约 10–40 分钟）；之后增量 **1–2 分钟**。
> 那些 `Connection timed out`(校验 SDK 清单) 的红字可忽略，不影响结果。

---

## 4. 局域网下载安装（每次照做）

1. 把新 APK 复制到下载目录（纯英文名，避免手机端乱码）：

```powershell
Copy-Item "E:\Project\cloth_scan\apps\mobile\android\app\build\outputs\apk\release\app-release.apk" "E:\Project\cloth_scan\_dist\app.apk" -Force
```

2. 在下载目录起一个临时下载服务器：

```powershell
cd E:\Project\cloth_scan\_dist
python -m http.server 8000 --bind 0.0.0.0
```

3. 查本机局域网 IP（找“以太网/WLAN”那条 192.168.x.x）：

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like "192.168.*" } | Select IPAddress, InterfaceAlias
```

4. **手机连同一个 WiFi/路由器**，浏览器打开（IP 换成上一步的）：

```
http://192.168.124.16:8000/app.apk
```

5. 下载后安装。装完 `Ctrl+C` 关掉下载服务器即可。

> **手机打不开网址** = 多半 Windows 防火墙拦了 Python。第一次弹“是否允许”点允许；或临时放行 8000 端口。

---

## 5. 关于签名（第一次切到本地版要注意）

本地 release 包用的是 **debug 签名**，与 Expo 云端（EAS）签名**不同**：

- 从 **EAS 版** 换到 **本地版**：必须**先卸载**手机上旧 App 再装（签名不一致无法覆盖）。
- 之后**本地版之间**签名一致，可直接覆盖安装，数据不丢。
- 不要随意 `expo prebuild --clean`（会重生成 debug.keystore，导致又要卸载重装）。

---

## 6. 标准更新流程速记

```powershell
# A. 只改了 JS：热更新，不打包
cd E:\Project\cloth_scan\apps\mobile
eas update --channel preview -m "本次改动说明"

# B. 改了原生：本地打包 + 局域网装机
cd E:\Project\cloth_scan\apps\mobile
pnpm build:android
Copy-Item ".\android\app\build\outputs\apk\release\app-release.apk" "E:\Project\cloth_scan\_dist\app.apk" -Force
cd E:\Project\cloth_scan\_dist
python -m http.server 8000 --bind 0.0.0.0
#   手机浏览器打开 http://<本机IP>:8000/app.apk 下载安装
```

---

## 7. 通过服务器下载页对外分发（推荐，给别人装）

局域网下载只适合自己人、同一 WiFi。要让别人（异地店员等）随时下载，把 APK 挂到阿里云服务器，浏览器打开下载页即可。内存/硬盘几乎无负担（静态文件流式发送，每次下载只占几十 KB 内存）。

**一次性：服务器目录已由 `docker-compose.prod.yml` 绑定挂载**

```
服务器主机目录  ./apk/        →  容器内 /app/apps/server/download
```

即仓库根目录下的 `apk/` 文件夹。`git pull` 拿到新版后 `docker compose -f docker-compose.prod.yml up -d --build` 一次即可。

**一次性：配置 SSH 免密，让本机 scp 能直传（重要）**

服务器（阿里云）默认**只认密钥登录、关闭 root 密码直连**，所以即使你能用网页 Workbench 登录，本机 `scp` 仍会报 `Permission denied (publickey)`。解决：把本机公钥加到服务器一次，之后 scp 永久免密。

1. 本机 PowerShell 生成无密码短语密钥（已有 `~/.ssh/id_ed25519` 可跳过）。**注意 PowerShell 下 `-N ""` 的空密码常被解析错**，用 `cmd /c` 最稳：

```powershell
cmd /c 'ssh-keygen -q -t ed25519 -f "%USERPROFILE%\.ssh\id_ed25519" -N "" -C cloth_scan_deploy'
Get-Content "$env:USERPROFILE\.ssh\id_ed25519.pub"   # 复制这一行公钥
```

2. 在**服务器**（Workbench 网页窗口，`root@iZ...#`）把上面那行公钥加进去（把 `粘贴公钥` 换成实际内容）：

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "粘贴公钥" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
mkdir -p /opt/Cloth_Manager/apk
```

3. 之后本机 scp 不再要密码。（公钥可公开粘贴；私钥只在本机，勿外传。）

**每次更新（本地打好包后）**

APK 采用**多版本留存**：每个版本用带版本号的文件名上传，下载页 `/download` 会列出全部版本可选下载，`/download/app.apk` 固定链接永远指向「当前生效版本」。

1. 把 APK 传到服务器。**⚠️ 这条要在「你自己的 Windows 电脑」的 PowerShell 里运行，不是在 SSH 连进服务器的那个窗口里**（因为 APK 在你电脑的 `E:` 盘）。提示符是 `PS E:\...>` 才对；`root@iZ...#` 是服务器，跑这条会失败。

```powershell
# 注意目标文件名带版本号（与 app.json 的 version 保持一致），如 1.2.1：
scp "E:\Project\cloth_scan\apps\mobile\android\app\build\outputs\apk\release\app-release.apk" root@39.108.186.58:/opt/Cloth_Manager/apk/app-1.2.1.apk
```

> 目标格式是 `root@公网IP:路径`——**不要**写成 `root@http://...` 或加 `:3000`（那是 App 的 HTTP 端口，跟 scp/SSH 的 22 端口无关）。
> 若提示目录不存在，先在服务器上 `mkdir -p /opt/Cloth_Manager/apk`。

2. （可选，推荐）在服务器上写 `current.json`，指定生效版本与更新说明（下载页会显示）：

```bash
cat > /opt/Cloth_Manager/apk/current.json <<'EOF'
{
  "active": "app-1.2.1.apk",
  "notes": { "app-1.2.1.apk": "修复扫码/离线登录/重复删单", "app-1.2.0.apk": "试运行首发版" }
}
EOF
```

> 不写 `current.json` 或不写 `active`：自动把**版本号最高**的包当生效版本。
> **回滚**：把 `active` 改回旧版本文件名即可，`/download/app.apk` 与下载页大按钮立即切回旧版。

3. 别人访问下载页（带二维码 + 下载按钮 + 安装说明 + 全部版本列表）。本项目的固定地址：

```
http://39.108.186.58:3000/download
```

> `39.108.186.58` 是阿里云服务器的**公网 IP**（App 里 `apps/mobile/src/config.ts` 的 `API_HOST` 也用它）。
> 别用私网 IP（`10.x` / `172.16~31.x` / `192.168.x` 开头的都是私有，外网打不开）。
> 前提：阿里云**安全组**已放行 `3000/tcp`（App 能正常连服务器即说明已放行）。

> - 每个版本的包都留在服务器上（约 60–80MB/个），下载页可任选版本安装，出问题可装回旧版。
> - 旧式的覆盖式 `app.apk` 仍兼容：目录里没有 `app-x.y.z.apk` 时它就是生效版本。
> - 下载快慢取决于服务器公网带宽（入门带宽 1–3Mbps，60MB 约 2–8 分钟），不影响服务器稳定。
> - 从「云端 EAS 版」换到「本地版」需先卸载旧 App（签名不同）；本地版之间可直接覆盖。

### scp 上传排错速查

| 报错 / 现象                                     | 原因                                   | 解决                                           |
| ----------------------------------------------- | -------------------------------------- | ---------------------------------------------- |
| `ssh: Could not resolve hostname http`          | 目标写成了 `root@http://...`           | 去掉 `http://`，只留 `root@39.108.186.58:路径` |
| 目标里带了 `:3000` 连不上                       | 把 App 的 HTTP 端口当成了 SSH 端口     | scp/SSH 走 22，不要写 `:3000`                  |
| 在 `root@iZ...#` 下跑 scp 失败、找不到 `E:\...` | **跑在服务器上了**；服务器没有 `E:` 盘 | 到本机 PowerShell（`PS E:\...>`）再跑          |
| `Permission denied (publickey)`                 | 服务器只认密钥、没配本机公钥           | 按上面「配置 SSH 免密」加公钥                  |
| 仍提示输入 passphrase                           | 密钥生成时带了密码短语                 | 用 `cmd /c '...-N ""'` 重新生成无密码密钥      |

---

有任何一步卡住，把命令和报错原样发我即可。
