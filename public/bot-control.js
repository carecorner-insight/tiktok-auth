(() => {
  const $ = id => document.getElementById(id);
  let token = '', current = null, timer = null, busy = false, dirtyModel = false;
  function message(text, error = false) { $('message').textContent = text; $('message').className = error ? 'error' : ''; }
  function buttons() {
    $('login').disabled = busy;
    $('logout').disabled = busy;
    $('off').disabled = busy || !token || current?.mode?.enabled === false;
    $('on').disabled = busy || !token || current?.mode?.enabled === true;
    $('model').disabled = busy || !current?.modelEditable;
    $('saveModel').disabled = busy || !current?.modelEditable;
  }
  function render(data) {
    current = data;
    $('gate').hidden = true; $('settings').hidden = false;
    $('target').textContent = data.bot;
    $('environment').textContent = data.environment;
    $('scope').textContent = data.scope;
    $('deployment').textContent = data.deploymentSha || 'Local / not reported';
    $('mode').textContent = data.mode ? data.mode.enabled ? 'ON' : 'OFF · MAINTENANCE' : 'UNKNOWN';
    $('mode').className = 'badge' + (data.mode ? data.mode.enabled ? ' on' : ' off' : '');
    $('changed').textContent = data.mode ? data.mode.updatedAt ? 'Last set: ' + new Date(data.mode.updatedAt).toLocaleString() : 'No saved override; existing ON default.' : 'State cannot be confirmed. Coaching is blocked until the state can be read.';
    $('maintenanceCopy').textContent = data.maintenanceNotice;
    $('effectiveModel').textContent = data.effectiveModel || 'Unknown — model setting is unavailable';
    if (!dirtyModel) {
      $('model').replaceChildren();
      const option = document.createElement('option'); option.value = ''; option.textContent = 'Deployment default (' + data.defaultModel + ')'; $('model').append(option);
      for (const item of data.models) { const o = document.createElement('option'); o.value = item.id; o.textContent = item.label + ' (' + item.id + ')'; $('model').append(o); }
      $('model').value = data.model?.model || '';
    }
    help(); buttons();
  }
  function help() {
    $('modelHelp').textContent = !current?.modelEditable ? 'Unavailable: this deployment is not using the main direct-Qwen coach.'
      : current.models.find(item => item.id === $('model').value)?.description || 'Uses the model configured by the project administrator.';
  }
  async function request(body) {
    const response = await fetch('/api/bot-control', {
      method: body ? 'POST' : 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { 'x-bot-control-token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Control request failed');
    return data;
  }
  function unknown() { if (current) render({ ...current, mode: null, effectiveModel: null }); }
  async function refresh() {
    if (!token || busy) return;
    busy = true; buttons();
    try { render(await request()); message('Status refreshed.'); }
    catch { unknown(); message('Status unavailable. Check your connection or unlock again. No change is confirmed.', true); }
    finally { busy = false; buttons(); }
  }
  async function login() {
    token = $('password').value; $('password').value = '';
    if (!token) { message('Enter the Bot Control password.', true); return; }
    busy = true; buttons();
    try { render(await request()); message('Controls unlocked.'); timer = setInterval(refresh, 5000); }
    catch (error) { token = ''; message(error.message || 'Unable to unlock controls.', true); }
    finally { busy = false; buttons(); }
  }
  async function save(body, confirmation) {
    if (busy || !token || !window.confirm(confirmation + '\n\nTarget: ' + current.environment + ' — main CareyChats only.')) return;
    busy = true; buttons();
    try {
      const data = await request(body);
      const confirmed = 'enabled' in body ? data.mode?.enabled === body.enabled : data.model && data.model.model === body.model;
      dirtyModel = false; render(data);
      message(confirmed ? 'Saved and confirmed by the server.' : 'Save is unconfirmed or another operator changed the setting. Check the current status.', !confirmed);
    } catch { unknown(); message('Save is unconfirmed. The request may have reached the server. Wait for a status refresh before retrying.', true); }
    finally { busy = false; buttons(); }
  }
  $('login').addEventListener('click', login);
  $('password').addEventListener('keydown', event => { if (event.key === 'Enter' && !busy) login(); });
  $('off').addEventListener('click', () => save({ enabled: false }, 'Pause coaching and send only the maintenance notice? Automated crisis assessment will also stop.'));
  $('on').addEventListener('click', () => save({ enabled: true }, 'Resume coaching and normal AI processing?'));
  $('model').addEventListener('change', () => { dirtyModel = true; help(); });
  $('saveModel').addEventListener('click', () => save({ model: $('model').value || null }, 'Change the main coaching model from the next turn? Cost and reply quality may change.'));
  $('logout').addEventListener('click', () => {
    clearInterval(timer); timer = null; token = ''; current = null; dirtyModel = false;
    $('settings').hidden = true; $('gate').hidden = false; message('Controls locked.'); buttons();
  });
  window.addEventListener('pagehide', () => { clearInterval(timer); token = ''; });
  buttons();
})();
