/* =========================================================
   PORTFOLIO CAREER PROMPT PACK — FUNNEL SCRIPT
   Handles: FAQ accordions, order bump math, upsell buttons.
   ========================================================= */

// ---------- FAQ accordion (sales page + upsell page) ----------
function attachFAQListeners(){
  var items = document.querySelectorAll('.faq-item');
  items.forEach(function(item){
    var q = item.querySelector('.faq-q');
    if(!q) return;
    q.addEventListener('click', function(){
      item.classList.toggle('open');
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
    createOrder: function() {
      // 1. Snag checkbox data points right at the split-second of the click
      const b1 = document.getElementById('bump1-check');
      const b2 = document.getElementById('bump2-check');

      // 2. Pass variables to serverless function to prevent front-end price manipulation
      return fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bump1: b1 ? b1.checked : false,
          bump2: b2 ? b2.checked : false
        })
      })
      .then(res => res.json())
      .then(order => order.id);
    },
    onApprove: function(data) {
      const customerEmail = document.getElementById('buyer-email').value;

      return fetch('/api/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderID: data.orderID, email: customerEmail })
      })
      .then(res => res.json())
      .then(function() {
        // ── MASTER TRACKING DATA SIGNAL ──
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({
          'event': 'purchase_funnel_completed',
          'transactionId': data.orderID,
          'value': currentTotalAmount, // Automatically captures $27, $39, $44, or $56
          'currency': 'USD'
        });

        // Pass them cleanly into the upsell track
        window.location.href = "upsell.html";
      });
    },
    onError: function(err) {
      console.error("Secure Processing Error: ", err);
      alert("Transaction verification failed. Please try again or use an alternative card.");
    }
  }).render('#paypal-button-container');
}