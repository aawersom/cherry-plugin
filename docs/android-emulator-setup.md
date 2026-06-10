# Cherry — Android TV (Google TV) эмулятор-стенд, управляемый КОДОМ

Достоверный device-стенд для диагностики Android-багов (pornhub-буфер, porntrex и пр.):
**настоящий Android TV OS + нативный WebView/ExoPlayer/HTTP + домашний IP**, и при этом
**полный код-контроль через CDP** (как Playwright, но внутри реального приложения Lampa) +
`logcat`. Без скриншотов и без пульта.

## Что установлено (портативно, без админ-прав, в `D:\Android`)
- JDK 17 (Microsoft OpenJDK, unzip) + Android cmdline-tools + build-tools 34.
- Эмулятор + образ `system-images;android-34;android-tv;x86` (AOSP TV; google-tv-образ тоже
  стоит, но он production → без нужного нам доступа).
- AVD `cherryRoot` (TV-1080p).
- **Lampa, пересобранная как debuggable** (`lampa_dbg.apk`): apktool decode → манифест
  `android:debuggable="true"` → rebuild → zipalign → apksigner (debug keystore). Поведение
  плеера/сети/WebView идентично релизу — достоверность сохранена, но открывается `run-as` + WebView CDP.

## Запуск стенда
```powershell
$adb="D:\Android\Sdk\platform-tools\adb.exe"; $emu="D:\Android\Sdk\emulator\emulator.exe"
$env:ANDROID_HOME="D:\Android\Sdk"; $env:ANDROID_SDK_ROOT="D:\Android\Sdk"
# 1. поднять эмулятор (host GPU = быстро; инспекция через CDP, не screencap)
Start-Process $emu -ArgumentList "-avd","cherryRoot","-gpu","host","-no-snapshot","-no-audio"
# 2. включить WebView remote-debugging для всех WebView (shell-uid пишет в /data/local/tmp)
& $adb shell "echo '_ --remote-debugging-port=9229 --remote-allow-origins=*' > /data/local/tmp/webview-command-line"
# 3. запустить Lampa (URL http://lampa.mx грузится в WebView Chrome 113)
& $adb shell monkey -p top.rootu.lampa -c android.intent.category.LAUNCHER 1
#    первый раз: нативный диалог "enter URL" → SAVE (кнопка bounds из uiautomator: tap 1372 461)
# 4. проброс порта на WebView-страницу
$pid=(& $adb shell pidof top.rootu.lampa).Trim()
& $adb forward tcp:9229 localabstract:webview_devtools_remote_$pid
```

## Управление КОДОМ — `test/tv-cdp.mjs` (сырой CDP по WebSocket)
Playwright `connectOverCDP` НЕ работает с Android-WebView (нет Browser-домена) → используем
сырой CDP (`Runtime.evaluate`) через встроенный `WebSocket` Node 24.
```bash
node test/tv-cdp.mjs inspect           # состояние страницы Lampa (url/меню/фокус/cards)
node test/tv-cdp.mjs inject            # инжект локального plugin.js → Cherry в меню
node test/tv-cdp.mjs eval "<js>"       # выполнить JS в реальном приложении (читать DOM, push активности)
```
`_isAndroid()` в этом WebView = **true** → выполняется реальная Android-ветка плагина
(force-proxy, native-fetch через `Lampa.Reguest.native`, raw-стримы) с домашним IP.

## logcat (главный канал для pornhub)
```powershell
& $adb logcat -c; <играть видео>; & $adb logcat -d | Select-String "ExoPlayer|MediaCodec|chromium|net::|http|token|403|410|Source"
```

## Применение
- **porntrex**: прочитать карточки категории кодом (`document.querySelectorAll('.card')`) → проверить, что
  названия на месте (баг был «добавить в избранное» вместо названия), + воспроизведение.
- **pornhub**: запустить плеер → `logcat` покажет точную ошибку (мастер/вариант/сегмент, токен, IP) —
  то, чего нельзя увидеть с дев-машины. Закрывает BL-PORNHUB-STREAM не вслепую.
