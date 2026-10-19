// Procedural soundscape, synthesised with Web Audio so the page still needs no asset files:
//   ocean  — waves breaking on the beach and hissing back over the sand, timed to the swell
//            period, low rumble, wind noise and the odd seagull; all follow P
//   music  — 'pad': slow ambient chords with soft bells, 'file': a local file the user picks
// Browsers only allow audio after a user gesture, so setOn(true) must come from one.
export function createSoundscape(P) {
  const S = { on: false, ocean: 0.9, music: 0.35, mode: 'pad' };   // mode: off | pad | file
  let ac = null, master, oceanBus, musicBus, waveGain, waveFilter, wavePan, washGain, windGain, windFilter, rumbleGain;
  let waveTimer = 0, gullTimer = 0, padTimer = 0, bellTimer = 0, offTimer = 0, chord = 0, fileEl = null, fileSrc = null;

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  function noise(sec, brown) {
    const buf = ac.createBuffer(2, ac.sampleRate * sec, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        if (brown) { b = (b + 0.02 * w) / 1.02; d[i] = b * 3.5; } else d[i] = w;
      }
    }
    const src = ac.createBufferSource();
    src.buffer = buf; src.loop = true; src.start();
    return src;
  }
  function wire(first, ...rest) {
    let cur = first;
    for (const n of rest) { cur.connect(n); cur = n; }
  }
  function gainNode(v) { const g = ac.createGain(); g.gain.value = v; return g; }
  function filter(type, freq, q) {
    const f = ac.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    return f;
  }

  function build() {
    ac = new AudioContext();
    master = gainNode(0); master.connect(ac.destination);
    oceanBus = gainNode(S.ocean); oceanBus.connect(master);
    musicBus = gainNode(S.music); musicBus.connect(master);
    // a soft echo gives the music some space without a convolution reverb
    const echo = ac.createDelay(1), fb = gainNode(0.38), damp = filter('lowpass', 1800, 0.5);
    musicBus.connect(echo); echo.delayTime.value = 0.43;
    wire(echo, damp, fb, echo); damp.connect(master);

    const white = noise(4, false), brown = noise(4, true);
    waveFilter = filter('lowpass', 400, 0.3); waveGain = gainNode(0); wavePan = ac.createStereoPanner();
    wire(white, waveFilter, waveGain, wavePan, oceanBus);
    // the thin hiss of water running back down the sand after each wave
    washGain = gainNode(0);
    wire(white, filter('highpass', 2200, 0.4), washGain, wavePan);
    windFilter = filter('bandpass', 500, 0.6); windGain = gainNode(0);
    wire(white, windFilter, windGain, oceanBus);
    rumbleGain = gainNode(0);
    wire(brown, filter('lowpass', 260, 0.5), rumbleGain, oceanBus);
  }

  // One wave reaching the beach: the roar builds and brightens as it breaks, then the
  // backwash hisses down the sand while the roar settles.
  function wave() {
    const t = ac.currentTime;
    const period = Math.sqrt(2 * Math.PI * P.swellLength / 9.81);            // deep-water swell period
    const amp = clamp01(0.2 + 0.12 * P.swellHs + 0.03 * P.windSpeed) * rnd(0.65, 1.0);
    const rise = period * rnd(0.3, 0.45), fall = period * rnd(0.5, 0.8);
    waveGain.gain.setTargetAtTime(amp * 1.6, t, rise / 3);
    waveGain.gain.setTargetAtTime(amp * 0.25, t + rise, fall / 3);
    waveFilter.frequency.setTargetAtTime(900 + 80 * P.windSpeed * amp, t, rise / 3);
    waveFilter.frequency.setTargetAtTime(340, t + rise, fall / 3);
    washGain.gain.setTargetAtTime(0, t, 0.3);
    washGain.gain.setTargetAtTime(amp * 0.22, t + rise * 1.1, 0.4);
    washGain.gain.setTargetAtTime(0, t + rise * 1.1 + fall * 0.5, fall / 4);
    wavePan.pan.setTargetAtTime(rnd(-0.5, 0.5), t, period / 3);
    // wind and rumble only need to follow the sliders, so they ride along with the waves
    windGain.gain.setTargetAtTime(Math.min(0.35, 0.0016 * P.windSpeed * P.windSpeed) * rnd(0.6, 1.2), t, 1.5);
    windFilter.frequency.setTargetAtTime((300 + 45 * P.windSpeed) * rnd(0.8, 1.25), t, 2);
    rumbleGain.gain.setTargetAtTime(0.06 + 0.03 * P.swellHs, t, 2);
    waveTimer = setTimeout(wave, period * rnd(0.55, 0.95) * 1000);
  }

  // A seagull a little way off: a few falling "kee-ow" calls, each a buzzy sawtooth through
  // two vocal-tract-like resonances.
  function gull() {
    const calls = 2 + Math.floor(Math.random() * 4), pan = ac.createStereoPanner(), out = gainNode(rnd(0.08, 0.16));
    pan.pan.value = rnd(-0.8, 0.8);
    wire(out, pan, oceanBus);
    let t = ac.currentTime + 0.05;
    const f0 = rnd(1300, 1700);
    for (let i = 0; i < calls; i++) {
      const len = rnd(0.22, 0.4), f = f0 * (1 - 0.05 * i);
      const o = ac.createOscillator(), env = gainNode(0);
      const b1 = filter('bandpass', 1900, 4), b2 = filter('bandpass', 3400, 5);
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.85, t);
      o.frequency.linearRampToValueAtTime(f * 1.12, t + len * 0.25);
      o.frequency.exponentialRampToValueAtTime(f * 0.62, t + len);
      wire(o, b1, env, out); wire(o, b2, env);
      env.gain.setTargetAtTime(1, t, 0.015);
      env.gain.setTargetAtTime(0, t + len * 0.7, 0.05);
      o.start(t); o.stop(t + len + 0.4);
      t += len + rnd(0.08, 0.25);
    }
    gullTimer = setTimeout(gull, rnd(9, 24) * 1000);
  }

  // Fmaj7 · Cadd9 · Am7 · Gsus2, bass note first; one chord every 14 s with long crossfades
  const CHORDS = [[41, 57, 60, 64], [48, 55, 62, 64], [45, 57, 60, 67], [43, 55, 57, 62]];
  const BELLS = [72, 74, 76, 79, 81, 84];
  function pad() {
    const t = ac.currentTime, len = 14, notes = CHORDS[chord++ % CHORDS.length];
    const lp = filter('lowpass', 1100, 0.4), env = gainNode(0);
    wire(lp, env, musicBus);
    env.gain.setTargetAtTime(0.11, t, 1.8);
    env.gain.setTargetAtTime(0, t + len - 2, 2.2);
    notes.forEach((m, i) => {
      for (const [type, cents] of [['sine', -4], ['triangle', 4]]) {
        const o = ac.createOscillator(), g = gainNode(i === 0 ? 0.55 : 0.35);
        o.type = type; o.frequency.value = mtof(m); o.detune.value = cents;
        wire(o, g, lp);
        o.start(t); o.stop(t + len + 8);
      }
    });
    padTimer = setTimeout(pad, (len - 3) * 1000);
  }
  function bell() {
    const t = ac.currentTime;
    const o = ac.createOscillator(), g = gainNode(0), pan = ac.createStereoPanner();
    o.frequency.value = mtof(BELLS[Math.floor(Math.random() * BELLS.length)]);
    pan.pan.value = rnd(-0.6, 0.6);
    wire(o, g, pan, musicBus);
    g.gain.setTargetAtTime(0.05, t, 0.01);
    g.gain.setTargetAtTime(0, t + 0.05, 1.1);
    o.start(t); o.stop(t + 6);
    bellTimer = setTimeout(bell, rnd(3, 8) * 1000);
  }

  function stopMusic() {
    clearTimeout(padTimer); clearTimeout(bellTimer); padTimer = bellTimer = 0;
    if (fileEl) fileEl.pause();
  }
  function startMusic() {
    stopMusic();
    if (!S.on) return;
    if (S.mode === 'pad') { pad(); bellTimer = setTimeout(bell, 4000); }
    if (S.mode === 'file' && fileEl) fileEl.play().catch(() => {});
  }

  function setOn(on) {
    if (on === S.on) return;
    S.on = on;
    clearTimeout(offTimer);
    if (on) {
      if (!ac) build();
      ac.resume();
      master.gain.setTargetAtTime(1, ac.currentTime, 0.8);
      if (!waveTimer) { wave(); gullTimer = setTimeout(gull, 3000); }
      startMusic();
    } else if (ac) {
      master.gain.setTargetAtTime(0, ac.currentTime, 0.3);
      offTimer = setTimeout(() => {
        clearTimeout(waveTimer); clearTimeout(gullTimer); waveTimer = gullTimer = 0;
        stopMusic();
        ac.suspend();
      }, 1500);
    }
  }

  return {
    get on() { return S.on; },
    get mode() { return S.mode; },
    setOn,
    toggle() { setOn(!S.on); },
    setOcean(v) { S.ocean = v; if (ac) oceanBus.gain.setTargetAtTime(v, ac.currentTime, 0.1); },
    setMusic(v) { S.music = v; if (ac) musicBus.gain.setTargetAtTime(v, ac.currentTime, 0.1); },
    setMode(mode) { S.mode = mode; if (ac) startMusic(); },
    // play a local audio file on loop; it goes through the music bus so the volume slider applies
    loadFile(file) {
      if (!ac) build();
      if (!fileEl) {
        fileEl = new Audio();
        fileEl.loop = true;
        fileSrc = ac.createMediaElementSource(fileEl);
        fileSrc.connect(musicBus);
      } else URL.revokeObjectURL(fileEl.src);
      fileEl.src = URL.createObjectURL(file);
      S.mode = 'file';
      setOn(true);
      startMusic();
    },
  };
}
