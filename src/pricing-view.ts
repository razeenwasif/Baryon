import './pricing-view.css';

interface PricingTier {
  id: 'core' | 'pro';
  name: string;
  badge: string;
  featured?: boolean;
  monthly: number;
  annual: number;
  description: string;
  cta: string;
  features: string[];
}

export interface PricingAccess {
  edition?: string;
  isAdmin?: boolean;
  email?: string;
  plan?: string;
}

export interface PricingState {
  access?: PricingAccess;
  edition?: string;
  googleAccount?: { email?: string };
}

export interface PricingViewOptions {
  api?: unknown;
  root?: HTMLElement | null;
  sidebarButton?: HTMLElement | null;
  getState?: () => PricingState | undefined;
  onShow?: () => void;
  onHide?: () => void;
}

export interface PricingViewController {
  show: () => void;
  hide: () => void;
  toggle: () => void;
  refresh: () => void;
  readonly visible: boolean;
}

const TIERS: PricingTier[] = [
  {
    id: 'core',
    name: 'Open Core',
    badge: 'Apache-2.0',
    monthly: 0,
    annual: 0,
    description: 'Open-source companion, multi-provider routing, /swarm, Goals, Boards & Two-Mac Face Link.',
    cta: 'Active Open Core',
    features: [
      'Chat & per-session Work Agents',
      'Claude, Gemini, ChatGPT / Codex & DeepSeek',
      'Multi-Agent /swarm & Auto-by-Task Orchestrator',
      'Goals, Watchers, Experiments & Miro Boards',
      'Two-Mac Face Link, iOS Companion & Vorssaint',
    ],
  },
  {
    id: 'pro',
    name: 'Baryon Pro',
    badge: 'Most Popular',
    featured: true,
    monthly: 19,
    annual: 15,
    description: 'Full Research Workbench, Paper Reproduction, AutoML Analytics, Baryon Academy, and Creative Studio.',
    cta: 'Upgrade to Pro →',
    features: [
      'Everything in Open Core',
      'Studio: Image, Video & Music Generation',
      'Worlds: Genie 4 Real-Time Interactive Simulation',
      'Games: Indie Game Dev Studio (Photon Engine)',
      'Research Workbench & Multi-Family Debates',
      'arXiv Paper Reproduction & Verification',
      'Analytics, AutoML & Record Linkage Studio',
      'Baryon Academy & Study Notebooks',
    ],
  },
];

const MATRIX_ROWS: ReadonlyArray<readonly [string, string, string]> = [
  ['Chat, Per-Session Work & /swarm', 'Included', 'Included'],
  ['Two-Mac Face Link & iOS App', 'Included', 'Included'],
  ['Studio (Nano Banana, Omni 1.2 Flash, Lyria 3.5)', '—', 'Included'],
  ['Worlds (Genie 4 Interactive Simulation)', '—', 'Included'],
  ['Games (Photon Metal Engine & Asset Pipeline)', '—', 'Included'],
  ['Research Workbench & Paper Repro', '—', 'Included'],
  ['Analytics, AutoML & Record Linkage', '—', 'Included'],
  ['Baryon Academy & Study Notebooks', '—', 'Included'],
];

