/* =========================================================
   PORTFOLIO CAREER PROMPT PACK — FUNNEL SCRIPT
   Handles: FAQ accordions, order bump math, upsell buttons.
   ========================================================= */

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

function toggleBump(boxId, checkboxId){
  var box = document.getElementById(boxId);
  var checkbox = document.getElementById(checkboxId);
  if(!box || !checkbox) return;

  // If the click came from the row itself (not the checkbox), flip it manually
  if(typeof event !== 'undefined' && event && event.target && event.target.id !== checkboxId){
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
function acceptUpsell(){
  // ── MASTER UPSALE DATA SIGNAL ──
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    'event': 'upsell_completed',
    'value': 47.00,
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
        return actions.resolve();
      }
    },

    createOrder: function(data, actions) {
      const emailInput = document.getElementById('customer-email')?.value?.trim();

      // Sync lead to Kit first, then create PayPal Order
      return fetch('/api/checkout-initiated', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInput, product: 'Prompt Pack' })
      })
      .then(() => {
        return fetch('/api/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: '27.00' })
        })
        .then(res => res.json())
        .then(order => order.id);
      });
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

        // 3. SUCCESS: Cash cleared into PayPal
        if (details.status === 'COMPLETED') {
          if (typeof fbq === 'function') {
            fbq('track', 'Purchase', { value: currentTotalAmount || 27.00, currency: 'USD' });
          }

          // GA4 Purchase event via GTM DataLayer
          window.dataLayer = window.dataLayer || [];
          window.dataLayer.push({
            'event': 'purchase_funnel_completed',
            'transactionId': data.orderID,
            'value': currentTotalAmount || 27.00,
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