(() => {
  const $ = id => document.getElementById(id);
  let token = '', current = null, timer = null, busy = false, dirtyModel = false;
  let metricsReport = null, metricsBusy = false, metricsGeneration = 0;
  function message(text, error = false) { $('message').textContent = text; $('message').className = error ? 'error' : ''; }
  function buttons() {
    $('login').disabled = busy;
    $('logout').disabled = busy;
    $('off').disabled = busy || !token || current?.mode?.enabled === false;
    $('on').disabled = busy || !token || current?.mode?.enabled === true;
    $('model').disabled = busy || !current?.modelEditable;
    $('saveModel').disabled = busy || !current?.modelEditable;
    $('loadMetrics').disabled = !token || metricsBusy;
    $('downloadMetrics').disabled = !token || metricsBusy || !metricsReport;
    $('downloadMonthlyItem').disabled = !token || metricsBusy || !metricsReport;
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
  async function request(body, query = '') {
    const response = await fetch('/api/bot-control' + query, {
      method: body ? 'POST' : 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(query ? 55000 : 12000),
      headers: { 'x-bot-control-token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Control request failed');
    return data;
  }
  function unknown() { if (current) render({ ...current, mode: null, effectiveModel: null }); }
  async function refresh() {
    if (!token || busy || !$('metricsPanel').hidden) return;
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

  function clearMetrics() {
    metricsGeneration += 1;
    metricsReport = null;
    metricsBusy = false;
    $('metricsResults').hidden = true;
    $('metricsCore').replaceChildren();
    $('metricsDetails').replaceChildren();
    $('metricsMessage').textContent = '';
    buttons();
  }
  function metricValue(metric) {
    if (metric.value === null) return metric.status === 'not_available' ? 'Not collected' : 'No denominator';
    return metric.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) + (metric.unit === 'percent' ? '%' : '');
  }
  function metricCounts(metric) {
    if (metric.denominator === null) return 'Count';
    return (metric.numerator === null ? 'Unknown' : metric.numerator.toLocaleString()) + ' / ' + metric.denominator.toLocaleString();
  }
  function textElement(tag, value, className) {
    const element = document.createElement(tag);
    element.textContent = value;
    if (className) element.className = className;
    return element;
  }
  function renderMetrics(data) {
    $('metricsCore').replaceChildren();
    $('metricsDetails').replaceChildren();
    for (const metric of data.metrics) {
      if (metric.group === 'core') {
        const card = textElement('article', '', 'metric-card');
        card.append(textElement('h3', metric.metricLabel), textElement('p', metricValue(metric), 'metric-value'));
        if (metric.unit === 'percent' && metric.value !== null) {
          const bar = document.createElement('progress');
          bar.max = 100; bar.value = Math.max(0, Math.min(100, metric.value));
          bar.setAttribute('aria-label', metric.metricLabel);
          card.append(bar);
        }
        card.append(textElement('p', metricCounts(metric), 'muted'), textElement('p', metric.note, 'muted'));
        $('metricsCore').append(card);
      } else {
        const row = document.createElement('tr');
        for (const value of [metric.metricLabel, metricValue(metric), metricCounts(metric), metric.note]) row.append(textElement('td', value));
        $('metricsDetails').append(row);
      }
    }
    $('metricsAsOf').textContent = 'Calculated ' + new Date(data.asOf).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' }) + ' SGT. Results can change with later answers or corrected history.';
    const health = ['Source: application event store. Microsoft delivery status below refers to raw events, not the monthly summary flow.'];
    if (!data.collectionEnabled) health.push('Collection is currently OFF. Historical results may still be available; new activity is not being collected.');
    if (!data.delivery.receiverConfigured) health.push('The raw-event Microsoft receiver is not configured.');
    health.push(data.delivery.pending + ' raw events awaiting Microsoft delivery.');
    if (data.delivery.lastFailure) health.push('A recent delivery/storage failure was recorded. Check the integration before treating collection as complete.');
    if (data.dataQuality.unknownAgeContacts) health.push(data.dataQuality.unknownAgeContacts + ' contacts excluded because age eligibility is unknown.');
    $('metricsHealth').textContent = health.join('\n');
    $('metricsRevision').textContent = 'Definition ' + data.definitionVersion + ' · revision ' + data.revision;
    $('metricsResults').hidden = false;
  }
  async function loadMetrics() {
    if (!token || metricsBusy) return;
    const month = $('metricsMonth').value;
    clearMetrics();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > $('metricsMonth').max || month < $('metricsMonth').min) {
      $('metricsMessage').textContent = 'Choose a month within the available reporting window.';
      $('metricsMessage').className = 'error';
      return;
    }
    const generation = metricsGeneration;
    metricsBusy = true; buttons();
    $('metricsMessage').textContent = 'Calculating this month…';
    $('metricsMessage').className = '';
    try {
      const data = await request(null, '?kpi=true&action=report&month=' + encodeURIComponent(month));
      // A locked page or changed month must not be repopulated by a late reply.
      if (!token || generation !== metricsGeneration) return;
      if (data.monthSGT !== month || !Array.isArray(data.metrics) || !data.metrics.length ||
          !data.metrics.every(metric => metric && typeof metric.metricLabel === 'string' &&
            (metric.value === null || Number.isFinite(metric.value)))) throw new Error('The report format is unavailable. Check that the latest version is deployed.');
      renderMetrics(data);
      metricsReport = data;
      $('metricsMessage').textContent = 'Report ready. Downloads contain the same calculations used by Power BI.';
    } catch (error) {
      if (!token || generation !== metricsGeneration) return;
      metricsReport = null; $('metricsResults').hidden = true;
      $('metricsMessage').textContent = error.message || 'Report unavailable. Existing Microsoft summaries have not been changed.';
      $('metricsMessage').className = 'error';
    } finally {
      if (generation === metricsGeneration) { metricsBusy = false; buttons(); }
    }
  }
  function selectTab(showMetrics) {
    $('operationsPanel').hidden = showMetrics;
    $('metricsPanel').hidden = !showMetrics;
    for (const [id, selected] of [['operationsTab', !showMetrics], ['metricsTab', showMetrics]]) {
      $(id).setAttribute('aria-selected', String(selected));
      $(id).tabIndex = selected ? 0 : -1;
    }
    if (showMetrics && !metricsReport && !metricsBusy) loadMetrics();
  }
  function downloadFile(contents, type, extension) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const link = document.createElement('a');
    link.href = url; link.download = 'carey-kpi-' + metricsReport.monthSGT + '.' + extension;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadCsv() {
    if (!metricsReport) return;
    const columns = ['monthSGT', 'metricCode', 'metricLabel', 'unit', 'value', 'numerator', 'denominator', 'status', 'note', 'asOf', 'definitionVersion'];
    const cell = value => {
      let text = value == null ? '' : String(value);
      // Spreadsheet applications must not interpret a label as a formula.
      if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    const rows = metricsReport.metrics.map(metric => ({ ...metric, monthSGT: metricsReport.monthSGT, asOf: metricsReport.asOf, definitionVersion: metricsReport.definitionVersion }));
    downloadFile([columns.map(cell).join(','), ...rows.map(row => columns.map(key => cell(row[key])).join(','))].join('\r\n'), 'text/csv;charset=utf-8', 'csv');
  }
  $('login').addEventListener('click', login);
  $('password').addEventListener('keydown', event => { if (event.key === 'Enter' && !busy) login(); });
  $('off').addEventListener('click', () => save({ enabled: false }, 'Pause coaching and send only the maintenance notice? Automated crisis assessment will also stop.'));
  $('on').addEventListener('click', () => save({ enabled: true }, 'Resume coaching and normal AI processing?'));
  $('model').addEventListener('change', () => { dirtyModel = true; help(); });
  $('saveModel').addEventListener('click', () => save({ model: $('model').value || null }, 'Change the main coaching model from the next turn? Cost and reply quality may change.'));
  $('logout').addEventListener('click', () => {
    clearInterval(timer); timer = null; token = ''; current = null; dirtyModel = false;
    clearMetrics(); selectTab(false);
    $('settings').hidden = true; $('gate').hidden = false; message('Controls locked.'); buttons();
  });
  $('operationsTab').addEventListener('click', () => selectTab(false));
  $('metricsTab').addEventListener('click', () => selectTab(true));
  for (const id of ['operationsTab', 'metricsTab']) $(id).addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const showMetrics = event.key === 'End' || (event.key !== 'Home' && id === 'operationsTab');
    selectTab(showMetrics); $(showMetrics ? 'metricsTab' : 'operationsTab').focus();
  });
  const sgtNow = new Date(Date.now() + 8 * 3600_000);
  $('metricsMonth').value = $('metricsMonth').max = sgtNow.toISOString().slice(0, 7);
  $('metricsMonth').min = new Date(Date.UTC(sgtNow.getUTCFullYear() - 1, sgtNow.getUTCMonth(), 1)).toISOString().slice(0, 7);
  $('metricsMonth').addEventListener('change', clearMetrics);
  $('loadMetrics').addEventListener('click', loadMetrics);
  $('downloadMetrics').addEventListener('click', downloadCsv);
  $('downloadMonthlyItem').addEventListener('click', () => { if (metricsReport) downloadFile(JSON.stringify(metricsReport.listItem, null, 2), 'application/json', 'json'); });
  window.addEventListener('pagehide', () => { clearInterval(timer); token = ''; clearMetrics(); });
  buttons();
})();
