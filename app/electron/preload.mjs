import { contextBridge, ipcRenderer } from 'electron';

let __isHost = false;

// Expose a tiny LAN API to the renderer
contextBridge.exposeInMainWorld('lan', {
  host: async (opts) => { const r = await ipcRenderer.invoke('lan:host', opts || {}); if (r && r.ok) __isHost = true; return r; },
  stop: async () => { try { const r = await ipcRenderer.invoke('lan:stop'); return r; } finally { __isHost = false; } },
  send: async (t, d) => ipcRenderer.invoke('lan:send', { t, d }),
  info: async () => ipcRenderer.invoke('lan:info'),
  state: async () => ipcRenderer.invoke('lan:state'),
  discover: {
    start: async () => ipcRenderer.invoke('lan:discover:start'),
    stop: async () => ipcRenderer.invoke('lan:discover:stop'),
     ping: async () => ipcRenderer.invoke('lan:discover:ping'),
  },
  // subscribe to server-side events (connections, chat, challenges)
  on: (event, listener) => {
    const ch = `lan:${event}`;
    const wrapped = (_, data) => listener(data);
    // For non-host clients, also listen for same-named CustomEvent fanned out by the WS client
    let winHandler;
    if (!__isHost) {
      winHandler = (ev) => { try { listener(ev?.detail); } catch {} };
      try { window.addEventListener(ch, winHandler); } catch {}
    }
    ipcRenderer.on(ch, wrapped);
    return () => { if (winHandler) { try { window.removeEventListener(ch, winHandler); } catch {} } ipcRenderer.off(ch, wrapped); };
    },
    assets: {
      listTrainers: async () => ipcRenderer.invoke('assets:list-trainers')
    },
    ps: {
      choose: async (roomId, side, choice) => ipcRenderer.invoke('ps:room:choose', { roomId, side, choice })
    },
    room: {
      buffer: async (roomId) => ipcRenderer.invoke('lan:room:buffer', { roomId })
    }
});

// Expose updater controls
// Note: updater API temporarily removed while we rework update flow
