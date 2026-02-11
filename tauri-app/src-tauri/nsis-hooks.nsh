; PokeTTRPG NSIS installer hooks
; Clears stale WebView2 cache on upgrade so new JS/CSS assets are loaded cleanly.
; This preserves localStorage, IndexedDB, and cookies (user data stays intact).

!macro NSIS_HOOK_PREINSTALL
  ; Clear WebView2 compiled bytecode and HTTP caches
  ; These cause breakage when upgrading because the old cached JS
  ; bytecode is served instead of the new version's assets.
  RMDir /r "$LOCALAPPDATA\com.pokettrpg.desktop\EBWebView\Default\Cache"
  RMDir /r "$LOCALAPPDATA\com.pokettrpg.desktop\EBWebView\Default\Code Cache"
  RMDir /r "$LOCALAPPDATA\com.pokettrpg.desktop\EBWebView\Default\GPUCache"
  RMDir /r "$LOCALAPPDATA\com.pokettrpg.desktop\EBWebView\Default\Service Worker"
!macroend
