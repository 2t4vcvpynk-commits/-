// WebAudio で効果音を合成（音声ファイル不要）
let ctx = null;
let noiseBuf = null;
let master = null;

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function noise(dur, freq, q, vol, type = 'lowpass') {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur);
}

function tone(f0, f1, dur, vol, type = 'sine') {
  const o = ctx.createOscillator();
  o.type = type;
  const g = ctx.createGain();
  const t = ctx.currentTime;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur);
}

export function sfx(name) {
  if (!ctx || ctx.state !== 'running') return;
  switch (name) {
    case 'whoosh': noise(0.12, 1800, 0.8, 0.15, 'bandpass'); break;
    case 'hit': noise(0.12, 1400, 1, 0.8); tone(180, 60, 0.12, 0.5); break;
    case 'heavy': noise(0.25, 900, 1, 1); tone(140, 40, 0.25, 0.8, 'triangle'); break;
    case 'block': noise(0.08, 3000, 3, 0.4, 'bandpass'); tone(900, 600, 0.06, 0.15, 'square'); break;
    case 'fire': tone(300, 900, 0.3, 0.25, 'sawtooth'); noise(0.4, 600, 1, 0.3); break;
    case 'ko': tone(220, 40, 0.9, 0.6, 'sawtooth'); noise(0.8, 500, 1, 0.8); break;
    case 'round': tone(660, 660, 0.15, 0.25, 'square'); break;
    case 'fight': tone(880, 1320, 0.3, 0.3, 'square'); break;
    case 'jump': tone(300, 500, 0.1, 0.12, 'triangle'); break;
    case 'land': noise(0.08, 400, 1, 0.3); break;
    case 'denied': tone(200, 160, 0.08, 0.15, 'square'); break;
    case 'accel': tone(400, 1600, 0.35, 0.2, 'sawtooth'); break;
    case 'armor': tone(120, 90, 0.4, 0.4, 'square'); noise(0.2, 3000, 4, 0.3, 'bandpass'); break;
    case 'buff': tone(500, 900, 0.25, 0.2, 'triangle'); break;
    case 'heal': tone(660, 990, 0.2, 0.2, 'sine'); tone(880, 1320, 0.35, 0.15, 'sine'); break;
    case 'charge': tone(150, 900, 0.7, 0.25, 'sawtooth'); break;
    case 'beam': noise(1.3, 700, 1, 0.9); tone(90, 60, 1.3, 0.6, 'sawtooth'); break;
    case 'wave': noise(0.5, 300, 1, 1); tone(80, 30, 0.5, 0.8, 'triangle'); break;
    case 'blink': tone(1500, 300, 0.15, 0.2, 'sine'); break;
    case 'stop': tone(1200, 60, 1.0, 0.45, 'sine'); noise(0.6, 200, 1, 0.5); break;
    case 'resume': tone(60, 1200, 0.6, 0.35, 'sine'); break;
  }
}
