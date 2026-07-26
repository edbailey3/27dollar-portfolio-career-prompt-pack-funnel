// ---------- GLOBAL GTAG SAFETY FALLBACK ----------
if (typeof window !== 'undefined') {
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };
}

// ---------- DETERMINISTIC CLIENT-SIDE EVENT ID GENERATOR & DUAL TELEMETRY S2S SINGLE SOURCE OF TRUTH ----------
const createEventId = (type) => `${type}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

function getCookie(name) {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

const getFbp = () => getCookie('_fbp');
const getFbc = () => getCookie('_fbc');
const getTtclid = () => getCookie('ttclid') || getCookie('_ttclid');

function getTestEventCode() {
  if (typeof window === 'undefined') return null;
  try {
    var urlParams = new URLSearchParams(window.location.search);
    var testCode = urlParams.get('tt_test_code') || urlParams.get('test_event_code');
    if (testCode) {
      sessionStorage.setItem('pcs_test_event_code', testCode);
      return testCode;
    }
    return sessionStorage.getItem('pcs_test_event_code') || null;
  } catch (e) {
    return null;
  }
}

function getOrCreateExternalId() {
  if (typeof window === 'undefined') return null;
  try {
    let extId = localStorage.getItem('pcs_external_id');
    if (!extId) {
      extId = 'ext_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
      localStorage.setItem('pcs_external_id', extId);
    }
    return extId;
  } catch (e) {
    return 'ext_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
  }
}

async function hashAndPersistEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) return null;

  try {
    sessionStorage.setItem('pcs_customer_email', cleanEmail);
  } catch (e) { /* storage disabled */ }

  let hashed = null;
  try {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
      const msgBuffer = new TextEncoder().encode(cleanEmail);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      hashed = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) { /* subtle crypto unavailable */ }

  if (hashed) {
    try {
      localStorage.setItem('pcs_external_id', hashed);
    } catch (e) { /* storage disabled */ }
    if (typeof fbq === 'function') {
      fbq('set', 'userData', { external_id: hashed, em: hashed });
    }
    return hashed;
  }
  return getOrCreateExternalId();
}

function sendCAPIEvent(eventName, eventId, customData = {}, email = '') {
  try {
    const payload = {
      eventName: eventName,
      eventId: eventId,
      email: email,
      externalId: getOrCreateExternalId(),
      fbp: getFbp(),
      fbc: getFbc(),
      ttclid: getTtclid(),
      test_event_code: getTestEventCode(),
      eventSourceUrl: typeof window !== 'undefined' ? window.location.href : '',
      customData: customData
    };

    fetch('/api/capi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(function(err) {
      console.warn('Dual CAPI client dispatch failed (non-fatal):', err);
    });
  } catch (err) {
    console.warn('sendCAPIEvent error:', err);
  }
}

function sanitizePixelId(id) {
  if (!id) return '';
  return String(id).replace(/['"]/g, '').trim();
}

function getGA4CartPayload() {
  var items = [{
    item_id: 'pcs_prompt_pack',
    item_name: 'Portfolio Career AI Prompt Pack',
    price: 27.00,
    quantity: 1
  }];
  var value = 27.00;

  if (typeof document !== 'undefined') {
    var b1 = document.getElementById('bump1-check');
    if (b1 && b1.checked) {
      items.push({
        item_id: 'pcs_bump_reset_checklist',
        item_name: 'Career Reset Checklist',
        price: 17.00,
        quantity: 1
      });
      value += 17.00;
    }

    var b2 = document.getElementById('bump2-check');
    if (b2 && b2.checked) {
      items.push({
        item_id: 'pcs_bump_pricing_calc',
        item_name: 'Portfolio Career Pricing Calculator',
        price: 12.00,
        quantity: 1
      });
      value += 12.00;
    }
  }

  return {
    currency: 'USD',
    value: Number(value.toFixed(2)),
    items: items
  };
}

if (typeof window !== 'undefined') {
  window.createEventId = createEventId;
  window.getFbp = getFbp;
  window.getFbc = getFbc;
  window.getTtclid = getTtclid;
  window.getTestEventCode = getTestEventCode;
  window.getOrCreateExternalId = getOrCreateExternalId;
  window.hashAndPersistEmail = hashAndPersistEmail;
  window.sendCAPIEvent = sendCAPIEvent;
  window.getGA4CartPayload = getGA4CartPayload;
  window.sanitizePixelId = sanitizePixelId;
}

// Synchronized PageView & ViewContent Meta/TikTok Pixel & Dual CAPI tracking
(function trackPageViewAndContent() {
  if (typeof window === 'undefined') return;
  const sanitizeId = (id) => String(id || '').replace(/['"]/g, '').trim();
  const currentEventId = createEventId('pv');
  const extId = sanitizeId(getOrCreateExternalId());

  const path = window.location.pathname;
  const isCheckoutPage = path.endsWith('/checkout.html') || path === '/checkout';
  const isLandingPage = path === '/' || path.endsWith('/index.html') || path === '';
  const isUpsellPage = path.endsWith('/upsell.html') || path === '/upsell';

  // 1. GA4 Funnel Events (Top Priority - Fail-Safe Synchronous Dispatch)
  if (isCheckoutPage) {
    try {
      if (typeof gtag === 'function') {
        gtag('event', 'begin_checkout', getGA4CartPayload());
      }
    } catch(err) {
      console.warn('GA4 begin_checkout warning:', err);
    }
  }

  if (isLandingPage) {
    try {
      if (typeof gtag === 'function') {
        gtag('event', 'view_item', {
          currency: 'USD',
          value: 27.00,
          items: [{ item_id: 'pcs_prompt_pack', item_name: 'Portfolio Career AI Prompt Pack', price: 27.00, quantity: 1 }]
        });
      }
    } catch(err) {
      console.warn('GA4 landing view_item warning:', err);
    }
  }

  if (isUpsellPage) {
    try {
      if (typeof gtag === 'function') {
        gtag('event', 'view_item', {
          currency: 'USD',
          value: 47.00,
          items: [{ item_id: 'spiderweb-brain-notion-os', item_name: 'Spider-Web Brain Notion OS', price: 47.00, quantity: 1 }]
        });
      }
    } catch(err) {
      console.warn('GA4 upsell view_item warning:', err);
    }
  }

  // 2. Meta Pixel PageView (Isolated Try/Catch)
  try {
    if (typeof fbq === 'function') {
      if (extId) fbq('set', 'userData', { external_id: sanitizeId(extId) });
      fbq('track', 'PageView', {}, { eventID: currentEventId });
    }
  } catch(err) {
    console.warn('Meta PageView pixel warning:', err);
  }

  // 3. TikTok Pixel PageView (Isolated Try/Catch)
  try {
    if (typeof ttq === 'object' && typeof ttq.track === 'function') {
      ttq.track('PageView', {}, { event_id: currentEventId });
    }
  } catch(err) {
    console.warn('TikTok PageView pixel warning:', err);
  }

  // 4. Dual CAPI S2S PageView (Isolated Try/Catch)
  try {
    sendCAPIEvent('PageView', currentEventId);
  } catch(err) {
    console.warn('CAPI PageView warning:', err);
  }

  // 5. Landing Page Ad Engine ViewContent (Isolated Try/Catch)
  if (isLandingPage) {
    const vcEventId = createEventId('vc');
    const vcData = { content_id: 'pcs_prompt_pack', value: 27.00, currency: 'USD', content_name: 'Portfolio Career Prompt Pack', content_type: 'product' };

    try {
      if (typeof fbq === 'function') {
        fbq('track', 'ViewContent', vcData, { eventID: vcEventId });
      }
    } catch(err) {
      console.warn('Meta ViewContent warning:', err);
    }

    try {
      if (typeof ttq === 'object' && typeof ttq.track === 'function') {
        ttq.track('ViewContent', { content_id: 'pcs_prompt_pack', value: 27.00, currency: 'USD' }, { event_id: vcEventId });
      }
    } catch(err) {
      console.warn('TikTok ViewContent warning:', err);
    }

    try {
      sendCAPIEvent('ViewContent', vcEventId, vcData);
    } catch(err) {
      console.warn('CAPI ViewContent warning:', err);
    }
  }

  // Auto-capture ?email= or ?tt_test_code= URL params if present
  try {
    var urlParams = new URLSearchParams(window.location.search);
    var emailParam = urlParams.get('email');
    if (emailParam) {
      hashAndPersistEmail(emailParam);
    }
    var testCodeParam = urlParams.get('tt_test_code') || urlParams.get('test_event_code');
    if (testCodeParam) {
      sessionStorage.setItem('pcs_test_event_code', testCodeParam);
    }
  } catch (e) { /* URLSearchParams unavailable */ }
})();


// ---------- ATTRIBUTION PARAMETER PERSISTENCE & FORWARDING ----------
(function captureAndPersistAttributionParams() {
  if (typeof window === 'undefined') return;

  var ATTRIBUTION_KEYS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'fbclid', 'gclid', 'ttclid', 'msclkid'
  ];

  // FIX: sessionStorage read/write fully wrapped — guards against SecurityError
  // in Safari/Brave Private Mode where sessionStorage access throws synchronously.
  function safeSessionSet(key, value) {
    try { sessionStorage.setItem(key, value); } catch (e) { /* storage disabled */ }
  }
  function safeSessionGet(key) {
    try { return sessionStorage.getItem(key); } catch (e) { return null; }
  }

  try {
    var urlParams = new URLSearchParams(window.location.search);
    ATTRIBUTION_KEYS.forEach(function(key) {
      if (urlParams.has(key)) {
        safeSessionSet('attr_' + key, urlParams.get(key));
      }
    });
  } catch (e) {
    // URLSearchParams failed — non-critical, continue
  }

  // Reattach persisted params to internal CTA links on DOM ready
  // FIX: inner callback wrapped in its own try/catch — isolated from outer IIFE
  document.addEventListener('DOMContentLoaded', function() {
    try {
      var storedParams = new URLSearchParams();
      ATTRIBUTION_KEYS.forEach(function(key) {
        var val = safeSessionGet('attr_' + key);
        if (val) storedParams.set(key, val);
      });

      if (!storedParams.toString()) return;

      var links = document.querySelectorAll('a[href*="checkout.html"], a[href*="upsell.html"]');
      links.forEach(function(link) {
        try {
          var hrefUrl = new URL(link.href, window.location.origin);
          storedParams.forEach(function(v, k) {
            if (!hrefUrl.searchParams.has(k)) hrefUrl.searchParams.set(k, v);
          });
          link.href = hrefUrl.toString();
        } catch (e) { /* URL parse failed for this link */ }
      });
    } catch (err) {
      console.warn('Attribution link reattach error:', err);
    }
  });
})();


// ---------- FAQ accordion (sales page + upsell page) ----------
function attachFAQListeners(){
  var items = document.querySelectorAll('.faq-item');
  items.forEach(function(item){
    var q = item.querySelector('.faq-q');
    var a = item.querySelector('.faq-a');
    if(!q || !a) return;
    q.addEventListener('click', function(){
      var isOpen = item.classList.toggle('open');
      q.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      a.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    });
  });
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', attachFAQListeners);
} else {
  attachFAQListeners();
}


// ---------- CHECKOUT PAGE: order bump pricing ----------
var PRICES = {
  base: 27,
  bump1: 17,
  bump2: 12
};

var currentTotalAmount = PRICES.base;

function toggleBump(boxId, checkboxId, evt){
  var box = document.getElementById(boxId);
  var checkbox = document.getElementById(checkboxId);
  if(!box || !checkbox) return;

  var e = evt || (typeof window !== 'undefined' ? window.event : null);

  // If the click came from the row itself (not the checkbox), flip it manually
  if(e && e.target && e.target.id !== checkboxId){
    checkbox.checked = !checkbox.checked;
  }

  box.classList.toggle('checked', checkbox.checked);
  updateTotal();
}

function updateTotal(){
  var totalEl = document.getElementById('total-amount');
  var summaryEl = document.getElementById('bump-summary');
  if(!totalEl) return; // not on checkout page

  var total = PRICES.base;
  var lines = '';

  var b1 = document.getElementById('bump1-check');
  var b2 = document.getElementById('bump2-check');

  if(b1 && b1.checked){
    total += PRICES.bump1;
    lines += bumpLineHTML('Career Reset Checklist', PRICES.bump1);
  }
  if(b2 && b2.checked){
    total += PRICES.bump2;
    lines += bumpLineHTML('Pricing Calculator', PRICES.bump2);
  }

  // FIX: Use textContent-safe assignment — summaryEl.innerHTML only receives
  // output from bumpLineHTML which is now built with escaped text nodes (see below)
  if(summaryEl) summaryEl.innerHTML = lines;
  totalEl.innerHTML = '$' + total + '<span> USD</span>';
  currentTotalAmount = total;
}

function bumpLineHTML(name, price){
  // FIX: Escape name before injecting into innerHTML to prevent any future XSS
  // if name is ever externally supplied. Price is always numeric — safe.
  var safeName = String(name)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return '<div class="product-line" style="border-bottom:1px dashed #3A362D; padding-bottom:14px; margin-bottom:14px;">' +
           '<div class="product-thumb" style="background:var(--coral); color:var(--paper); font-size:12px;">+</div>' +
           '<div><h3 style="font-size:14px;">' + safeName + '</h3><p>Order bump</p></div>' +
           '<div class="price">$' + Number(price) + '</div>' +
         '</div>';
}

// initialize total on load if on checkout page
if(document.getElementById('total-amount')){
  updateTotal();
}

// ---------- CHECKOUT PAGE: pre-checkout email capture & Kit lead sync ----------
function initPreCheckoutLeadCapture(){
  var buyerEmailInput = document.getElementById('customer-email');
  if(!buyerEmailInput) return;

  function handlePreCheckoutLead(){
    var email = buyerEmailInput.value.trim().toLowerCase();
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if(!emailRegex.test(email)) return;

    hashAndPersistEmail(email);

    // Fire InitiateCheckout on lead capture if not sent yet for this session
    var isIcSent = false;
    try { isIcSent = sessionStorage.getItem('pcs_ic_sent') === 'true'; } catch(e) {}
    if (!isIcSent) {
      try { sessionStorage.setItem('pcs_ic_sent', 'true'); } catch(e) {}
      var icLeadEventId = createEventId('ic_lead');
      var icLeadData = { currency: 'USD', value: 27.00, content_id: 'pcs_prompt_pack', content_name: 'Portfolio Career School Offer', content_type: 'product' };
      if (typeof fbq === 'function') {
        fbq('track', 'InitiateCheckout', icLeadData, { eventID: icLeadEventId });
      }
      if (typeof ttq === 'object' && typeof ttq.track === 'function') {
        ttq.track('InitiateCheckout', { value: 27.00, currency: 'USD', content_id: 'pcs_prompt_pack' }, { event_id: icLeadEventId });
      }
      sendCAPIEvent('InitiateCheckout', icLeadEventId, icLeadData, email);
    }

    var isSent = false;
    try {
      isSent = sessionStorage.getItem('pcs_lead_sent') === 'true';
    } catch(e) { /* storage disabled */ }

    if(!isSent){
      try {
        sessionStorage.setItem('pcs_lead_sent', 'true');
      } catch(e) { /* storage disabled */ }

      fetch('/api/checkout-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      }).catch(function(err){
        console.warn('Pre-checkout lead sync failed (non-fatal):', err);
      });
    }
  }

  buyerEmailInput.addEventListener('blur', handlePreCheckoutLead);
  buyerEmailInput.addEventListener('change', handlePreCheckoutLead);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPreCheckoutLeadCapture);
} else {
  initPreCheckoutLeadCapture();
}




// ---------- UPSELL PAGE: accept / decline ----------
var isUpsellProcessed = false;

function acceptUpsell(){
  if (isUpsellProcessed) return;
  isUpsellProcessed = true;

  var baseOrderId = null;
  var customerEmail = '';
  try {
    baseOrderId = sessionStorage.getItem('pcs_base_order_id');
    customerEmail = sessionStorage.getItem('pcs_customer_email') || '';
  } catch(e) { /* storage disabled */ }

  var upsellOrderId = baseOrderId ? ('upsell_' + baseOrderId) : createEventId('pur_upsell');
  var upsellValue = 47.00;
  var upsellCustomData = {
    currency: 'USD',
    value: upsellValue,
    content_name: 'Spider-Web Brain Notion OS',
    content_ids: ['spiderweb-brain-notion-os'],
    content_type: 'product'
  };

  if (typeof fbq === 'function') {
    fbq('track', 'Purchase', upsellCustomData, { eventID: upsellOrderId });
  }
  if (typeof ttq === 'object' && typeof ttq.track === 'function') {
    ttq.track('CompletePayment', { value: upsellValue, currency: 'USD', content_id: 'spiderweb-brain-notion-os' }, { event_id: upsellOrderId });
  }
  if (typeof gtag === 'function') {
    gtag('event', 'purchase', {
      transaction_id: upsellOrderId,
      currency: 'USD',
      value: 47.00,
      items: [{ item_id: 'spiderweb-brain-notion-os', item_name: 'Spider-Web Brain Notion OS', price: 47.00, quantity: 1 }]
    });
  }
  sendCAPIEvent('Purchase', upsellOrderId, upsellCustomData, customerEmail);

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    'event': 'upsell_completed',
    'transactionId': upsellOrderId,
    'value': upsellValue,
    'currency': 'USD'
  });

  showConfirm(
    "You're all set.",
    "The Portfolio Career Prompt Pack + Spider-Web Brain Notion OS are both headed to your inbox. Check your email for download links."
  );
}

function declineUpsell(){
  showConfirm(
    "You're in.",
    "Your Portfolio Career Prompt Pack is headed to your inbox now. Check your email for the download link."
  );
}

function showConfirm(title, text){
  var offer        = document.getElementById('offer-panel');
  var confirm      = document.getElementById('confirm-panel');
  var confirmTitle = document.getElementById('confirm-title');
  var confirmText  = document.getElementById('confirm-text');

  // FIX: Guard ALL four elements, not just the first two
  if(!offer || !confirm || !confirmTitle || !confirmText) return;

  confirmTitle.textContent = title;
  confirmText.textContent  = text;
  offer.style.display = 'none';
  confirm.classList.add('show');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}


// ---------- PAYPAL SECURE DISPATCH INFRASTRUCTURE ----------
// FIX: Deferred inside DOMContentLoaded to eliminate the temporal dead zone where
// `paypal` global might be undefined if SDK hasn't executed yet. Guard added.
document.addEventListener('DOMContentLoaded', function() {
  var container = document.getElementById('paypal-button-container');
  if (!container) return; // Not on checkout page — exit cleanly

  // FIX: Explicit PayPal SDK availability guard before calling paypal.Buttons()
  if (typeof paypal === 'undefined') {
    console.error('PayPal SDK not loaded. Cannot initialize checkout buttons.');
    container.innerHTML = '<p style="color:#cc0000; font-size:14px; text-align:center;">Payment system failed to load. Please refresh the page.</p>';
    return;
  }

  paypal.Buttons({
    style: {
      layout: 'vertical',
      color:  'gold',
      shape:  'rect',
      label:  'paypal'
    },

    onClick: function(data, actions) {
      var emailEl = document.getElementById('customer-email');
      var emailInput = emailEl ? emailEl.value.trim().toLowerCase() : '';
      var errorEl = document.getElementById('email-error');

      if (!emailInput || !emailInput.includes('@')) {
        if (errorEl) errorEl.style.display = 'block';
        if (emailEl) emailEl.focus();
        return actions.reject();
      }

      if (errorEl) errorEl.style.display = 'none';

      // Synchronized InitiateCheckout & AddPaymentInfo Meta/TikTok Pixel & CAPI firing
      var icEventId = createEventId('ic');
      var apiEventId = createEventId('api');
      var icValue = currentTotalAmount || 27.00;
      var icCustomData = {
        currency: 'USD',
        value: icValue,
        content_name: 'Portfolio Career School Offer',
        content_ids: ['pcs-prompt-pack'],
        content_type: 'product'
      };

      if (typeof fbq === 'function') {
        fbq('track', 'InitiateCheckout', icCustomData, { eventID: icEventId });
        fbq('track', 'AddPaymentInfo', icCustomData, { eventID: apiEventId });
      }
      if (typeof ttq === 'object' && typeof ttq.track === 'function') {
        ttq.track('InitiateCheckout', { value: icValue, currency: 'USD', content_id: 'pcs-prompt-pack' }, { event_id: icEventId });
        ttq.track('AddPaymentInfo', { value: icValue, currency: 'USD', content_id: 'pcs-prompt-pack' }, { event_id: apiEventId });
      }
      if (typeof gtag === 'function') {
        gtag('event', 'add_payment_info', getGA4CartPayload());
      }
      sendCAPIEvent('InitiateCheckout', icEventId, icCustomData, emailInput);
      sendCAPIEvent('AddPaymentInfo', apiEventId, icCustomData, emailInput);

      return actions.resolve();
    },

    createOrder: function(data, actions) {
      var b1 = !!(document.getElementById('bump1-check') || {}).checked;
      var b2 = !!(document.getElementById('bump2-check') || {}).checked;
      var selectedAmount = (27 + (b1 ? 17 : 0) + (b2 ? 12 : 0)).toFixed(2);

      return fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bump1: b1, bump2: b2, amount: selectedAmount })
      })
      .then(function(res) {
        if (!res.ok) throw new Error('Create order request failed with status ' + res.status);
        return res.json();
      })
      .then(function(order) {
        if (!order || !order.id) throw new Error('PayPal order ID missing in response');
        return order.id;
      })
      // FIX: Catch so PayPal SDK gets a rejection signal and can show its own error UI
      .catch(function(err) {
        console.error('createOrder failed:', err);
        return actions.reject();
      });
    },

    onApprove: function(data, actions) {
      var emailEl = document.getElementById('customer-email');
      var customerEmail = emailEl ? emailEl.value.trim().toLowerCase() : '';

      // Idempotency check: Guard against double-fires from multi-clicks or duplicate SDK events
      var isAlreadyProcessed = false;
      try {
        isAlreadyProcessed = sessionStorage.getItem('pcs_purchase_processed_' + data.orderID) === 'true';
      } catch(e) { /* storage disabled */ }

      if (window.isBasePurchaseProcessed || isAlreadyProcessed) {
        console.warn('Purchase already processed for order:', data.orderID);
        window.location.href = '/upsell.html';
        return Promise.resolve();
      }
      window.isBasePurchaseProcessed = true;
      try {
        sessionStorage.setItem('pcs_purchase_processed_' + data.orderID, 'true');
        sessionStorage.setItem('pcs_base_order_id', data.orderID);
        if (customerEmail) sessionStorage.setItem('pcs_customer_email', customerEmail);
      } catch(e) { /* storage disabled */ }

      hashAndPersistEmail(customerEmail);

      return fetch('/api/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderID: data.orderID,
          email: customerEmail,
          externalId: getOrCreateExternalId(),
          test_event_code: getTestEventCode()
        })
      })
      .then(function(res) {
        if (!res.ok) throw new Error('Capture order returned status ' + res.status);
        return res.json();
      })
      .then(function(details) {
        // FIX: Null guard on details before any property access
        if (!details) {
          console.error('Capture order returned null response');
          alert('Payment could not be verified. Please contact support.');
          return;
        }

        // 1. Handle Card / Bank Declines
        var errorDetail = details.details ? details.details[0] : null;
        if (errorDetail && errorDetail.issue === 'INSTRUMENT_DECLINED') {
          window.isBasePurchaseProcessed = false;
          return actions.restart();
        }

        // 2. Handle Other Errors
        if (details.error || errorDetail) {
          window.isBasePurchaseProcessed = false;
          alert('Payment could not be processed. Please try a different payment method.');
          return;
        }

        // 3. SUCCESS path
        if (details.status === 'COMPLETED') {
          var capturedValue = details.value || currentTotalAmount || 27.00;
          var purEventId = data.orderID || createEventId('pur');
          var purCustomData = {
            currency: 'USD',
            value: capturedValue,
            content_name: 'Portfolio Career School Offer',
            content_ids: ['pcs-prompt-pack'],
            content_type: 'product'
          };

          // Client Browser Meta & TikTok Pixel tracking (Server S2S CAPI is dispatched by /api/capture-order.js)
          if (typeof fbq === 'function') {
            fbq('track', 'Purchase', purCustomData, { eventID: purEventId });
          }
          if (typeof ttq === 'object' && typeof ttq.track === 'function') {
            ttq.track('CompletePayment', { value: capturedValue, currency: 'USD', content_id: 'pcs_prompt_pack' }, { event_id: purEventId });
          }
          if (typeof gtag === 'function') {
            var ga4Cart = getGA4CartPayload();
            gtag('event', 'purchase', {
              transaction_id: data.orderID,
              currency: 'USD',
              value: ga4Cart.value,
              items: ga4Cart.items
            });
          }

          window.dataLayer = window.dataLayer || [];
          window.dataLayer.push({
            'event': 'purchase_funnel_completed',
            'transactionId': purEventId,
            'value': capturedValue,
            'currency': 'USD'
          });

          window.location.href = '/upsell.html';
        }
      })
      .catch(function(err) {
        window.isBasePurchaseProcessed = false;
        console.error('onApprove capture error:', err);
        alert('We received your payment but had trouble verifying it. Please contact support with your PayPal receipt.');
      });
    },

    onError: function(err) {
      console.error('PayPal SDK Error:', err);
      alert('Transaction verification failed. Please try again or use an alternative card.');
    }

  }).render('#paypal-button-container');
});