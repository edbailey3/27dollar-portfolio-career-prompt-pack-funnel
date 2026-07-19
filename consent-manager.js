(function() {
  const CONSENT_KEY = 'portfolio_cookie_consent';
  const GTM_ID = 'GTM-MLFHB8PP';

  // 1. Immediate Execution Check
  let consent = null;
  try {
    const stored = localStorage.getItem(CONSENT_KEY);
    if (stored) {
      consent = JSON.parse(stored);
    }
  } catch (e) {
    console.error('Error reading cookie consent', e);
  }

  // If already consented to analytics, load GTM immediately
  if (consent && consent.analytics) {
    loadGTM();
  }

  function loadGTM() {
    if (window.gtmLoaded) return;
    window.gtmLoaded = true;
    (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
    new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
    j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
    '/metrics/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
    })(window,document,'script','dataLayer', GTM_ID);
  }

  // 2. DOMContentLoaded Execution for Banner
  document.addEventListener('DOMContentLoaded', function() {
    // Attach listeners to any cookie settings triggers in footers
    setupFooterTriggers();

    // If user has already made a choice, don't show the banner
    if (consent) {
      return;
    }

    // Build the banner
    createBanner();
  });

  function setupFooterTriggers() {
    const triggers = document.querySelectorAll('.cookie-settings-trigger');
    triggers.forEach(function(trigger) {
      trigger.addEventListener('click', function(e) {
        e.preventDefault();
        showBanner(true); // show banner and expand preferences
      });
    });
  }

  function createBanner() {
    if (document.getElementById('cookie-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'cookie-banner';
    
    // Custom brand-matching UI design
    banner.innerHTML = `
      <h3><span>//</span> Cookie Consent</h3>
      <p>We use cookies to enhance your experience, serve secure checkout, and analyze our traffic. Review our <a href="privacy.html">Privacy & Cookie Policy</a> to see details. You can manage your preferences below.</p>
      
      <div id="cookie-banner-prefs" class="cookie-preferences">
        <div class="cookie-pref-item">
          <input type="checkbox" id="pref-essential" checked disabled>
          <div class="cookie-pref-details">
            <label for="pref-essential">Necessary Cookies</label>
            <p>Required for secure checkout via PayPal and saving your consent settings. Cannot be disabled.</p>
          </div>
        </div>
        <div class="cookie-pref-item">
          <input type="checkbox" id="pref-analytics">
          <div class="cookie-pref-details">
            <label for="pref-analytics">Analytics & Marketing</label>
            <p>Helps us understand how visitors interact with the funnel (Google Tag Manager). Disabled by default.</p>
          </div>
        </div>
      </div>

      <div class="cookie-actions">
        <div class="cookie-btn-row">
          <button id="cookie-accept-all" class="cookie-btn cookie-btn--primary">Accept All</button>
          <button id="cookie-reject-all" class="cookie-btn cookie-btn--secondary">Decline</button>
        </div>
        <button id="cookie-manage-prefs" class="cookie-btn--link">Manage Settings</button>
        <button id="cookie-save-prefs" class="cookie-btn cookie-btn--primary" style="display:none; margin-top: 8px;">Save Preferences</button>
      </div>
    `;

    document.body.appendChild(banner);

    // Click handlers
    document.getElementById('cookie-accept-all').addEventListener('click', function() {
      saveConsent(true);
    });

    document.getElementById('cookie-reject-all').addEventListener('click', function() {
      saveConsent(false);
    });

    const manageBtn = document.getElementById('cookie-manage-prefs');
    const prefsPanel = document.getElementById('cookie-banner-prefs');
    const saveBtn = document.getElementById('cookie-save-prefs');
    const btnRow = document.querySelector('.cookie-btn-row');

    manageBtn.addEventListener('click', function() {
      const isOpen = prefsPanel.classList.toggle('open');
      if (isOpen) {
        manageBtn.style.display = 'none';
        btnRow.style.display = 'none';
        saveBtn.style.display = 'block';
        // Set the analytics checkbox state based on previous settings if any
        document.getElementById('pref-analytics').checked = consent ? consent.analytics : false;
      }
    });

    saveBtn.addEventListener('click', function() {
      const analyticsChecked = document.getElementById('pref-analytics').checked;
      saveConsent(analyticsChecked);
    });

    // Animate display
    setTimeout(function() {
      banner.classList.add('show');
    }, 500);
  }

  function showBanner(expandPrefs) {
    createBanner();
    const banner = document.getElementById('cookie-banner');
    if (!banner) return;
    
    // Ensure display state is clean
    banner.style.display = 'block';
    
    setTimeout(function() {
      banner.classList.add('show');
    }, 50);

    if (expandPrefs) {
      const prefsPanel = document.getElementById('cookie-banner-prefs');
      const manageBtn = document.getElementById('cookie-manage-prefs');
      const saveBtn = document.getElementById('cookie-save-prefs');
      const btnRow = document.querySelector('.cookie-btn-row');

      if (prefsPanel) prefsPanel.classList.add('open');
      if (manageBtn) manageBtn.style.display = 'none';
      if (btnRow) btnRow.style.display = 'none';
      if (saveBtn) saveBtn.style.display = 'block';

      // Load checkbox state
      const analyticsCheck = document.getElementById('pref-analytics');
      if (analyticsCheck) {
        analyticsCheck.checked = consent ? consent.analytics : false;
      }
    }
  }

  function saveConsent(analyticsAccepted) {
    const consentObj = {
      essential: true,
      analytics: analyticsAccepted,
      timestamp: new Date().getTime()
    };

    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(consentObj));
      consent = consentObj;
    } catch (e) {
      console.error('Error saving consent settings', e);
    }

    if (analyticsAccepted) {
      loadGTM();
    }

    // Hide banner
    const banner = document.getElementById('cookie-banner');
    if (banner) {
      banner.classList.remove('show');
      setTimeout(function() {
        banner.style.display = 'none';
      }, 300);
    }
  }

  // Expose reset trigger on window so the privacy policy button can trigger it
  window.resetCookieConsent = function() {
    try {
      localStorage.removeItem(CONSENT_KEY);
      consent = null;
      showBanner(true);
    } catch (e) {
      console.error('Error resetting consent settings', e);
    }
  };
})();
