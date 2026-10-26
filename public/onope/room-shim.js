// ワンオペ食堂: claude.ai の room 機能と同じ形の API を WebSocket 中継サーバーで提供する
(() => {
  const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/onope-ws`;

  function join(name) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      const topics = new Map();
      const peerCbs = [];
      let me = null;
      let peers = [];
      let closed = false;

      const firePeers = () => {
        const ch = { peers: peers.map((p) => ({ peer: p.peer, presence: p.presence, sameTab: p.peer === me })) };
        peerCbs.forEach((cb) => { try { cb(ch); } catch (e) { console.error(e); } });
      };
      const send = (msg) => {
        if (ws.readyState !== WebSocket.OPEN) return Promise.reject(Object.assign(new Error('closed'), { code: 'closed' }));
        ws.send(JSON.stringify(msg));
        return Promise.resolve();
      };

      const room = {
        presence: (data) => send({ t: 'presence', data }),
        emit: (topic, data) => send({ t: 'emit', topic, data }),
        on(topic, cb) {
          if (!topics.has(topic)) topics.set(topic, []);
          topics.get(topic).push(cb);
          return () => { const a = topics.get(topic); a.splice(a.indexOf(cb), 1); };
        },
        onPeers(cb) {
          peerCbs.push(cb);
          if (me) cb({ peers: peers.map((p) => ({ ...p, sameTab: p.peer === me })) });
          return () => peerCbs.splice(peerCbs.indexOf(cb), 1);
        },
        leave() { closed = true; ws.close(); return Promise.resolve(); },
      };

      ws.onopen = () => ws.send(JSON.stringify({ t: 'join', room: name }));
      ws.onerror = () => { if (!me) reject(Object.assign(new Error('connect'), { code: 'connect' })); };
      ws.onclose = () => {
        if (!me) { reject(Object.assign(new Error('connect'), { code: 'connect' })); return; }
        // 切断されたら自分だけ残った扱いにして、ゲーム側の退出処理に任せる
        if (!closed) { peers = peers.filter((p) => p.peer === me); firePeers(); }
      };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'joined') { me = m.id; resolve(room); }
        else if (m.t === 'full') { reject(Object.assign(new Error('full'), { code: '満員' })); ws.close(); }
        else if (m.t === 'peers') { peers = m.peers; firePeers(); }
        else if (m.t === 'msg') {
          (topics.get(m.topic) || []).forEach((cb) => {
            try { cb({ peer: m.peer, sameTab: m.peer === me, data: m.data }); } catch (e) { console.error(e); }
          });
        }
      };
    });
  }

  const api = { join };
  window.claude = window.claude || {};
  window.claude.use = (cap) => (cap === 'room' ? Promise.resolve(api) : Promise.reject(new Error('unsupported')));
})();
