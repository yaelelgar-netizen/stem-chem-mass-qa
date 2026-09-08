/* =====================================================================
   Minimal SCORM 1.2 run-time wrapper (matches the example package:
   ADL SCORM 1.2, mastery score 80). Safe no-op when opened outside an LMS.

   Includes resume support: saves where the student was (cmi.core.lesson_
   location) and what they'd done (cmi.suspend_data, free-form JSON) so
   closing the lomda and reopening it later — even on a different device,
   since this is stored by the LMS against the student's own account, not
   the browser — picks back up instead of starting over. script.js reads
   these on load and writes to them at each screen change / answered
   question; this wrapper only knows how to get/set the two SCORM fields,
   not the shape of the lomda's own state.
   ===================================================================== */
window.SCORM = (function () {
  'use strict';
  var api = null, ready = false;

  function findAPI(win) {
    var tries = 0;
    while (win && !win.API && win.parent && win.parent !== win && tries < 12) {
      win = win.parent; tries++;
    }
    return (win && win.API) ? win.API : null;
  }
  function getAPI() {
    var a = findAPI(window);
    if (!a && window.opener) a = findAPI(window.opener);
    return a;
  }
  function safeGet(name, fallback) {
    if (!ready) return fallback;
    var v = api.LMSGetValue(name);
    return (v === undefined || v === null || v === '') ? fallback : v;
  }

  return {
    init: function () {
      api = getAPI();
      if (!api) return false;                     // not in an LMS — stay a no-op
      ready = (api.LMSInitialize('') === 'true');
      if (ready) {
        if (api.LMSGetValue('cmi.core.lesson_status') === 'not attempted')
          api.LMSSetValue('cmi.core.lesson_status', 'incomplete');
        api.LMSSetValue('cmi.core.score.min', '0');
        api.LMSSetValue('cmi.core.score.max', '100');
        api.LMSCommit('');
      }
      return ready;
    },
    isReady: function () { return ready; },
    setScore: function (raw) {
      if (!ready) return;
      api.LMSSetValue('cmi.core.score.raw', String(Math.round(raw)));
      api.LMSCommit('');
    },
    complete: function (raw, mastery) {
      if (!ready) return;
      api.LMSSetValue('cmi.core.score.raw', String(Math.round(raw)));
      api.LMSSetValue('cmi.core.lesson_status', raw >= mastery ? 'passed' : 'failed');
      api.LMSCommit('');
    },
    finish: function () {
      if (!ready) return;
      api.LMSFinish('');
      ready = false;
    },

    /* ---- resume support ----
       lesson_location: a simple bookmark (we store the 1-based screen number).
       suspend_data: free-form string (we store a small JSON blob — which
       questions are answered and the running score) — SCORM 1.2 caps this
       at 4096 chars, so saveSuspendData silently skips saving if the
       caller's object ever grows past a safe margin under that. */
    getLocation: function () {
      return safeGet('cmi.core.lesson_location', '');
    },
    saveLocation: function (loc) {
      if (!ready) return;
      api.LMSSetValue('cmi.core.lesson_location', String(loc || ''));
      api.LMSCommit('');
    },
    getSuspendData: function () {
      var raw = safeGet('cmi.suspend_data', '');
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (e) { return null; }
    },
    saveSuspendData: function (obj) {
      if (!ready) return;
      var raw;
      try { raw = JSON.stringify(obj); } catch (e) { return; }
      if (raw.length > 4000) return;   // stay safely under the SCORM 1.2 4096-char cap
      api.LMSSetValue('cmi.suspend_data', raw);
      api.LMSCommit('');
    }
  };
})();

window.addEventListener('load', function () {
  window.SCORM.init();
  // fires whether or not an LMS was actually found — script.js's resume
  // logic checks isReady()/getSuspendData() itself, so it stays a safe
  // no-op standalone (e.g. opened directly, or inside the QA harness)
  try { window.dispatchEvent(new Event('scorm:ready')); } catch (e) {}
});
window.addEventListener('unload', function () { window.SCORM.finish(); });
