/* Paste into Cookiebot's JavaScript field without <script> tags.
   The banner delegates consent storage and script blocking to Cookiebot. */
(function () {
  'use strict';
  if (!document.getElementById('spenton-cookie-banner-style')) {
    var stylesheet = document.createElement('link');
    stylesheet.id = 'spenton-cookie-banner-style';
    stylesheet.rel = 'stylesheet';
    stylesheet.href = '/consent/spenton-banner.css';
    document.head.appendChild(stylesheet);
  }
  if (window.SpentOnCookieBanner) window.SpentOnCookieBanner.destroy();
  var controller = new AbortController();
  var options = { signal: controller.signal };
  var returnFocus = null;
  var initialized = null;
  var pendingSave = null;
  var saveTimeout = null;
  function banner() { return document.getElementById('spenton-cookie-banner'); }
  function gpc() { return navigator.globalPrivacyControl === true; }
  function apiReady() { return !!window.Cookiebot && typeof window.Cookiebot.submitCustomConsent === 'function' && typeof window.Cookiebot.hide === 'function'; }
  function input(kind) { return document.getElementById('spenton-cookie-' + kind); }
  function refresh() {
    var root = banner();
    if (!root || pendingSave) return;
    if (initialized !== root) {
      initialized = root;
      var pipImage = root.querySelector('.so-cookie-pip');
      if (pipImage && !pipImage.src.startsWith('data:')) pipImage.src = '/brand/pip-small.png';
      var details = document.getElementById('spenton-cookie-details');
      details.addEventListener('toggle', function () { root.querySelector('[data-so-action="save"]').hidden = !details.open; }, options);
    }
    var consent = window.Cookiebot && window.Cookiebot.hasResponse ? window.Cookiebot.consent : null;
    ['preferences', 'statistics', 'marketing'].forEach(function (kind) {
      input(kind).checked = !!(consent && consent[kind]) && !(kind === 'marketing' && gpc());
      input(kind).disabled = !apiReady() || (kind === 'marketing' && gpc());
    });
    root.querySelectorAll('button').forEach(function (button) { button.disabled = button.dataset.soAction !== 'close' && !apiReady(); });
    document.getElementById('spenton-cookie-gpc').hidden = !gpc();
    input('marketing').setAttribute('aria-describedby', gpc() ? 'spenton-cookie-gpc' : '');
    root.querySelector('[data-so-action="accept"]').textContent = gpc() ? 'Accept permitted' : 'Accept optional';
  }
  function display() {
    var root = banner(); if (!root) return;
    if (!root.contains(document.activeElement)) returnFocus = document.activeElement;
    root.hidden = false;
    document.getElementById('spenton-cookie-error').hidden = true;
    refresh();
    // Non-modal: Tab may leave the banner. Escape closes without consenting.
    document.getElementById('spenton-cookie-title').focus({ preventScroll: true });
  }
  function close() {
    if (pendingSave) return;
    var root = banner(); if (!root) return;
    if (window.Cookiebot && typeof window.Cookiebot.hide === 'function') window.Cookiebot.hide();
    root.hidden = true;
    if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') returnFocus.focus({ preventScroll: true });
  }
  function saving(active) {
    var root = banner();
    root.setAttribute('aria-busy', String(active));
    root.querySelectorAll('button, input').forEach(function (control) { control.disabled = active; });
    root.querySelector('[data-so-action="save"]').textContent = active ? 'Saving…' : 'Save my choices';
  }
  function saveFailed() {
    clearTimeout(saveTimeout);
    pendingSave = null;
    saving(false);
    // Preserve the selected switches for retry; do not refresh from old consent.
    input('marketing').disabled = gpc();
    banner().hidden = false;
    document.getElementById('spenton-cookie-error').hidden = false;
  }
  function consentReady() {
    if (!pendingSave) { refresh(); return; }
    var consent = window.Cookiebot && window.Cookiebot.consent;
    if (!window.Cookiebot.hasResponse || !consent || !['preferences', 'statistics', 'marketing'].every(function (kind, index) { return !!consent[kind] === pendingSave[index]; })) return;
    clearTimeout(saveTimeout);
    pendingSave = null;
    saving(false);
    refresh();
    close();
  }
  function submit(action) {
    if (pendingSave) return;
    if (!apiReady()) { document.getElementById('spenton-cookie-error').hidden = false; return; }
    var values = ['preferences', 'statistics', 'marketing'].map(function (kind) {
      return action === 'accept' || (action === 'save' && input(kind).checked);
    });
    if (gpc()) values[2] = false;
    pendingSave = values;
    document.getElementById('spenton-cookie-error').hidden = true;
    saving(true);
    saveTimeout = setTimeout(saveFailed, 10000);
    try {
      // Cookiebot confirms persistence asynchronously through ConsentReady.
      window.Cookiebot.submitCustomConsent(values[0], values[1], values[2]);
    } catch (error) {
      saveFailed();
    }
  }
  document.addEventListener('click', function (event) {
    var root = banner();
    if (!root || !(event.target instanceof Element)) return;
    var button = event.target.closest('[data-so-action]');
    if (!button || !root.contains(button) || button.disabled) return;
    event.preventDefault();
    if (button.dataset.soAction === 'close') close(); else submit(button.dataset.soAction);
  }, options);
  document.addEventListener('keydown', function (event) {
    var root = banner();
    if (event.key === 'Escape' && root && !root.hidden && root.contains(event.target)) { event.preventDefault(); event.stopPropagation(); close(); }
  }, options);
  window.addEventListener('CookiebotOnDialogDisplay', display, options);
  window.addEventListener('CookiebotOnConsentReady', consentReady, options);
  document.addEventListener('DOMContentLoaded', refresh, options);
  window.SpentOnShowCookieBanner = display;
  window.SpentOnHideCookieBanner = function () { var root = banner(); if (root && !pendingSave) root.hidden = true; };
  window.SpentOnCookieBanner = { destroy: function () { clearTimeout(saveTimeout); controller.abort(); } };
  refresh();
}());