const esc = (text: unknown): string => String(text ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export function pricingView({ root, sidebarButton, getState, onShow, onHide }: PricingViewOptions = {}): PricingViewController {
  if (!root) throw new Error('pricingView needs a root element');
  const rootEl: HTMLElement = root;
  let visible = false;
  let billing: 'monthly' | 'annual' = 'annual';
  let selectedTier: 'core' | 'pro' = 'pro';
  let promoCode = '';
  let promoApplied = false;
  let payMethod: 'card' | 'apple' | 'link' = 'card';
  let checkoutOpen = false;
  let statusMsg = '';
  let statusErr = false;

  const setOpen = (open: boolean): void => {
    visible = Boolean(open);
    rootEl.hidden = !visible;
    document.documentElement.classList.toggle('pricing-open', visible);
    sidebarButton?.classList.toggle('current', visible);
    sidebarButton?.setAttribute('aria-pressed', String(visible));
  };

  function currentAccess(): PricingAccess {
    const st = typeof getState === 'function' ? getState() : {};
    return st?.access || {
      edition: st?.edition || 'pro',
      isAdmin: false,
      email: st?.googleAccount?.email || '',
      plan: st?.edition === 'core' ? 'core' : 'pro',
    };
  }

  function unitPrice(tier: PricingTier): number {
    return billing === 'annual' ? tier.annual : tier.monthly;
  }

  function computeTotals(tier: PricingTier): { unit: number; raw: number; discount: number; total: number; periodLabel: string } {
    const unit = unitPrice(tier);
    const periodMult = billing === 'annual' ? 12 : 1;
    const raw = unit * periodMult;
    const discount = promoApplied ? Math.round(raw * 0.2) : 0;
    return { unit, raw, discount, total: Math.max(0, raw - discount), periodLabel: billing === 'annual' ? '/year' : '/month' };
  }

  function render(): void {
    const access = currentAccess();
    const tierObj = TIERS.find(t => t.id === selectedTier) || TIERS[1];
    const totals = computeTotals(tierObj);
    const badgeLabel = access.isAdmin
      ? `Admin · ${access.email || 'Full Access'}`
      : access.plan === 'pro'
        ? 'Baryon Pro'
        : 'Open Core';

    rootEl.innerHTML = `
      <header class="pr-topbar">
        <div class="pr-brand">
          <strong>Baryon Plans &amp; Billing</strong>
          <span class="pr-plan-badge ${access.isAdmin ? 'is-admin' : ''}">${esc(badgeLabel)}</span>
        </div>
        <div class="pr-top-actions">
          <div class="pr-billing-toggle" role="group" aria-label="Billing interval">
            <button type="button" data-billing="monthly" class="${billing === 'monthly' ? 'is-on' : ''}">Monthly</button>
            <button type="button" data-billing="annual" class="${billing === 'annual' ? 'is-on' : ''}">Annual <em>-20%</em></button>
          </div>
          <button type="button" class="pr-back-btn" id="pr-close-btn">← Back</button>
        </div>
      </header>
      <div class="pr-scroll">
        <div class="pr-wrap">
          <div class="pr-hero">
            <span class="pr-kicker">OPEN CORE + PRO WORKBENCH</span>
            <h1>Choose the Baryon workspace built for your flow</h1>
            <p>Core companion &amp; multi-agent coding stays Apache-2.0 open source forever. Upgrade for Research, Paper Reproduction, AutoML Analytics, and Academy.</p>
          </div>
          ${access.isAdmin ? `
            <div class="pr-admin-banner" role="status">
              <div>
                <strong>Admin Privileges Active (${esc(access.email)})</strong>
                <p>Your Google account has owner-level admin access and all Baryon Pro suites unlocked. Checkout below runs in UI preview mode.</p>
              </div>
              <button type="button" class="pr-back-btn" id="pr-preview-checkout">Preview Checkout UI</button>
            </div>
          ` : ''}
          <div class="pr-tiers">
            ${TIERS.map(tier => {
              const price = unitPrice(tier);
              const isCurrent = (tier.id === 'core' && access.plan === 'core') || (tier.id === 'pro' && (access.plan === 'pro' || access.isAdmin));
              return `
                <article class="pr-tier ${tier.featured ? 'is-featured' : ''}">
                  <div class="pr-tier-head">
                    <span class="pr-tier-name">${esc(tier.name)}</span>
                    <span class="pr-tier-pill">${esc(isCurrent && access.isAdmin ? 'Admin Unlocked' : isCurrent ? 'Current Plan' : tier.badge)}</span>
                  </div>
                  <div class="pr-price-row">
                    <strong>$${price}</strong>
                    <span>${price === 0 ? 'forever · Apache-2.0' : `/ mo (${billing})`}</span>
                  </div>
                  <p class="pr-tier-desc">${esc(tier.description)}</p>
                  <ul class="pr-features">
                    ${tier.features.map(f => `<li>${esc(f)}</li>`).join('')}
                  </ul>
                  <button type="button" class="pr-tier-btn" data-select-tier="${esc(tier.id)}" ${tier.id === 'core' && !checkoutOpen ? 'disabled' : ''}>
                    ${tier.id === 'core' ? 'Included Open Source' : esc(tier.cta)}
                  </button>
                </article>
              `;
            }).join('')}
          </div>
          <section class="pr-matrix-card">
            <div class="pr-matrix-head">Capability Comparison</div>
            <table class="pr-matrix">
              <thead>
                <tr><th>Capability</th><th>Open Core</th><th>Pro</th></tr>
              </thead>
              <tbody>
                ${MATRIX_ROWS.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}
              </tbody>
            </table>
          </section>
        </div>
      </div>
      <div class="pr-modal-backdrop" id="pr-checkout-modal" ${checkoutOpen ? '' : 'hidden'}>
        <div class="pr-checkout-dialog" role="dialog" aria-modal="true" aria-labelledby="pr-checkout-title">
          <div class="pr-checkout-top">
            <div>
              <h2 id="pr-checkout-title" style="font-size:18px;font-weight:600">Checkout · ${esc(tierObj.name)}</h2>
              <p style="font-size:12px;color:var(--pr-dim)">UI preview only — payment backend will be wired in a future update.</p>
            </div>
            <button type="button" class="pr-back-btn" id="pr-checkout-close">Close</button>
          </div>
          <div class="pr-checkout-grid">
            <div class="pr-summary-box">
              <strong style="font-size:13.5px">Order Summary</strong>
              <div class="pr-summary-line">
                <span>Plan</span>
                <strong>${esc(tierObj.name)} (${esc(billing)})</strong>
              </div>
              <div class="pr-summary-line">
                <span>Price</span>
                <span>$${totals.unit}/mo</span>
              </div>
              <div class="pr-promo-row">
                <input id="pr-promo-input" type="text" placeholder="Promo code (e.g. FOUNDER20)" value="${esc(promoCode)}" aria-label="Promo code">
                <button type="button" id="pr-promo-apply">${promoApplied ? 'Applied (-20%)' : 'Apply'}</button>
              </div>
              ${promoApplied ? `
                <div class="pr-summary-line" style="color:var(--pr-emerald)">
                  <span>Promo discount (20%)</span>
                  <span>−$${totals.discount}</span>
                </div>
              ` : ''}
              <div class="pr-summary-line pr-summary-total">
                <span>Total due today</span>
                <span>$${totals.total}${totals.periodLabel}</span>
              </div>
            </div>
            <form class="pr-pay-box" id="pr-checkout-form">
              <div class="pr-pay-tabs" role="tablist" aria-label="Payment method">
                <button type="button" data-pay="card" class="${payMethod === 'card' ? 'is-on' : ''}">Card</button>
                <button type="button" data-pay="apple" class="${payMethod === 'apple' ? 'is-on' : ''}">Apple Pay</button>
                <button type="button" data-pay="link" class="${payMethod === 'link' ? 'is-on' : ''}">Link</button>
              </div>
              <label class="pr-field">Email
                <input id="pr-email" type="email" required value="${esc(access.email)}" placeholder="you@domain.com">
              </label>
              ${payMethod === 'card' ? `
                <label class="pr-field">Cardholder name
                  <input id="pr-card-name" type="text" required placeholder="Razeen Wasif">
                </label>
                <label class="pr-field">Card number
                  <input id="pr-card-num" type="text" inputmode="numeric" maxlength="19" placeholder="4242 4242 4242 4242">
                </label>
                <div class="pr-field-row">
                  <label class="pr-field">Expiry
                    <input id="pr-card-exp" type="text" maxlength="7" placeholder="12 / 29">
                  </label>
                  <label class="pr-field">CVC
                    <input id="pr-card-cvc" type="text" inputmode="numeric" maxlength="4" placeholder="424">
                  </label>
                </div>
              ` : `
                <p style="font-size:12.5px;color:var(--pr-dim);padding:10px 0">
                  ${payMethod === 'apple' ? 'Apple Pay express sheet will trigger once Stripe / payment backend is connected.' : 'Link one-click checkout will authenticate your saved email once wired.'}
                </p>
              `}
              <label class="pr-field">Country / Region
                <select id="pr-country">
                  <option value="AU">Australia</option>
                  <option value="US">United States</option>
                  <option value="GB">United Kingdom</option>
                  <option value="CA">Canada</option>
                </select>
              </label>
              ${statusMsg ? `<div class="pr-checkout-status ${statusErr ? 'is-error' : ''}" role="status">${esc(statusMsg)}</div>` : ''}
              <button type="submit" class="pr-tier-btn" style="background:var(--pr-accent);border-color:transparent;color:#fff">
                Complete Checkout (Preview)
              </button>
            </form>
          </div>
        </div>
      </div>
    `;

    rootEl.querySelector('#pr-close-btn')?.addEventListener('click', () => hide());
    rootEl.querySelector('#pr-preview-checkout')?.addEventListener('click', () => {
      selectedTier = 'pro';
      checkoutOpen = true;
      statusMsg = '';
      render();
    });
    for (const btn of rootEl.querySelectorAll<HTMLElement>('[data-billing]')) {
      btn.addEventListener('click', () => {
        billing = btn.dataset.billing === 'monthly' ? 'monthly' : 'annual';
        render();
      });
    }
    for (const btn of rootEl.querySelectorAll<HTMLElement>('[data-select-tier]')) {
      btn.addEventListener('click', () => {
        if (btn.dataset.selectTier === 'core') return;
        selectedTier = btn.dataset.selectTier === 'pro' ? 'pro' : 'core';
        checkoutOpen = true;
        statusMsg = '';
        statusErr = false;
        render();
      });
    }
    rootEl.querySelector('#pr-checkout-close')?.addEventListener('click', () => {
      checkoutOpen = false;
      render();
    });
    rootEl.querySelector('#pr-checkout-modal')?.addEventListener('click', e => {
      if ((e.target as HTMLElement | null)?.id === 'pr-checkout-modal') {
        checkoutOpen = false;
        render();
      }
    });
    rootEl.querySelector('#pr-promo-apply')?.addEventListener('click', () => {
      promoCode = (rootEl.querySelector<HTMLInputElement>('#pr-promo-input')?.value || '').trim();
      promoApplied = Boolean(promoCode);
      render();
    });
    for (const btn of rootEl.querySelectorAll<HTMLElement>('[data-pay]')) {
      btn.addEventListener('click', () => {
        const nextPay = btn.dataset.pay;
        if (nextPay === 'card' || nextPay === 'apple' || nextPay === 'link') payMethod = nextPay;
        render();
      });
    }
    const numEl = rootEl.querySelector<HTMLInputElement>('#pr-card-num');
    numEl?.addEventListener('input', () => {
      const digits = numEl.value.replace(/\D/g, '').slice(0, 16);
      numEl.value = digits.replace(/(\d{4})(?=\d)/g, '$1 ');
    });
    rootEl.querySelector('#pr-checkout-form')?.addEventListener('submit', e => {
      e.preventDefault();
      const emailVal = (rootEl.querySelector<HTMLInputElement>('#pr-email')?.value || '').trim();
      if (!emailVal || !emailVal.includes('@')) {
        statusErr = true;
        statusMsg = 'Enter a valid billing email address.';
        render();
        return;
      }
      statusErr = false;
      statusMsg = 'Checkout UI preview complete — payment backend is not wired yet. No charge was made.';
      render();
    });
  }

  const show = (): void => {
    const wasVisible = visible;
    setOpen(true);
    render();
    if (!wasVisible) onShow?.();
  };

  const hide = (): void => {
    const wasVisible = visible;
    checkoutOpen = false;
    setOpen(false);
    if (wasVisible) onHide?.();
  };

  const toggle = (): void => {
    if (visible) hide();
    else show();
  };

  return {
    show,
    hide,
    toggle,
    refresh: () => { if (visible) render(); },
    get visible() { return visible; },
  };
}
