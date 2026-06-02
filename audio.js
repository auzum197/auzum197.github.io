// Dark ambient drone, synthesized live with the Web Audio API.
// Built lazily on first interaction (browsers block autoplay).
(() => {
  let ctx, master, amp, seqBus, seqFb, seqWet, started = false, playing = false;
  const TARGET = 0.32; // overall loudness when on

  // --- Sequencer (Berlin School / Tangerine Dream style) ---
  // A driving 16th-note riff in A minor: a moving bass note on the beat with
  // a pedal A3 on the offbeats, the classic bubbling sequence pattern.
  const TEMPO = 116;                 // BPM
  const STEP = 60 / TEMPO / 4;       // 16th-note duration (seconds)
  const A2 = 110.00, A3 = 220.00, C3 = 130.81, D3 = 146.83, E3 = 164.81, G3 = 196.00;
  const SEQ = [
    A2, A3, E3, A3, C3, A3, E3, A3,
    D3, A3, E3, A3, G3, A3, E3, A3,
  ];
  let stepIndex = 0;
  let nextStepTime = 0;
  let seqRunning = false;

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Soft limiter so the bumped level stays warm instead of clipping
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 24;
    comp.ratio.value = 4;
    comp.attack.value = 0.01;
    comp.release.value = 0.4;
    comp.connect(ctx.destination);

    // Master fade control -> limiter -> speakers
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(comp);

    // "Breathing" tremolo stage all voices pass through
    amp = ctx.createGain();
    amp.gain.value = 0.85;
    amp.connect(master);

    // Dark lowpass to tame the harmonics
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    filter.Q.value = 1.2;
    filter.connect(amp);

    // Feedback delay — timed to 3 sixteenths so the sequencer echoes cascade
    // rhythmically, the hallmark of the Berlin School sound.
    const delay = ctx.createDelay(2.0);
    delay.delayTime.value = STEP * 3;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.5;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    filter.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(amp);

    // Drone voices — a low A with a slightly detuned twin (beating),
    // a fifth above for body, and a deep sub underneath.
    const voices = [
      { f: 55.00, type: 'sawtooth', g: 0.16, detune: 0 },   // A1
      { f: 55.00, type: 'sawtooth', g: 0.14, detune: -9 },  // detuned twin
      { f: 82.41, type: 'triangle', g: 0.10, detune: 5 },   // E2 (fifth)
      { f: 27.50, type: 'sine',     g: 0.22, detune: 0 },   // A0 sub
    ];
    for (const v of voices) {
      const o = ctx.createOscillator();
      o.type = v.type;
      o.frequency.value = v.f;
      o.detune.value = v.detune;
      const g = ctx.createGain();
      g.gain.value = v.g;
      o.connect(g);
      g.connect(filter);
      o.start();
    }

    // Slow filter sweep so the texture keeps evolving
    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.05;
    const sweepDepth = ctx.createGain();
    sweepDepth.gain.value = 170;
    sweep.connect(sweepDepth);
    sweepDepth.connect(filter.frequency);
    sweep.start();

    // Slow amplitude breathing
    const breath = ctx.createOscillator();
    breath.frequency.value = 0.07;
    const breathDepth = ctx.createGain();
    breathDepth.gain.value = 0.12;
    breath.connect(breathDepth);
    breathDepth.connect(amp.gain);
    breath.start();

    // Sequencer bus — dry signal straight to the amp.
    seqBus = ctx.createGain();
    seqBus.gain.value = 0.9;
    seqBus.connect(amp);

    // Dedicated delay for the arpeggio, timed to 3 sixteenths so the echoes
    // cascade rhythmically. Its feedback (number of repeats) and wet level
    // are modulated by slow, non-synced LFOs, so the echo keeps evolving.
    const seqDelay = ctx.createDelay(2.0);
    seqDelay.delayTime.value = STEP * 3;
    seqFb = ctx.createGain();
    seqFb.gain.value = 0.45;
    seqWet = ctx.createGain();
    seqWet.gain.value = 0.3;
    seqBus.connect(seqDelay);
    seqDelay.connect(seqFb);
    seqFb.connect(seqDelay);
    seqDelay.connect(seqWet);
    seqWet.connect(amp);

    // LFO modulating the feedback: 0.45 ± 0.16 -> echoes lengthen and shorten
    const fbLfo = ctx.createOscillator();
    fbLfo.frequency.value = 0.06; // ~17s
    const fbDepth = ctx.createGain();
    fbDepth.gain.value = 0.16;
    fbLfo.connect(fbDepth);
    fbDepth.connect(seqFb.gain);
    fbLfo.start();

    // LFO modulating the wet level: 0.3 ± 0.18 -> echoes swell and recede
    const wetLfo = ctx.createOscillator();
    wetLfo.frequency.value = 0.043; // ~23s, non-synced with the feedback LFO
    const wetDepth = ctx.createGain();
    wetDepth.gain.value = 0.18;
    wetLfo.connect(wetDepth);
    wetDepth.connect(seqWet.gain);
    wetLfo.start();

    started = true;
  }

  // Play one plucked step: a sawtooth through a resonant lowpass with a quick
  // filter + amplitude envelope — the bright, percussive sequencer voice.
  function playStep(freq, time) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;

    // Long-term timbral movement: the peak cutoff drifts over tens of seconds
    // via two slow, non-synced LFOs, so the sequence keeps opening up and
    // closing down — the evolving filter sweep of Berlin School.
    const lfo = 0.5 + 0.35 * Math.sin(time * 2 * Math.PI / 23)
                    + 0.15 * Math.sin(time * 2 * Math.PI / 37);
    const peak = 650 + lfo * 3000; // ~650 Hz (dark) .. ~3650 Hz (bright)

    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 9; // resonant
    f.frequency.setValueAtTime(peak, time);
    f.frequency.exponentialRampToValueAtTime(Math.max(peak * 0.18, 200), time + STEP * 1.6);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.22, time + 0.006); // sharp attack
    g.gain.exponentialRampToValueAtTime(0.13, time + STEP * 0.5); // decay to sustain
    g.gain.setValueAtTime(0.13, time + STEP * 1.1); // hold the note
    g.gain.exponentialRampToValueAtTime(0.0001, time + STEP * 1.7); // release

    o.connect(f);
    f.connect(g);
    g.connect(seqBus);
    o.start(time);
    o.stop(time + STEP * 1.8);
  }

  // Lookahead scheduler — queues steps slightly ahead of time for tight timing.
  function scheduler() {
    if (!playing) { seqRunning = false; return; }
    while (nextStepTime < ctx.currentTime + 0.12) {
      playStep(SEQ[stepIndex % SEQ.length], nextStepTime);
      nextStepTime += STEP;
      stepIndex++;
    }
    setTimeout(scheduler, 25);
  }

  // Occasional dramatic echo swells: ramp feedback near self-oscillation and
  // push the wet up for a big wash, hold, then ease back. Irregular timing.
  function scheduleSwell() {
    if (!playing) return;
    const t = ctx.currentTime;
    const fbPeak = 0.80 + Math.random() * 0.07;  // with the LFO, tops out ~0.96
    const wetPeak = 0.5 + Math.random() * 0.15;
    const rise = 2 + Math.random() * 2.5;
    const hold = 2 + Math.random() * 4;
    const fall = 4 + Math.random() * 5;

    seqFb.gain.cancelScheduledValues(t);
    seqFb.gain.setValueAtTime(seqFb.gain.value, t);
    seqFb.gain.linearRampToValueAtTime(fbPeak, t + rise);
    seqFb.gain.setValueAtTime(fbPeak, t + rise + hold);
    seqFb.gain.linearRampToValueAtTime(0.45, t + rise + hold + fall);

    seqWet.gain.cancelScheduledValues(t);
    seqWet.gain.setValueAtTime(seqWet.gain.value, t);
    seqWet.gain.linearRampToValueAtTime(wetPeak, t + rise);
    seqWet.gain.setValueAtTime(wetPeak, t + rise + hold);
    seqWet.gain.linearRampToValueAtTime(0.3, t + rise + hold + fall);

    // Next swell well after this one finishes, at an irregular interval
    const gap = (rise + hold + fall) * 1000 + 8000 + Math.random() * 16000;
    setTimeout(scheduleSwell, gap);
  }

  function startSequencer() {
    if (seqRunning) return;
    seqRunning = true;
    nextStepTime = ctx.currentTime + 0.1;
    scheduler();
    setTimeout(scheduleSwell, 8000 + Math.random() * 10000); // first swell after a bit
  }

  // --- iOS audio unlock ---

  // Unlock + resume the context synchronously within a user gesture (iOS).
  function unlock() {
    if (!started) build();

    // Silent one-sample buffer kicks the context awake on iOS
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    } catch (e) { /* ignore */ }

    // iOS can report 'suspended' or 'interrupted'; resume in both cases
    if (ctx.state !== 'running') ctx.resume();
  }

  function toggle() {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);

    if (!playing) {
      master.gain.linearRampToValueAtTime(TARGET, now + 4); // slow swell in
      playing = true;
      startSequencer();
    } else {
      master.gain.linearRampToValueAtTime(0, now + 1.5);    // gentle fade out
      playing = false;
    }
    return playing;
  }

  // Resume after interruptions (phone call, app switch) when coming back
  document.addEventListener('visibilitychange', () => {
    if (ctx && playing && document.visibilityState === 'visible' && ctx.state !== 'running') {
      ctx.resume();
    }
  });

  const btn = document.getElementById('sound-toggle');
  btn.addEventListener('click', () => {
    const fromW = btn.offsetWidth;

    unlock();              // must run synchronously inside the tap (iOS)
    const on = toggle();
    btn.textContent = on ? 'Sound off' : 'Sound on';
    btn.classList.toggle('active', on);

    // Smoothly resize the container to fit the new label
    const toW = btn.offsetWidth;
    if (fromW !== toW) {
      btn.animate(
        [{ width: `${fromW}px` }, { width: `${toW}px` }],
        { duration: 350, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      );
    }
  });
})();
