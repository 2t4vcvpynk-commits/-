// WebSocket 接続
export class Net {
  constructor() {
    this.ws = null;
    this.ping = null;
    this.onMessage = () => {};
    this.onClose = () => {};
    this.pingTimer = 0;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        this.pingTimer = setInterval(() => this.send({ t: 'ping', t0: performance.now() }), 2000);
        resolve();
      };
      ws.onerror = () => {
        if (!opened) reject(new Error('サーバーに接続できませんでした'));
      };
      ws.onclose = () => {
        clearInterval(this.pingTimer);
        if (opened) this.onClose();
      };
      ws.onmessage = (e) => {
        let m;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        if (m.t === 'pong') this.ping = performance.now() - m.t0;
        this.onMessage(m);
      };
    });
  }

  send(m) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close() {
    clearInterval(this.pingTimer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
}
