// ---------- ATTRIBUTION PARAMETER PERSISTENCE & FORWARDING ----------
(function captureAndPersistAttributionParams() {
  if (typeof window === 'undefined') return;

  const ATTRIBUTION_KEYS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'fbclid', 'gclid', 'ttclid', 'msclkid'
  ];

  try {
    const urlParams = new URLSearchParams(window.location.search);
    ATTRIBUTION_KEYS.forEach(function(key) {
      if (urlParams.has(key)) {
        sessionStorage.setItem('attr_' + key, urlParams.get(key));
      }
    });

    // Reattach persisted params to internal CTA links (e.g. index.html -> checkout.html)
    document.addEventListener('DOMContentLoaded', function() {
      const storedParams = new URLSearchParams();
      ATTRIBUTION_KEYS.forEach(function(key) {
        const val = sessionStorage.getItem('attr_' + key);
        if (val) storedParams.set(key, val);
      });

      const queryString = storedParams.toString();
      if (!queryString) return;

      const links = document.querySelectorAll('a[href*="checkout.html"], a[href*="upsell.html"]');
      links.forEach(function(link) {
        try {
          const hrefUrl = new URL(link.href, window.location.origin);
          storedParams.forEach(function(v, k) {
            if (!hrefUrl.searchParams.has(k)) {
              hrefUrl.searchParams.set(k, v);
            }
          });
          link.href = hrefUrl.toString();
        } catch (e) {
          // Fallback if URL parsing fails
        }
      });
    });
  } catch (err) {
    console.error("Attribution persistence error:", err);
  }
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

  if(summaryEl) summaryEl.innerHTML = lines;
  totalEl.innerHTML = '$' + total + '<span> USD</span>';
  currentTotalAmount = total;
}

function bumpLineHTML(name, price){
  return '<div class="product-line" style="border-bottom:1px dashed #3A362D; padding-bottom:14px; margin-bottom:14px;">' +
           '<div class="product-thumb" style="background:var(--coral); color:var(--paper); font-size:12px;">+</div>' +
           '<div><h3 style="font-size:14px;">' + name + '</h3><p>Order bump</p></div>' +
           '<div class="price">$' + price + '</div>' +
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
    var email = buyerEmailInput.value.trim();
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if(emailRegex.test(email)){
      fetch('/api/draft-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      }).catch(function(err){
        console.error("Draft checkout background sync failed:", err);
      });
    }
  });
}


// ---------- UPSELL PAGE: accept / decline ----------
var isUpsellProcessed = false;

function acceptUpsell(){
  if (isUpsellProcessed) return;
  isUpsellProcessed = true;

  const upsellOrderId = 'upsell_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
  const upsellValue = 47.00;

  if (typeof fbq === 'function') {
    fbq('track', 'Purchase', {
      value: upsellValue,
      currency: 'USD',
      content_name: 'Spider-Web Brain Notion OS',
      content_type: 'product'
    }, { eventID: upsellOrderId });
  }

  // ── MASTER UPSELL DATA SIGNAL ──
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
  var offer = document.getElementById('offer-panel');
  var confirm = document.getElementById('confirm-panel');
  var confirmTitle = document.getElementById('confirm-title');
  var confirmText = document.getElementById('confirm-text');
  if(!offer || !confirm) return;

  confirmTitle.textContent = title;
  confirmText.textContent = text;
  offer.style.display = 'none';
  confirm.classList.add('show');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
// ---------- PAYPAL SECURE DISPATCH INFRASTRUCTURE ----------
if(document.getElementById('paypal-button-container')){
  paypal.Buttons({
    style: {
      layout: 'vertical',
      color:  'gold',
      shape:  'rect',
      label:  'paypal'
    },

    onClick: function(data, actions) {
      const emailInput = document.getElementById('customer-email')?.value?.trim();
      const errorEl = document.getElementById('email-error');

      if (!emailInput || !emailInput.includes('@')) {
        if (errorEl) errorEl.style.display = 'block';
        document.getElementById('customer-email')?.focus();
        return actions.reject();
      } else {
        if (errorEl) errorEl.style.display = 'none';

        // Fire POST request to /api/checkout-initiated to sync lead to Kit BEFORE creating the PayPal order
        return fetch('/api/checkout-initiated', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: emailInput, product: 'Prompt Pack' })
        })
        .then(() => actions.resolve())
        .catch(err => {
          console.error("Checkout initiated sync error:", err);
          return actions.resolve();
        });
      }
    },

    createOrder: function(data, actions) {
      const b1 = document.getElementById('bump1-check')?.checked || false;
      const b2 = document.getElementById('bump2-check')?.checked || false;
      const selectedAmount = (27 + (b1 ? 17 : 0) + (b2 ? 12 : 0)).toFixed(2);

      return fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bump1: b1, bump2: b2, amount: selectedAmount })
      })
      .then(res => res.json())
      .then(order => order.id);
    },

    onApprove: function(data, actions) {
      const customerEmail = document.getElementById('customer-email')?.value || '';

      return fetch('/api/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderID: data.orderID, email: customerEmail })
      })
      .then(res => res.json())
      .then(details => {
        // 1. Handle Card / Bank Declines (Re-open modal for user to pick another card)
        const errorDetail = details?.details?.[0];
        if (errorDetail?.issue === 'INSTRUMENT_DECLINED') {
          return actions.restart();
        }

        // 2. Handle Other Unprocessable Errors
        if (details.error || errorDetail) {
          alert('Payment could not be processed. Please try a different payment method.');
          return;
        }

        // 3. SUCCESS: Cash cleared into PayPal (Deterministic Purchase Trigger)
        if (details.status === 'COMPLETED') {
          const capturedValue = details.value || currentTotalAmount || 27.00;

          // Client-Side Meta Pixel Deduplication using eventID (PayPal Order ID)
          if (typeof fbq === 'function') {
            fbq('track', 'Purchase', {
              value: capturedValue,
              currency: 'USD',
              content_name: 'Portfolio Career School Offer',
              content_type: 'product'
            }, { eventID: data.orderID });
          }

          // GA4 Purchase event via GTM DataLayer
          window.dataLayer = window.dataLayer || [];
          window.dataLayer.push({
            'event': 'purchase_funnel_completed',
            'transactionId': data.orderID,
            'value': capturedValue,
            'currency': 'USD'
          });

          window.location.href = '/upsell.html';
        }
      });
    },

    onError: function(err) {
      console.error("Secure Processing Error: ", err);
      alert("Transaction verification failed. Please try again or use an alternative card.");
    }
  }).render('#paypal-button-container');
}