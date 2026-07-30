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
function getFbc() {
  const cookieFbc = getCookie('_fbc');
  if (cookieFbc) return cookieFbc;
  try {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const fbclid = urlParams.get('fbclid') || sessionStorage.getItem('attr_fbclid');
      if (fbclid) return `fb.1.${Date.now()}.${fbclid}`;
    }
  } catch (e) { /* storage guarded */ }
  return null;
}
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
      fbq('init', '2772807839768527', { external_id: hashed, em: hashed });
    }
    if (typeof ttq === 'object' && typeof ttq.identify === 'function') {
      ttq.identify({ external_id: hashed, email: cleanEmail });
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

  try {
    var urlParams = new URLSearchParams(window.location.search);
    var testCodeParam = urlParams.get('tt_test_code') || urlParams.get('test_event_code');
    if (testCodeParam) {
      sessionStorage.setItem('pcs_test_event_code', testCodeParam);
      if (typeof ttq === 'object' && typeof ttq.debug === 'function') {
        ttq.debug(testCodeParam);
      }
    }
  } catch (e) { /* storage or URLSearchParams unavailable */ }

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
      if (extId) fbq('init', '2772807839768527', { external_id: sanitizeId(extId) });
      fbq('track', 'PageView', {}, { eventID: currentEventId });
    }
  } catch(err) {
    console.warn('Meta PageView pixel warning:', err);
  }

  // 3. TikTok Pixel PageView (Isolated Try/Catch)
  try {
    if (typeof ttq === 'object') {
      if (extId && typeof ttq.identify === 'function') {
        const ttIdentity = { external_id: extId };
        const storedEmail = sessionStorage.getItem('pcs_customer_email');
        if (storedEmail) ttIdentity.email = storedEmail;
        ttq.identify(ttIdentity);
      }
      if (typeof ttq.page === 'function') {
        ttq.page();
      }
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


// ---------- PAYPAL JAVASCRIPT SDK V6 DISPATCH INFRASTRUCTURE ----------
document.addEventListener('DOMContentLoaded', async function() {
  const paypalContainer = document.querySelector('.checkout-btn-wrap');
  if (!paypalContainer) return; // Not on checkout page — exit cleanly

  if (typeof window.paypal === 'undefined' || !window.paypal.createInstance) {
    console.error('PayPal v6 SDK core not loaded');
    return;
  }

  try {
    const sdkInstance = await window.paypal.createInstance({
      clientId: "AZ1_0aTSSXkrHYWZbBAc9ZhXBvNL_EC6UPGqBAiCZYltK_-fS8EoZsKS6_XvNbtWDkAv8-yzQOvAmGkw",
      components: [
        "paypal-payments",
        "venmo-payments",
        "paypal-guest-payments",
        "applepay-payments",
        "googlepay-payments"
      ],
      pageType: "checkout",
      locale: "en-US"
    });

    const paymentMethods = await sdkInstance.findEligibleMethods({ currencyCode: "USD" });

    // Pre-checkout email validator & order preparer
    function validateAndPrepareOrder() {
      const emailEl = document.getElementById('customer-email');
      const emailInput = emailEl ? emailEl.value.trim().toLowerCase() : '';

      // If email exists, persist and send telemetry
      if (emailInput && emailInput.includes('@')) {
        hashAndPersistEmail(emailInput);
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
      }

      const b1 = !!(document.getElementById('bump1-check') || {}).checked;
      const b2 = !!(document.getElementById('bump2-check') || {}).checked;
      const selectedAmount = (27 + (b1 ? 17 : 0) + (b2 ? 12 : 0)).toFixed(2);

      return fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bump1: b1, bump2: b2, amount: selectedAmount })
      })
      .then(res => res.json())
      .then(order => ({ orderId: order.id }));
    }

    // Shared order approval & capture handler
    async function handleOrderApprove(data) {
      const emailEl = document.getElementById('customer-email');
      let customerEmail = emailEl ? emailEl.value.trim().toLowerCase() : '';
      const orderID = data.orderId || data.orderID;

      var isAlreadyProcessed = false;
      try {
        isAlreadyProcessed = sessionStorage.getItem('pcs_purchase_processed_' + orderID) === 'true';
      } catch(e) {}

      if (window.isBasePurchaseProcessed || isAlreadyProcessed) {
        window.location.href = '/upsell.html';
        return;
      }
      window.isBasePurchaseProcessed = true;
      try {
        sessionStorage.setItem('pcs_purchase_processed_' + orderID, 'true');
        sessionStorage.setItem('pcs_base_order_id', orderID);
      } catch(e) {}

      const res = await fetch('/api/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderID: orderID,
          email: customerEmail,
          externalId: getOrCreateExternalId(),
          test_event_code: getTestEventCode()
        })
      });
      const details = await res.json();

      if (details && details.status === 'COMPLETED') {
        const finalEmail = customerEmail || (details.payer && details.payer.email_address) || '';
        if (finalEmail) {
          hashAndPersistEmail(finalEmail);
          try {
            sessionStorage.setItem('pcs_customer_email', finalEmail);
          } catch(e) {}
        }

        var capturedValue = details.value || currentTotalAmount || 27.00;
        var purEventId = orderID || createEventId('pur');
        var purCustomData = {
          currency: 'USD',
          value: capturedValue,
          content_name: 'Portfolio Career School Offer',
          content_ids: ['pcs-prompt-pack'],
          content_type: 'product'
        };

        if (typeof fbq === 'function') {
          fbq('track', 'Purchase', purCustomData, { eventID: purEventId });
        }
        if (typeof ttq === 'object' && typeof ttq.track === 'function') {
          ttq.track('CompletePayment', { value: capturedValue, currency: 'USD', content_id: 'pcs_prompt_pack' }, { event_id: purEventId });
        }
        if (typeof gtag === 'function') {
          var ga4Cart = getGA4CartPayload();
          gtag('event', 'purchase', {
            transaction_id: orderID,
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
      } else {
        alert('Payment could not be verified. Please contact support.');
      }
    }

    // 1. PayPal
    if (paymentMethods.isEligible("paypal")) {
      const paypalSession = sdkInstance.createPayPalOneTimePaymentSession({ onApprove: handleOrderApprove });
      const paypalBtn = document.getElementById('paypal-btn');
      if (paypalBtn) {
        paypalBtn.removeAttribute('hidden');
        paypalBtn.style.display = 'block';
        paypalBtn.session = paypalSession;
        paypalBtn.addEventListener('click', async () => {
          const order = validateAndPrepareOrder();
          if (order) await paypalSession.start({ presentationMode: 'auto' }, order);
        });
      }
    }

    // 2. Pay Later
    if (paymentMethods.isEligible("paylater") || paymentMethods.isEligible("paypal")) {
      const payLaterSession = sdkInstance.createPayLaterOneTimePaymentSession ? sdkInstance.createPayLaterOneTimePaymentSession({ onApprove: handleOrderApprove }) : sdkInstance.createPayPalOneTimePaymentSession({ onApprove: handleOrderApprove });
      const payLaterBtn = document.getElementById('paylater-btn');
      if (payLaterBtn) {
        payLaterBtn.removeAttribute('hidden');
        payLaterBtn.style.display = 'block';
        payLaterBtn.session = payLaterSession;
        payLaterBtn.addEventListener('click', async () => {
          const order = validateAndPrepareOrder();
          if (order) await payLaterSession.start({ presentationMode: 'auto' }, order);
        });
      }
    }

    // 3. Debit / Credit Cards
    if (paymentMethods.isEligible("card")) {
      const cardSession = sdkInstance.createPayPalGuestOneTimePaymentSession ? sdkInstance.createPayPalGuestOneTimePaymentSession({ onApprove: handleOrderApprove }) : sdkInstance.createPayPalOneTimePaymentSession({ onApprove: handleOrderApprove });
      const cardBtn = document.getElementById('card-btn');
      if (cardBtn) {
        cardBtn.removeAttribute('hidden');
        cardBtn.style.display = 'block';
        cardBtn.session = cardSession;
        cardBtn.addEventListener('click', async () => {
          const order = validateAndPrepareOrder();
          if (order) await cardSession.start({ presentationMode: 'auto' }, order);
        });
      }
    }

    // 4. Venmo
    if (paymentMethods.isEligible("venmo")) {
      const venmoSession = sdkInstance.createVenmoOneTimePaymentSession ? sdkInstance.createVenmoOneTimePaymentSession({ onApprove: handleOrderApprove }) : sdkInstance.createPayPalOneTimePaymentSession({ onApprove: handleOrderApprove });
      const venmoBtn = document.getElementById('venmo-btn');
      if (venmoBtn) {
        venmoBtn.removeAttribute('hidden');
        venmoBtn.style.display = 'block';
        venmoBtn.session = venmoSession;
        venmoBtn.addEventListener('click', async () => {
          const order = validateAndPrepareOrder();
          if (order) await venmoSession.start({ presentationMode: 'auto' }, order);
        });
      }
    }

    // 5. Apple Pay (Check SDK eligibility OR Safari ApplePaySession readiness)
    const isApplePayEligible = paymentMethods.isEligible("applepay") || 
      (typeof window.ApplePaySession !== 'undefined' && window.ApplePaySession.canMakePayments());

    const appleContainer = document.getElementById('apple-pay-container');

    if (isApplePayEligible && appleContainer) {
      try {
        const createAppleSession = sdkInstance.createApplePayOneTimePaymentSession || sdkInstance.createApplePaySession;
        if (typeof createAppleSession === 'function') {
          const applePaySession = createAppleSession.call(sdkInstance, {
            onApprove: handleOrderApprove,
            onCancel: (data) => console.log('Apple Pay cancelled:', data),
            onError: (err) => console.error('Apple Pay error:', err)
          });
          
          appleContainer.innerHTML = '<applepay-button id="apple-pay-btn" buttonstyle="black" type="buy" locale="en-US"></applepay-button>';
          const appleBtn = document.getElementById('apple-pay-btn');
          if (appleBtn) {
            appleBtn.session = applePaySession;
            appleBtn.addEventListener('click', async () => {
              const createOrderPromise = validateAndPrepareOrder();
              if (createOrderPromise && applePaySession) {
                if (typeof applePaySession.start === 'function') {
                  await applePaySession.start({ presentationMode: 'auto' }, createOrderPromise);
                } else if (typeof applePaySession.begin === 'function') {
                  await applePaySession.begin();
                }
              }
            });
            // UNHIDE CONTAINER ONLY AFTER SUCCESSFUL BUTTON MOUNT
            appleContainer.style.display = 'block';
          }
        }
      } catch (appleErr) {
        console.warn('Apple Pay session initialization warning:', appleErr);
        appleContainer.style.display = 'none';
      }
    } else if (appleContainer) {
      appleContainer.style.display = 'none';
    }

    // 6. Google Pay (Check SDK eligibility OR Android device readiness)
    const isGooglePayEligible = paymentMethods.isEligible("googlepay") || 
      (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent));

    const googleContainer = document.getElementById('google-pay-container');

    if (isGooglePayEligible && googleContainer) {
      try {
        const createGoogleSession = sdkInstance.createGooglePayOneTimePaymentSession || sdkInstance.createGooglePaySession;
        if (typeof createGoogleSession === 'function') {
          const googlePaySession = createGoogleSession.call(sdkInstance, {
            onApprove: handleOrderApprove,
            onCancel: (data) => console.log('Google Pay cancelled:', data),
            onError: (err) => console.error('Google Pay error:', err)
          });

          googleContainer.innerHTML = '<googlepay-button id="google-pay-btn" buttonstyle="black" type="buy" locale="en-US"></googlepay-button>';
          const googleBtn = document.getElementById('google-pay-btn');
          if (googleBtn) {
            googleBtn.session = googlePaySession;
            googleBtn.addEventListener('click', async () => {
              const order = validateAndPrepareOrder();
              if (order && googlePaySession) {
                if (typeof googlePaySession.start === 'function') {
                  await googlePaySession.start({ presentationMode: 'auto' }, order);
                }
              }
            });
            // UNHIDE CONTAINER ONLY AFTER SUCCESSFUL BUTTON MOUNT
            googleContainer.style.display = 'block';
          }
        }
      } catch (googleErr) {
        console.warn('Google Pay session initialization warning:', googleErr);
        googleContainer.style.display = 'none';
      }
    } else if (googleContainer) {
      googleContainer.style.display = 'none';
    }

  } catch (err) {
    console.error('PayPal v6 initialization error:', err);
  }
});