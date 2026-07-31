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

  var submitBtn = document.getElementById('submit-btn');
  if (submitBtn) {
    submitBtn.textContent = 'Pay $' + total + ' USD';
  }

  if (window.stripeElements) {
    try {
      window.stripeElements.update({ amount: total * 100 });
    } catch(e) {
      console.warn('stripeElements.update warning:', e);
    }
  }
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


// ---------- STRIPE ELEMENTS DISPATCH INFRASTRUCTURE ----------
var stripe = null;
var stripeElements = null;

async function initStripeElements() {
  const paymentForm = document.getElementById('payment-form');
  const paymentElementContainer = document.getElementById('payment-element');
  if (!paymentForm || !paymentElementContainer) return; // Not on checkout page

  if (typeof window.Stripe === 'undefined') {
    console.error('Stripe.js SDK not loaded');
    const msg = document.getElementById('payment-message');
    if (msg) {
      msg.textContent = 'Payment engine failed to load. Please refresh the page.';
      msg.style.display = 'block';
    }
    return;
  }

  try {
    const res = await fetch('/api/stripe-config');
    const configData = await res.json();
    const publishableKey = configData?.publishableKey;

    if (!publishableKey) {
      console.error('Stripe publishable key missing from /api/stripe-config');
      return;
    }

    stripe = window.Stripe(publishableKey);
    window.stripe = stripe;

    const initialCents = (currentTotalAmount || 27) * 100;

    stripeElements = stripe.elements({
      mode: 'payment',
      amount: initialCents,
      currency: 'usd',
      appearance: { theme: 'flat' }
    });
    window.stripeElements = stripeElements;

    const paymentElement = stripeElements.create('payment');
    paymentElement.mount('#payment-element');

    paymentForm.addEventListener('submit', async function(e) {
      e.preventDefault();

      const submitBtn = document.getElementById('submit-btn');
      const messageContainer = document.getElementById('payment-message');
      const emailEl = document.getElementById('customer-email');
      const emailError = document.getElementById('email-error');

      if (messageContainer) {
        messageContainer.style.display = 'none';
        messageContainer.textContent = '';
      }
      if (emailError) emailError.style.display = 'none';

      const rawEmail = emailEl ? emailEl.value : '';
      const cleanEmail = rawEmail.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!cleanEmail || !emailRegex.test(cleanEmail)) {
        if (emailError) {
          emailError.style.display = 'block';
        } else if (messageContainer) {
          messageContainer.textContent = 'Please enter a valid email address.';
          messageContainer.style.display = 'block';
        }
        if (emailEl) emailEl.focus();
        return;
      }

      await hashAndPersistEmail(cleanEmail);

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
      sendCAPIEvent('InitiateCheckout', icEventId, icCustomData, cleanEmail);
      sendCAPIEvent('AddPaymentInfo', apiEventId, icCustomData, cleanEmail);

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing...';
      }

      try {
        const { error: submitError } = await stripeElements.submit();
        if (submitError) {
          if (messageContainer) {
            messageContainer.textContent = submitError.message;
            messageContainer.style.display = 'block';
          }
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Pay $' + currentTotalAmount + ' USD';
          }
          return;
        }

        const b1 = !!(document.getElementById('bump1-check') || {}).checked;
        const b2 = !!(document.getElementById('bump2-check') || {}).checked;
        const externalId = getOrCreateExternalId();

        const intentRes = await fetch('/api/create-payment-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bump1: b1,
            bump2: b2,
            email: cleanEmail,
            externalId: externalId
          })
        });

        const intentData = await intentRes.json();

        if (!intentRes.ok || !intentData.clientSecret) {
          throw new Error(intentData.error || 'Failed to create payment intent');
        }

        const returnUrl = (window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1'))
          ? (window.location.origin + '/upsell.html')
          : 'https://portfoliocareer-aipromptpack.portfoliocareerschool.com/upsell.html';

        const { error: confirmError } = await stripe.confirmPayment({
          elements: stripeElements,
          clientSecret: intentData.clientSecret,
          confirmParams: {
            return_url: returnUrl
          }
        });

        if (confirmError) {
          if (messageContainer) {
            messageContainer.textContent = confirmError.message;
            messageContainer.style.display = 'block';
          }
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Pay $' + currentTotalAmount + ' USD';
          }
        }
      } catch (err) {
        console.error('Stripe payment submission error:', err);
        if (messageContainer) {
          messageContainer.textContent = err.message || 'An unexpected error occurred during payment.';
          messageContainer.style.display = 'block';
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Pay $' + currentTotalAmount + ' USD';
        }
      }
    });
  } catch (err) {
    console.error('Stripe Elements initialization error:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initStripeElements);
} else {
  initStripeElements();
}

// ---------- UPSELL PAGE: STRIPE REDIRECT PARAMETER EXTRACTION ----------
function initStripeUpsellRedirect() {
  if (typeof window === 'undefined') return;
  const path = window.location.pathname;
  if (!path.endsWith('/upsell.html') && path !== '/upsell') return;

  try {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentIntent = urlParams.get('payment_intent');
    const redirectStatus = urlParams.get('redirect_status');

    if (redirectStatus === 'succeeded' && paymentIntent) {
      let isAlreadyProcessed = false;
      try {
        isAlreadyProcessed = sessionStorage.getItem('pcs_purchase_processed_' + paymentIntent) === 'true';
      } catch (e) {}

      sessionStorage.setItem('pcs_base_order_id', paymentIntent);

      if (!isAlreadyProcessed) {
        try {
          sessionStorage.setItem('pcs_purchase_processed_' + paymentIntent, 'true');
        } catch (e) {}

        const customerEmail = sessionStorage.getItem('pcs_customer_email') || '';
        const purCustomData = {
          currency: 'USD',
          value: 27.00,
          content_name: 'Portfolio Career School Offer',
          content_ids: ['pcs-prompt-pack'],
          content_type: 'product'
        };

        if (typeof fbq === 'function') {
          fbq('track', 'Purchase', purCustomData, { eventID: paymentIntent });
        }
        if (typeof ttq === 'object' && typeof ttq.track === 'function') {
          ttq.track('CompletePayment', { value: 27.00, currency: 'USD', content_id: 'pcs_prompt_pack' }, { event_id: paymentIntent });
        }
        if (typeof gtag === 'function') {
          gtag('event', 'purchase', {
            transaction_id: paymentIntent,
            currency: 'USD',
            value: 27.00,
            items: [{ item_id: 'pcs_prompt_pack', item_name: 'Portfolio Career AI Prompt Pack', price: 27.00, quantity: 1 }]
          });
        }
        sendCAPIEvent('Purchase', paymentIntent, purCustomData, customerEmail);

        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({
          'event': 'purchase_funnel_completed',
          'transactionId': paymentIntent,
          'value': 27.00,
          'currency': 'USD'
        });
      }
    }
  } catch (err) {
    console.warn('Stripe upsell URL param processing error:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initStripeUpsellRedirect);
} else {
  initStripeUpsellRedirect();
}