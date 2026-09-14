/* =====================================================================
   STEM לומדה — reusable foundation engine
   Stage scaling, screen navigation (design corner buttons + keyboard),
   single-choice question flow, score, accessibility. Reused per unit.
   ===================================================================== */
(function () {
  'use strict';

  var stage   = document.getElementById('app');
  var screens = Array.prototype.slice.call(document.querySelectorAll('.screen'));

  /* QA-compat: each <section> is kept clean (class + data-screen only) so the QA
     system's page-detector recognizes it. Per-screen metadata lives in a hidden
     .smeta child; copy its data- and aria- attributes back onto the section so the
     rest of the engine reads them exactly as before. */
  screens.forEach(function (s) {
    var m = s.querySelector('.smeta');
    if (!m) return;
    Array.prototype.forEach.call(m.attributes, function (a) {
      if (a.name.indexOf('data-') === 0 || a.name.indexOf('aria-') === 0) s.setAttribute(a.name, a.value);
    });
  });
  /* ---------- QA / harness integration (figma-lomda-builder convention) ----------
     Matches the approved org lomdot (Flickering-Lights / WallPaint): expose top-level
     globals the QA host can read/drive, keep a live window.lomdaState, and post
     LOMDA_* messages. The public goTo/currentScreen are 1-based (data-screen 1..N);
     internal navigation stays 0-based array index. Also keeps the older DEV_READY /
     DEV_GOTO handshake for backward-compatible previewers. */
  window.TOTAL_SCREENS = screens.length;
  window.currentScreen = 1;
  window.lomdaState = { score: 0, questionScores: {}, DONE: {} };
  window.goTo = function (n) { goTo((parseInt(n, 10) || 1) - 1); };   // public API: 1-based
  (function harness() {
    var acked = false;
    function announce() {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'DEV_READY', total: screens.length }, '*');
        }
      } catch (e) {}
    }
    window.addEventListener('message', function (e) {
      var d = (e && e.data) || {};
      if (d.type === 'DEV_GOTO' && typeof d.screen === 'number') { acked = true; window.goTo(d.screen); }
      else { announce(); }
    });
    announce();
    window.addEventListener('load', announce);
    var k = 0, iv = setInterval(function () { announce(); if (++k > 20 || acked) clearInterval(iv); }, 400);
  })();

  var btnFwd  = document.getElementById('nav-fwd');   // forward = next (bottom-left, RTL)
  var btnBack = document.getElementById('nav-back');   // back = prev  (bottom-right)

  var current = 0, score = 0, answered = {};
  var earned = 0;              // points earned (SCORM 0–100)
  var MASTERY = 80;           // matches the example package's mastery score

  /* ---------- 1. STAGE SCALING (fit 1920×1080 to the viewport) ---------- */
  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.setProperty('--scale', s);
  }
  window.addEventListener('resize', fit);
  fit();

  /* ---------- 2. NAVIGATION ---------- */
  function goTo(i) {
    if (i < 0 || i >= screens.length) return;
    Array.prototype.forEach.call(document.querySelectorAll('audio'), function (a) { try { a.pause(); } catch (e) {} });
    if (screens[current]._onLeave) screens[current]._onLeave();
    screens[current].classList.remove('active');
    screens[current].setAttribute('aria-hidden', 'true');
    current = i;
    screens[current].classList.add('active');
    screens[current].setAttribute('aria-hidden', 'false');
    if (btnFwd) btnFwd.classList.remove('nav-pulse');
    if (screens[current].getAttribute('data-type') === 'end') showScore();
    revealScreen(screens[current]);   // run first: resets per-visit gate flags (e.g. _dialogueDone) before chrome reads them
    updateChrome();
    if (screens[current]._onEnter) screens[current]._onEnter();
    window.currentScreen = current + 1;   // 1-based, for the QA host
    try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'LOMDA_SCREEN_CHANGED', screen: current + 1 }, '*'); } catch (e) {}
    saveProgress();   // bookmark this screen so closing + reopening resumes here (no-op outside an LMS)
  }

  /* ---------- SCORM resume: save/restore progress across sessions ----------
     Saved via the LMS (cmi.core.lesson_location + cmi.suspend_data), not the
     browser — so it follows the student to a different computer, as long as
     they're launched from the same LMS course. Fully a no-op standalone
     (opened directly, or inside the QA harness): window.SCORM.isReady()
     stays false, so nothing is read or written.
     Restoring the exact on-screen "this option is selected/locked" look for
     an already-answered question isn't replayed here — only which questions
     are done (so the forward-navigation gate stays correct) and the running
     score. Revisiting an old answered question after a resume shows it
     un-selected again; re-picking and checking is harmless (it won't
     double-count the score) and re-locks it visually. */
  function saveProgress() {
    if (!window.SCORM || !window.SCORM.isReady()) return;
    window.SCORM.saveLocation(current + 1);
    window.SCORM.saveSuspendData({ answered: answered, earned: earned, score: score });
  }
  function restoreProgress() {
    if (!window.SCORM || !window.SCORM.isReady()) return;
    var data = window.SCORM.getSuspendData();
    if (data) {
      if (data.answered) {
        for (var qid in data.answered) if (data.answered.hasOwnProperty(qid)) answered[qid] = true;
      }
      if (typeof data.earned === 'number') earned = data.earned;
      if (typeof data.score === 'number') score = data.score;
      if (window.lomdaState) window.lomdaState.score = earned;
    }
    var loc = parseInt(window.SCORM.getLocation(), 10);
    if (!isNaN(loc) && loc >= 1 && loc <= screens.length && loc !== current + 1) goTo(loc - 1);
  }
  window.addEventListener('scorm:ready', restoreProgress);

  /* ---------- FLOAT-IN REVEAL ---------- */
  var REVEAL_SEL = '.speech, .qstem, .options, .bubble, .applet-frame, [data-reveal]';
  var FLOAT_IN_MS = 600;   // .float-in transition (.5s) + a beat, see styles.css
  var revealGen = 0;
  function revealScreen(s) {
    revealGen++; var gen = revealGen;
    var els = Array.prototype.slice.call(s.querySelectorAll(REVEAL_SEL));
    els.sort(function (a, b) {
      return (+a.getAttribute('data-reveal-order') || 0) - (+b.getAttribute('data-reveal-order') || 0);
    });
    // Revisiting a screen -- coming back from the optional מד-הכוח side-trip, or
    // any back-navigation -- presents it already settled. The learner has watched
    // this play in once; replaying the float-in sequence (and, on a dialogue screen,
    // making them wait out the gate again) just costs them time.
    if (s._revealed) {
      els.forEach(function (el) {
        el.classList.add('float-in');                       // keep is-in, so nothing transitions
        if (!el.hasAttribute('data-hold')) el.classList.add('is-in');
      });
      if (s.getAttribute('data-gate') === 'dialogue') s._dialogueDone = true;
      settleApplet(s);
      return;
    }
    s._revealed = true;
    els.forEach(function (el) { el.classList.add('float-in'); el.classList.remove('is-in'); });
    var maxDelay = 0;
    els.forEach(function (el) {
      if (el.hasAttribute('data-hold')) return;   // held elements reveal later (e.g., after the applet experiment)
      // explicit delay (ms) overrides the generic order-based stagger, for screens that need a
      // specific pause (e.g. a dialogue reply that should land a few seconds after the first line)
      var explicitDelay = el.getAttribute('data-reveal-delay');
      var order = +el.getAttribute('data-reveal-order') || 0;   // same order = revealed together
      var delay = explicitDelay !== null ? (150 + (+explicitDelay || 0)) : (150 + order * 450);
      if (delay > maxDelay) maxDelay = delay;
      setTimeout(function () { if (gen === revealGen) el.classList.add('is-in'); }, delay);
    });
    // dialogue-gated screens: the forward arrow stays hidden until the whole reveal
    // sequence has landed -- maxDelay is when the LAST element starts floating in, so
    // wait out its .float-in transition (see FLOAT_IN_MS) before opening the gate,
    // otherwise the arrow appears while the final bubble is still fading up.
    if (s.getAttribute('data-gate') === 'dialogue') {
      s._dialogueDone = false;
      setTimeout(function () {
        if (gen !== revealGen) return;
        s._dialogueDone = true;
        if (screens[current] === s) updateChrome();
      }, maxDelay + FLOAT_IN_MS);
    }
    settleApplet(s);
  }
  // returning to a completed applet screen: keep it settled + any held element shown
  function settleApplet(s) {
    if (!s._appletDone) return;
    var fr = s.querySelector('.applet-frame'); if (fr) fr.classList.add('applet-settled');
    revealHeld(s);
  }
  // reveal any held elements on a screen (used after the applet experiment completes)
  function revealHeld(s) {
    Array.prototype.forEach.call(s.querySelectorAll('[data-hold]'), function (el) {
      el.classList.add('float-in'); el.classList.add('is-in');
    });
  }
  // Shira's summary rises only after the student runs the displacement experiment
  window.addEventListener('message', function (e) {
    var d = (e && e.data) || {};
    if (d.type !== 'APPLET_DONE') return;
    var sc = screens[current];
    if (!sc || sc.getAttribute('data-gate') !== 'applet' || sc._appletDone) return;
    sc._appletDone = true;
    var fr = sc.querySelector('.applet-frame'); if (fr) fr.classList.add('applet-settled');
    revealHeld(sc);
    // reveal the forward arrow only after Shira + the bubble have risen into view
    setTimeout(function () { if (screens[current] === sc) updateChrome(); }, 800);
  });
  // Keyboard nav must honour the same gates as the arrow buttons — otherwise
  // ArrowLeft walks straight past every unanswered question and the learner
  // reaches the end with a score of 0.
  // A screen may route the arrows past an optional side-trip screen (one that is
  // only reachable from a link in the body text) via data-next / data-prev, which
  // name the 1-based target screen instead of the neighbouring index.
  function step(dir) {
    var s = screens[current];
    var to = s.getAttribute(dir > 0 ? 'data-next' : 'data-prev');
    return to ? (parseInt(to, 10) || 1) - 1 : current + dir;
  }
  function next() { if (btnFwd && btnFwd.disabled) return; goTo(step(1)); }
  function prev() { if (btnBack && btnBack.disabled) return; goTo(step(-1)); }

  if (btnFwd)  btnFwd.addEventListener('click', next);
  if (btnBack) btnBack.addEventListener('click', prev);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft')  next();   // RTL: left = forward
    if (e.key === 'ArrowRight') prev();
  });

  function updateChrome() {
    if (btnBack) { btnBack.disabled = (current === 0); btnBack.style.visibility = (current === 0) ? 'hidden' : 'visible'; }
    var sc = screens[current];
    // on a question screen the forward arrow is hidden until it's answered correctly
    var gated = (sc.getAttribute('data-type') === 'question' && !answered[sc.getAttribute('data-qid')]) ||
                (sc.getAttribute('data-gate') === 'explore' && !sc._exploreDone) ||
                (sc.getAttribute('data-gate') === 'video' && !sc._videoDone) ||
                (sc.getAttribute('data-gate') === 'applet' && !sc._appletDone) ||
                (sc.getAttribute('data-gate') === 'dialogue' && !sc._dialogueDone) ||
                (sc.getAttribute('data-gate') === 'deadend');
    if (btnFwd) {
      // screens with their own start/continue button (e.g. the opening title
      // screen) hide the generic forward arrow entirely, so it never shows —
      // but it must stay enabled (not disabled) since that button proxies
      // its click to trigger the same "next" navigation
      var hideFwd = sc.hasAttribute('data-hide-fwd');
      btnFwd.disabled = (current === screens.length - 1) || gated;
      btnFwd.style.visibility = (gated || hideFwd) ? 'hidden' : 'visible';
    }
  }

  /* ---------- 3. SINGLE-CHOICE QUESTION FLOW ----------
     select an answer -> check button appears -> check -> feedback popup.
     Right: dot shows ✓, options lock, forward arrow appears. Wrong: dot shows
     ✕; picking another answer clears it and brings the check button back.   */
  function initQuestion(screen) {
    var qid     = screen.getAttribute('data-qid');
    var correct = screen.getAttribute('data-answer');
    var options = Array.prototype.slice.call(screen.querySelectorAll('.option'));
    var check   = screen.querySelector('.btn--check');
    var hintBtn = screen.querySelector('.btn--hint');
    var hint    = screen.querySelector('.hint');
    var fb      = screen.querySelector('.feedback');
    var fbTitle = fb && fb.querySelector('.feedback__title');
    var fbBody  = fb && fb.querySelector('.feedback__body');
    var selected = null;
    var attempts = 0;
    var MAX_ATTEMPTS = 2;   // example rule: finish on a correct answer OR 2 attempts
    var points = parseFloat(screen.getAttribute('data-points')) || 0;   // this Q/part's weight
    var multi = screen.getAttribute('data-multi') === 'true';            // multi-select question
    var correctSet = (correct || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    function anySelected() { return options.some(function (o) { return o.getAttribute('aria-checked') === 'true'; }); }

    function clearResult() {
      options.forEach(function (o) { o.classList.remove('is-incorrect'); });
      if (fb) { fb.hidden = true; fb.classList.remove('is-correct', 'is-incorrect'); }
      // feedback is gone again (retrying) -- drop the settled/shifted layout state
      screen.classList.remove('fb-showing');
    }
    function showFb(correctState, title, body, bodyIsHtml) {
      // On a correct answer, some screens swap to a "report/result" view:
      // change the background, reveal the .fb-report overlay, hide the question.
      if (correctState) {
        // reveal the report panel (if any) in the screen's image slot; the question stays put
        var rep = screen.querySelector('.fb-report');
        if (rep) rep.hidden = false;
      }
      if (!fb) return;
      fb.hidden = false;
      fb.classList.toggle('is-correct', correctState);
      fb.classList.toggle('is-incorrect', !correctState);
      if (fbTitle) fbTitle.textContent = title;
      // body is plain text except for the "reveal the answer" prompt, which carries a button
      if (fbBody) { if (bodyIsHtml) fbBody.innerHTML = body; else fbBody.textContent = body; }
      // feedback is visible (first try or final) -- drives CSS-scoped layout shifts,
      // e.g. screen 17/19's rock image settling into its "feedback showing" spot.
      // Question text + options are NOT hidden by this -- they stay visible throughout.
      screen.classList.add('fb-showing');
    }
    function finishQuestion(scored, gained) {
      if (!answered[qid]) {
        var add = (typeof gained === 'number') ? gained : (scored ? points : 0);
        if (add > 0) earned += add;                        // supports partial credit (multi-select)
        if (scored) score++;
        answered[qid] = true;
        if (window.SCORM) window.SCORM.setScore(earned); if (window.lomdaState) window.lomdaState.score = earned;   // report running score to the LMS
        saveProgress();   // persist this answer immediately, not just on the next screen change
      }
      options.forEach(function (o) { o.classList.add('is-locked'); });
      if (check) check.hidden = true;
      // reveal any "did you know"/extra popups that float in with the final feedback
      var extras = screen.querySelectorAll('.fb-extra');
      for (var i = 0; i < extras.length; i++) extras[i].hidden = false;
      updateChrome();                                  // reveal forward arrow
      if (btnFwd) btnFwd.classList.add('nav-pulse');   // blink it
    }

    // ---- DROPDOWN (fill-in-the-blank) questions ----
    var selects = Array.prototype.slice.call(screen.querySelectorAll('select.qselect'));
    if (selects.length) {
      var allChosen = function () { return selects.every(function (s) { return s.value !== ''; }); };
      selects.forEach(function (s) {
        s.addEventListener('change', function () {
          if (fb) { fb.hidden = true; fb.classList.remove('is-correct', 'is-incorrect'); }
          s.classList.remove('is-correct', 'is-incorrect');
          if (check) check.hidden = !allChosen();
        });
      });
      if (check) check.addEventListener('click', function () {
        if (!allChosen()) return;
        check.hidden = true;
        var nCorrect = selects.filter(function (s) { return s.value === s.getAttribute('data-answer'); }).length;
        selects.forEach(function (s) {
          var ok = s.value === s.getAttribute('data-answer');
          s.classList.toggle('is-correct', ok); s.classList.toggle('is-incorrect', !ok);
        });
        if (nCorrect === selects.length) {
          selects.forEach(function (s) { s.disabled = true; });
          showFb(true, 'צדקת!', screen.getAttribute('data-fb-correct') || '');
          finishQuestion(true); return;
        }
        attempts++;
        if (attempts >= MAX_ATTEMPTS) {
          var partial = (nCorrect / selects.length) * points;   // partial credit per blank
          // Out of attempts: LEAVE the learner's own answers on screen (right in green,
          // wrong in red) so they can see what they got wrong. The correct answers are
          // filled in only when they ask for them, via the reveal button in the feedback.
          selects.forEach(function (s) { s.disabled = true; });
          var lead = (nCorrect > 0 ? screen.getAttribute('data-fb-partial')
                                   : screen.getAttribute('data-fb-none'))
                     || screen.getAttribute('data-fb-incorrect') || '';
          showFb(false, nCorrect > 0 ? 'כמעט!' : 'זו טעות',
                 lead + ' <button type="button" class="fb-reveal">לחצו</button> לקבלת התשובה הנכונה', true);
          finishQuestion(false, partial);
        } else {
          showFb(false, 'זו טעות', 'נסו שוב.');
          check.hidden = false;
        }
      });
      // "show me the answer": fills every blank in, then clears the feedback away --
      // the script has no post-reveal text, so the learner is left with the completed
      // paragraph and the forward arrow (already un-gated by finishQuestion)
      if (fb) fb.addEventListener('click', function (e) {
        if (!e.target || !e.target.classList.contains('fb-reveal')) return;
        e.preventDefault();
        selects.forEach(function (s) {
          s.value = s.getAttribute('data-answer');
          s.classList.add('is-correct'); s.classList.remove('is-incorrect');
        });
        // some questions carry a written explanation for after the reveal; where the
        // script has none, the feedback simply clears away
        var ans = screen.getAttribute('data-fb-answer');
        if (ans) { showFb(true, 'התשובה הנכונה:', ans); return; }
        fb.hidden = true;
        fb.classList.remove('is-correct', 'is-incorrect');
        screen.classList.remove('fb-showing');
      });
      return;   // dropdown question fully handled
    }

    options.forEach(function (opt) {
      function select() {
        if (opt.classList.contains('is-locked')) return;
        clearResult();                       // reset a previous wrong attempt
        if (multi) {
          opt.setAttribute('aria-checked', opt.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
          if (check) check.hidden = !anySelected();
        } else {
          options.forEach(function (o) { o.setAttribute('aria-checked', 'false'); });
          opt.setAttribute('aria-checked', 'true');
          selected = opt;
          if (check) check.hidden = false;   // reveal the check button once something is picked
        }
      }
      opt.addEventListener('click', select);
      opt.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); }
      });
    });

    // "show me the answer" in the final feedback: marks every correct option and
    // clears the feedback away, leaving the learner with the answer + the forward arrow
    if (fb) fb.addEventListener('click', function (e) {
      if (!e.target || !e.target.classList.contains('fb-reveal')) return;
      e.preventDefault();
      options.forEach(function (o) {
        var v = o.getAttribute('data-value');
        var isRight = correctSet.length ? correctSet.indexOf(v) >= 0 : v === correct;
        if (isRight) { o.classList.add('is-correct'); o.classList.remove('is-incorrect'); }
      });
      var ans = screen.getAttribute('data-fb-answer');
      if (ans) { showFb(true, 'התשובה הנכונה:', ans); return; }
      fb.hidden = true;
      fb.classList.remove('is-correct', 'is-incorrect');
      screen.classList.remove('fb-showing');
    });

    if (hintBtn && hint) hintBtn.addEventListener('click', function () {
      var open = !hint.hidden;
      hint.hidden = open;
      hintBtn.setAttribute('aria-expanded', String(!open));
    });

    if (check) check.addEventListener('click', function () {
      if (multi) {
        if (!anySelected()) return;
        check.hidden = true;
        var sel = options.filter(function (o) { return o.getAttribute('aria-checked') === 'true'; })
                         .map(function (o) { return o.getAttribute('data-value'); });
        var ok = sel.length === correctSet.length && correctSet.every(function (v) { return sel.indexOf(v) >= 0; });
        if (ok) {
          options.forEach(function (o) { if (correctSet.indexOf(o.getAttribute('data-value')) >= 0) o.classList.add('is-correct'); });
          showFb(true, 'צדקת!', screen.getAttribute('data-fb-correct') || '');
          finishQuestion(true);
          return;
        }
        attempts++;
        options.forEach(function (o) {
          if (o.getAttribute('aria-checked') === 'true' && correctSet.indexOf(o.getAttribute('data-value')) < 0)
            o.classList.add('is-incorrect');
        });
        if (attempts >= MAX_ATTEMPTS) {
          // partial credit: (correct picks − wrong picks) / total correct, floored at 0
          var nCorrect = sel.filter(function (v) { return correctSet.indexOf(v) >= 0; }).length;
          var nWrong = sel.length - nCorrect;
          var frac = Math.max(0, (nCorrect - nWrong) / correctSet.length);
          var partial = frac * points;
          // Same two-step flow as the fill-in questions: mark only what the learner
          // actually picked (right green, wrong red) so they can see where they went
          // wrong; the answers they missed stay blank until they ask for them.
          options.forEach(function (o) {
            if (o.getAttribute('aria-checked') === 'true' && correctSet.indexOf(o.getAttribute('data-value')) >= 0)
              o.classList.add('is-correct');
          });
          // the MESSAGE depends on whether anything was picked correctly, not on the
          // credit fraction -- one right pick among wrong ones is still "partly right"
          // even though the (correct − wrong) score floors at zero
          var lead = (nCorrect > 0 ? screen.getAttribute('data-fb-partial')
                                   : screen.getAttribute('data-fb-none'))
                     || screen.getAttribute('data-fb-incorrect') || '';
          showFb(false, nCorrect > 0 ? 'כמעט!' : 'זו טעות',
                 lead + ' <button type="button" class="fb-reveal">לחצו</button> לקבלת התשובה הנכונה', true);
          finishQuestion(false, partial);
        } else {
          showFb(false, 'זו טעות', 'נסו שוב.');
          check.hidden = false;
        }
        return;
      }
      if (!selected) return;
      var right = selected.getAttribute('data-value') === correct;
      if (check) check.hidden = true;
      if (right) {
        selected.classList.add('is-correct');
        showFb(true, 'צדקת!', screen.getAttribute('data-fb-correct') || '');
        finishQuestion(true);
        return;
      }
      // wrong answer
      attempts++;
      selected.classList.add('is-incorrect');
      if (attempts >= MAX_ATTEMPTS) {
        // second miss: reveal the correct answer and let the learner move on
        options.forEach(function (o) {
          if (o.getAttribute('data-value') === correct) o.classList.add('is-correct');
        });
        showFb(false, 'זו טעות', screen.getAttribute('data-fb-incorrect') || '');
        finishQuestion(false);
      } else {
        // first miss: short "try again", keep options live (re-select clears + re-shows check)
        showFb(false, 'זו טעות', 'נסו שוב.');
      }
    });
  }
  /* ---------- DRAG-TO-ORDER questions (cards → step slots) ---------- */
  function initDragOrder(screen) {
    var qid = screen.getAttribute('data-qid');
    var points = parseFloat(screen.getAttribute('data-points')) || 0;
    var cards = Array.prototype.slice.call(screen.querySelectorAll('.dcard'));
    var slots = Array.prototype.slice.call(screen.querySelectorAll('.dslot'));
    // a slot accepts its data-slot card, or any card listed in data-accept (allows interchangeable steps)
    function slotAccepts(s, card) {
      if (!card) return false;
      var acc = s.getAttribute('data-accept') || s.getAttribute('data-slot');
      return acc.split(',').indexOf(card.getAttribute('data-card')) >= 0;
    }
    var check = screen.querySelector('.btn--check');
    var fb = screen.querySelector('.feedback');
    var fbT = fb && fb.querySelector('.feedback__title');
    var fbB = fb && fb.querySelector('.feedback__body');
    var attempts = 0, MAX = 2, done = false;
    var px = function (el, p) { return parseFloat(el.style[p]) || 0; };
    cards.forEach(function (c) { c._home = { l: px(c, 'left'), t: px(c, 'top') }; c._slot = null; });
    slots.forEach(function (s) { s._card = null; });

    function localXY(e) { var r = stage.getBoundingClientRect(); var sc = r.width / 1920; return { x: (e.clientX - r.left) / sc, y: (e.clientY - r.top) / sc }; }
    function snap(card, slot) { card.style.left = px(slot, 'left') + 'px'; card.style.top = px(slot, 'top') + 'px'; }
    function home(card) { card.style.left = card._home.l + 'px'; card.style.top = card._home.t + 'px'; }
    function place(card, slot) {
      if (card._slot) card._slot._card = null;
      if (slot) {
        if (slot._card && slot._card !== card) { var occ = slot._card; occ._slot = card._slot || null; if (occ._slot) { occ._slot._card = occ; snap(occ, occ._slot); } else home(occ); }
        slot._card = card; card._slot = slot; snap(card, slot);
      } else { card._slot = null; home(card); }
    }
    function allFilled() { return slots.every(function (s) { return s._card; }); }
    function clearMarks() { cards.forEach(function (c) { c.classList.remove('is-correct', 'is-incorrect'); }); if (fb) fb.hidden = true; }

    cards.forEach(function (card) {
      card.addEventListener('pointerdown', function (e) {
        if (done) return;
        e.preventDefault(); clearMarks(); if (prompt) prompt.hidden = true;
        var p = localXY(e), ox = p.x - px(card, 'left'), oy = p.y - px(card, 'top'), curSlot = null;
        card.classList.add('dragging'); try { card.setPointerCapture(e.pointerId); } catch (x) {}
        function move(ev) {
          var q = localXY(ev); card.style.left = (q.x - ox) + 'px'; card.style.top = (q.y - oy) + 'px';
          curSlot = null;
          slots.forEach(function (s) {
            var l = px(s, 'left'), t = px(s, 'top');
            var hit = q.x >= l && q.x <= l + 586 && q.y >= t - 14 && q.y <= t + 112;
            s.classList.toggle('over', hit); if (hit) curSlot = s;
          });
        }
        function up() {
          card.classList.remove('dragging'); slots.forEach(function (s) { s.classList.remove('over'); });
          document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
          place(card, curSlot); if (check) check.hidden = !allFilled();
        }
        document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
      });
    });

    // small popup used for BOTH "try again" (1st miss) and the "→ כאן" reveal prompt (2nd miss)
    var prompt = document.createElement('div');
    prompt.className = 'dprompt'; prompt.hidden = true;
    prompt.innerHTML = '<p class="dprompt__title"></p><p class="dprompt__body"></p>';
    screen.appendChild(prompt);
    var pTitle = prompt.querySelector('.dprompt__title');
    var pBody = prompt.querySelector('.dprompt__body');
    var pendingPartial = 0, pendingN = 0;
    function showPrompt(title, bodyHTML) { pTitle.textContent = title; pBody.innerHTML = bodyHTML; prompt.hidden = false; }
    prompt.addEventListener('click', function (e) {
      if (e.target && e.target.classList.contains('dreveal')) { e.preventDefault(); reveal(); }
    });

    function award(gain, scored) {
      if (!answered[qid]) { if (gain > 0) earned += gain; if (scored) score++; answered[qid] = true; if (window.SCORM) window.SCORM.setScore(earned); if (window.lomdaState) window.lomdaState.score = earned; saveProgress(); }
      cards.forEach(function (c) { c.style.pointerEvents = 'none'; });
      if (check) check.hidden = true;
      updateChrome(); if (btnFwd) btnFwd.classList.add('nav-pulse');   // forward appears only now
    }

    function reveal() {   // stage 2: snap the correct answer + show the full explanation
      prompt.hidden = true;
      cards.forEach(function (c) { c._slot = null; }); slots.forEach(function (s) { s._card = null; });
      slots.forEach(function (s) {
        var cc = cards.filter(function (c) { return c.getAttribute('data-card') === s.getAttribute('data-slot'); })[0];
        s._card = cc; cc._slot = s; snap(cc, s); cc.classList.remove('is-incorrect'); cc.classList.add('is-correct');
      });
      if (fb) { fb.hidden = false; fb.classList.add('is-incorrect'); fb.classList.remove('is-correct'); if (fbT) fbT.textContent = pendingN > 0 ? 'כמעט!' : 'זו טעות'; if (fbB) fbB.textContent = screen.getAttribute('data-fb-incorrect') || ''; }
      done = true;
      award(pendingPartial, false);
    }

    if (check) check.addEventListener('click', function () {
      if (!allFilled() || done) return;
      check.hidden = true;
      if (fb) fb.hidden = true;
      var nCorrect = 0;
      slots.forEach(function (s) { if (slotAccepts(s, s._card)) nCorrect++; });
      if (nCorrect === slots.length) {
        done = true;
        slots.forEach(function (s) { s._card.classList.add('is-correct'); });
        if (fb) { fb.hidden = false; fb.classList.add('is-correct'); fb.classList.remove('is-incorrect'); if (fbT) fbT.textContent = 'צדקת!'; if (fbB) fbB.textContent = screen.getAttribute('data-fb-correct') || ''; }
        award(points, true); return;
      }
      attempts++;
      if (attempts >= MAX) {
        // stage 1: mark their own layout right/wrong, lock it, show the small "→ כאן" prompt
        slots.forEach(function (s) { var ok = slotAccepts(s, s._card); s._card.classList.toggle('is-correct', ok); s._card.classList.toggle('is-incorrect', !ok); });
        cards.forEach(function (c) { c.style.pointerEvents = 'none'; });
        pendingN = nCorrect; pendingPartial = (nCorrect / slots.length) * points;
        showPrompt(nCorrect > 0 ? 'כמעט!' : 'זו טעות', 'לחצו <a href="#" class="dreveal">כאן</a> לתשובה הנכונה');
      } else {
        // 1st miss: small "try again" (keeps their layout; they can re-check without moving)
        showPrompt('זו טעות', 'נסו שוב.');
        if (check) check.hidden = false;
      }
    });
  }

  /* ---------- SAMPLE EXPLORER (cards + captions driven by the narration timeline;
     click opens info popup; forward gated until all four explored; a11y play/pause bar) ---------- */
  /* ---------- SAMPLE EXPLORER (flip cards) ----------
     Same component as the volume unit, minus the narration track: this unit
     has no audio, so all four cards appear together on entry instead of
     being revealed one at a time by the clip. Forward stays gated until
     every card has been flipped at least once. */
  function initExplore(screen) {
    var cards = Array.prototype.slice.call(screen.querySelectorAll('.card'));
    var explored = {};

    function checkGate() {
      if (cards.every(function (c) { return explored[c.getAttribute('data-key')]; })) {
        screen._exploreDone = true;
        updateChrome();
        if (btnFwd) btnFwd.classList.add('nav-pulse');
      }
    }
    function revealAll() { cards.forEach(function (c) { c.classList.add('in'); }); }

    cards.forEach(function (card) {
      function flip() {
        card.classList.toggle('is-flipped');
        card.classList.add('seen');                       // hide the "tap me" cue once used
        card.setAttribute('aria-pressed', card.classList.contains('is-flipped') ? 'true' : 'false');
        explored[card.getAttribute('data-key')] = true;   // flipped at least once
        checkGate();
      }
      card.addEventListener('click', flip);
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
      });
    });

    screen._onEnter = function () {
      cards.forEach(function (c) {
        c.classList.remove('is-flipped');
        c.classList.remove('seen');
        c.setAttribute('aria-pressed', 'false');
      });
      revealAll();     // all four together
    };
  }

  /* =====================================================================
     MASS UNIT — interactions this unit adds. Everything above is the
     shared foundation and is byte-identical to the volume unit.
     ===================================================================== */

  /* Tabbed info panels (screen 7): same open/close contract, no gate —
     that screen is an optional detour and cannot be advanced from. */
  /* Each pill toggles its own drawer; the ✕ badge that appears on an open pill is
     part of the pill, so clicking anywhere on it closes the drawer again. */
  function initTabs(screen) {
    Array.prototype.forEach.call(screen.querySelectorAll('.tab'), function (tab) {
      var panel = screen.querySelector('.tabpanel[data-for="' + tab.getAttribute('data-panel') + '"]');
      if (!panel) return;
      tab.addEventListener('click', function () {
        var open = tab.getAttribute('aria-expanded') === 'true';
        panel.hidden = open;
        tab.setAttribute('aria-expanded', open ? 'false' : 'true');
        tab.classList.add('tab-used');   // drop the "tap me" cue once it has been used
      });
    });
  }

  /* Closing screen (28) is a still rather than a video, so its submit button
     is not picked up by initVideo — wire it here. */
  Array.prototype.forEach.call(document.querySelectorAll('[data-submit]'), function (b) {
    var sc = b.closest ? b.closest('.screen') : null;
    if (!sc || sc.getAttribute('data-type') === 'video') return;
    b.addEventListener('click', function () { showScore(); b.hidden = true; });
  });

  /* Inline cross-reference links ("מד כוח" -> screen 7, "לחצו" -> screen 10). */
  document.addEventListener('click', function (e) {
    var j = e.target.closest ? e.target.closest('.jump[data-goto]') : null;
    if (!j) return;
    e.preventDefault();
    goTo((parseInt(j.getAttribute('data-goto'), 10) || 1) - 1);
  });

  screens.forEach(function (s) {
    if (s.querySelector('.card')) initExplore(s);
    if (s.querySelector('.tab')) initTabs(s);
    if (s.getAttribute('data-type') === 'video') initVideo(s);
    if (s.getAttribute('data-type') === 'question' && s.querySelector('.dcard')) { initDragOrder(s); return; }
    if (s.getAttribute('data-type') === 'question') initQuestion(s);
  });

  /* ---------- VIDEO screen (custom control bar, play-button start, synced captions, forward gated) ---------- */
  function initVideo(screen) {
    var v = screen.querySelector('video');
    var playBtn = screen.querySelector('.video-play');   // big center poster button
    var cap = screen.querySelector('[data-vcap]');
    var logo = screen.querySelector('.video-logo');      // opening logo (first ~3s), if any
    if (!v) return;
    // caption segments live as hidden HTML (translation-safe): .vcap-src > [data-t] spans
    var src = screen.querySelector('.vcap-src');
    var CAPS = src ? Array.prototype.map.call(src.querySelectorAll('[data-t]'), function (n) {
      return { t: parseFloat(n.getAttribute('data-t')), text: n.textContent };
    }) : [];
    var CLEAR_AFTER = (src && src.getAttribute('data-end')) ? parseFloat(src.getAttribute('data-end')) : 1e9;
    // custom control-bar elements
    var ccBtn = screen.querySelector('[data-cc]'), ppBtn = screen.querySelector('[data-play]');
    var seek = screen.querySelector('[data-seek]'), curEl = screen.querySelector('[data-cur]'), durEl = screen.querySelector('[data-dur]');
    var muteBtn = screen.querySelector('[data-mute]'), volEl = screen.querySelector('[data-vol]'), fullBtn = screen.querySelector('[data-full]');
    var submitBtn = screen.querySelector('[data-submit]'), endcard = screen.querySelector('[data-endcard]');
    var raf = null, seeking = false, PLAY = '▶', PAUSE = '❚❚';

    if (submitBtn) submitBtn.addEventListener('click', function () {
      showScore();                       // reports cmi.core.score.raw + pass/fail + LMSFinish
      if (endcard) endcard.hidden = false;
      submitBtn.hidden = true;
    });

    function fmt(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
    function setCap(t) {
      var s = '';
      for (var i = 0; i < CAPS.length; i++) { if (t >= CAPS[i].t) s = CAPS[i].text; }
      if (t >= CLEAR_AFTER) s = '';
      if (cap && cap.textContent !== s) cap.textContent = s;
      if (logo) logo.style.opacity = (t < 3) ? '1' : '0';   // opening logo for the first 3s
    }
    function syncBar() {
      if (curEl) curEl.textContent = fmt(v.currentTime);
      if (!seeking && seek && v.duration) seek.value = String(Math.round(v.currentTime / v.duration * 1000));
    }
    function tick() {
      setCap(v.currentTime); syncBar();
      if (!v.paused && !v.ended && screen.classList.contains('active')) raf = requestAnimationFrame(tick);
    }
    function play() { var p = v.play(); if (p && p.catch) p.catch(function () {}); }

    if (ccBtn) ccBtn.addEventListener('click', function () {
      var on = ccBtn.getAttribute('aria-pressed') !== 'true';
      ccBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      ccBtn.classList.toggle('is-off', !on);
      if (cap) cap.classList.toggle('cc-hidden', !on);
    });
    if (playBtn) playBtn.addEventListener('click', play);
    if (ppBtn) ppBtn.addEventListener('click', function () { if (v.paused) play(); else v.pause(); });
    if (seek) {
      seek.addEventListener('input', function () { seeking = true; if (v.duration) { v.currentTime = seek.value / 1000 * v.duration; setCap(v.currentTime); if (curEl) curEl.textContent = fmt(v.currentTime); } });
      seek.addEventListener('change', function () { seeking = false; });
    }
    if (volEl) volEl.addEventListener('input', function () { v.volume = volEl.value / 100; v.muted = (v.volume === 0); if (muteBtn) muteBtn.textContent = v.muted ? '🔇' : '🔊'; });
    if (muteBtn) muteBtn.addEventListener('click', function () { v.muted = !v.muted; muteBtn.textContent = v.muted ? '🔇' : '🔊'; if (volEl) volEl.value = v.muted ? 0 : Math.round(v.volume * 100); });
    if (fullBtn) fullBtn.addEventListener('click', function () {
      var el = screen.querySelector('.videoscreen') || v;
      if (document.fullscreenElement) { document.exitFullscreen(); }
      else if (el.requestFullscreen) { el.requestFullscreen(); }
      else if (v.webkitEnterFullscreen) { v.webkitEnterFullscreen(); }
    });

    v.addEventListener('loadedmetadata', function () { if (durEl) durEl.textContent = fmt(v.duration); });
    v.addEventListener('play',  function () { if (playBtn) playBtn.classList.add('hidden'); if (ppBtn) ppBtn.textContent = PAUSE; if (raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); });
    v.addEventListener('pause', function () { if (ppBtn) ppBtn.textContent = PLAY; });
    v.addEventListener('ended', function () { if (playBtn) playBtn.classList.remove('hidden'); if (ppBtn) ppBtn.textContent = PLAY; setCap(1e9); screen._videoDone = true; updateChrome(); if (submitBtn) submitBtn.hidden = false; });
    v.addEventListener('seeked', function () { setCap(v.currentTime); });
    v.addEventListener('timeupdate', function () { if (v.paused) syncBar(); });

    screen._onEnter = function () {
      try { v.pause(); v.currentTime = 0; } catch (e) {}
      if (playBtn) playBtn.classList.remove('hidden');
      if (ppBtn) ppBtn.textContent = PLAY;
      if (seek) seek.value = 0;
      if (curEl) curEl.textContent = fmt(0);
      if (durEl && v.duration) durEl.textContent = fmt(v.duration);
      if (submitBtn) submitBtn.hidden = true;
      if (endcard) endcard.hidden = true;
      setCap(0);
    };
    screen._onLeave = function () { if (raf) cancelAnimationFrame(raf); try { v.pause(); } catch (e) {} };
  }

  /* NOTE: every question screen's check button + feedback position is now hand-tuned
     via inline styles directly in index.html. A legacy layoutQuestions() auto-layout
     helper used to run here and force-override those positions on every load/font-ready
     event (computed from the options block's height) — removed because it was silently
     clobbering all the hand-placed coordinates. Do not re-add generic auto-positioning
     for .btn--check / .feedback without excluding screens with explicit inline top/left. */

  /* ---------- question progress bars: build the numbered circles ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('.qprogress'), function (ol) {
    var total = +ol.getAttribute('data-total') || 8;
    var active = +ol.getAttribute('data-active');
    for (var n = 1; n <= total; n++) {
      var li = document.createElement('li');
      li.textContent = n;
      if (n === active) { li.className = 'is-active'; li.setAttribute('aria-current', 'step'); }
      ol.appendChild(li);
    }
  });

  /* ---------- applet iframes: auto-fit height to content (no scrollbar) ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('iframe.applet-frame'), function (f) {
    if (f.hasAttribute('data-fixed-height')) return;   // sized to a box in the layout; the applet fits itself to it
    f.addEventListener('load', function () {
      try {
        var d = f.contentDocument || f.contentWindow.document;
        var h = Math.max(d.body.scrollHeight, d.documentElement.scrollHeight);
        if (h > 50) f.style.height = h + 'px';
      } catch (e) { /* opaque origin (file://) — keep the fixed fallback height */ }
    });
  });

  /* ---------- POPUP MODALS (e.g. Q2ב method applet) ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('[data-modal]'), function (btn) {
    var m = document.getElementById(btn.getAttribute('data-modal'));
    if (!m) return;
    btn.addEventListener('click', function () { m.hidden = false; btn.classList.add('method-used'); });
    m.addEventListener('click', function (e) { if (e.target === m) m.hidden = true; });
    var x = m.querySelector('.modal__close');
    if (x) x.addEventListener('click', function () { m.hidden = true; });
  });

  /* ---------- GLOSSARY TOOLTIPS (a link inline with a label's text toggles a short-definition bubble) ---------- */
  (function () {
    var links = Array.prototype.slice.call(document.querySelectorAll('.gloss-link'));
    function closeAll() {
      links.forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
      Array.prototype.forEach.call(document.querySelectorAll('.gloss-tip'), function (t) { t.hidden = true; });
    }
    links.forEach(function (btn) {
      // the tip is looked up by aria-controls: it is rarely the link's immediate
      // sibling (the link usually sits mid-sentence inside a <p>)
      var tip = document.getElementById(btn.getAttribute('aria-controls') || '');
      if (!tip || !tip.classList.contains('gloss-tip')) return;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var wasOpen = !tip.hidden;
        closeAll();
        if (!wasOpen) { tip.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
      });
    });
    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('.gloss-link')) return;
      closeAll();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(); });
  })();

  /* ---------- 4. END SCREEN ---------- */
  function showScore() {
    var el = document.getElementById('final-score');
    if (el) el.textContent = Math.round(earned);
    if (window.lomdaState) window.lomdaState.score = earned;
    if (window.SCORM) window.SCORM.complete(earned, MASTERY);   // final score + pass/fail (no-op if no LMS)
    try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'LOMDA_COMPLETE', score: Math.round(earned) }, '*'); } catch (e) {}
  }
  var end = document.querySelector('.screen[data-type="end"]');
  if (end) {
    var restart = end.querySelector('.btn--restart');
    if (restart) restart.addEventListener('click', function () { location.reload(); });
  }

  // hide all revealable elements up front, then float in the first screen's
  screens.forEach(function (s) {
    Array.prototype.forEach.call(s.querySelectorAll(REVEAL_SEL), function (el) {
      el.classList.add('float-in');
    });
  });

  // DEV: jump straight to a screen via #s=NN (used by dev_index.html previewer)
  var hm = (location.hash || '').match(/s=([\w]+)/);
  if (hm) {
    for (var hi = 0; hi < screens.length; hi++) {
      if (screens[hi].getAttribute('data-screen') === hm[1]) {
        screens[current].classList.remove('active');
        screens[current].setAttribute('aria-hidden', 'true');
        current = hi;
        screens[hi].classList.add('active');
        screens[hi].setAttribute('aria-hidden', 'false');
        break;
      }
    }
  }

  updateChrome();
  revealScreen(screens[current]);
  if (screens[current]._onEnter) screens[current]._onEnter();
})();
