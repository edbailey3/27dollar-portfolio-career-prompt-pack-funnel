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

// ---------- CHECKOUT PAGE: background draft checkout sync ----------
var buyerEmailInput = document.getElementById('customer-email');
if(buyerEmailInput){
  buyerEmailInput.addEventListener('blur', function(){
    var email = buyerEmailInput.value.trim().toLowerCase();
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if(emailRegex.test(email)){
      fetch('/api/draft-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      }).catch(function(err){
        console.warn('Draft checkout background sync failed:', err);
      });
    }
  });
}


// ---------- UPSELL PAGE: accept / decline ----------
var isUpsellProcessed = false;

function acceptUpsell(){
  if (isUpsellProcessed) return;
  isUpsellProcessed = true;

  var upsellOrderId = 'upsell_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
  var upsellValue = 47.00;

  if (typeof fbq === 'function') {
    fbq('track', 'Purchase', {
      value: upsellValue,
      currency: 'USD',
      content_name: 'Spider-Web Brain Notion OS',
      content_type: 'product'
    }, { eventID: upsellOrderId });
  }

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

      return fetch('/api/checkout-initiated', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInput, product: 'Prompt Pack' })
      })
      .then(function() { return actions.resolve(); })
      .catch(function(err) {
        console.warn('Checkout initiated sync error (non-fatal):', err);
        return actions.resolve(); // Allow checkout to proceed even if Kit sync fails
      });
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

      return fetch('/api/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderID: data.orderID, email: customerEmail })
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
          return actions.restart();
        }

        // 2. Handle Other Errors
        if (details.error || errorDetail) {
          alert('Payment could not be processed. Please try a different payment method.');
          return;
        }

        // 3. SUCCESS path
        if (details.status === 'COMPLETED') {
          var capturedValue = details.value || currentTotalAmount || 27.00;

          if (typeof fbq === 'function') {
            fbq('track', 'Purchase', {
              value: capturedValue,
              currency: 'USD',
              content_name: 'Portfolio Career School Offer',
              content_type: 'product'
            }, { eventID: data.orderID });
          }

          window.dataLayer = window.dataLayer || [];
          window.dataLayer.push({
            'event': 'purchase_funnel_completed',
            'transactionId': data.orderID,
            'value': capturedValue,
            'currency': 'USD'
          });

          window.location.href = '/upsell.html';
        }
      })
      .catch(function(err) {
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