const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const NAMES = { claude: 'Claude', gemini: 'Gemini', codex: 'Codex', deepseek: 'DeepSeek' };
const clock = at => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
function resetTime(resets) {
  const date = new Date(resets);
  return resets && /^\d{4}-/.test(resets) && !Number.isNaN(date.getTime()) ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : resets;
}
const describe = meter => meter.text ? `${meter.label}: ${meter.text}` : `${meter.label}: ${meter.used}% used${meter.resets ? `, resets ${resetTime(meter.resets)}` : ''}`;
const level = meter => meter.level ?? (meter.used >= 95 ? 'full' : meter.used >= 80 ? 'high' : '');
// How much of each plan is used, as its CLI reports it, and what's left of DeepSeek's prepaid balance. The sidebar shows the two limits that matter, and hovering shows the rest.
export function setupPlanUsage({ api, root }) {
  function draw(plans = {}) {
    const names = Object.keys(NAMES).filter(name => plans[name]?.meters.length);
    root.hidden = !names.length;
    root.replaceChildren(...names.map(name => {
      const plan = plans[name], row = element('button', 'plan-row');
      row.type = 'button';
      row.title = [...plan.meters.map(describe), `${plan.failed ? 'Couldn’t update just now. These are from' : 'Updated'} ${clock(plan.at)}. Click to update.`].join('\n');
      row.setAttribute('aria-label', `${NAMES[name]} plan. ${row.title}`);
      row.onclick = () => api.planUsageRefresh().then(draw).catch(() => {});
      row.append(element('span', 'plan-name', NAMES[name]));
      for (const meter of plan.meters.filter(item => item.short)) {
        const part = element('span', `plan-meter ${level(meter)}`), track = element('span', 'plan-track'), fill = element('span', 'plan-fill');
        fill.style.width = `${meter.used}%`;
        track.append(fill);
        part.append(element('span', 'plan-short', meter.short), ...(meter.text ? [] : [track]), element('span', 'plan-number', meter.text ?? `${meter.used}%`));
        row.append(part);
      }
      return row;
    }));
  }
  if (api?.planUsage) { api.planUsage().then(draw).catch(() => {}); api.onPlanUsage(draw); }
}
