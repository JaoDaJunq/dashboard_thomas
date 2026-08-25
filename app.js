const SHEET_ID = '1q2U2aHvxry0A4LBsZ3ge4CPdAPBw7T3gFfcqmZNEbKA';
const SHEET_GID = '0';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;
const REFRESH_INTERVAL_MS = 30_000;

const state = {
  readings: [],
  filtered: [],
  preset: 'all',
  isLoading: false,
};

const els = {
  connectionBadge: document.querySelector('#connectionBadge'),
  refreshButton: document.querySelector('#refreshButton'),
  errorBanner: document.querySelector('#errorBanner'),
  errorMessage: document.querySelector('#errorMessage'),
  currentLiters: document.querySelector('#currentLiters'),
  currentCost: document.querySelector('#currentCost'),
  currentPulses: document.querySelector('#currentPulses'),
  lastReadingAt: document.querySelector('#lastReadingAt'),
  periodLiters: document.querySelector('#periodLiters'),
  periodCost: document.querySelector('#periodCost'),
  periodPulses: document.querySelector('#periodPulses'),
  periodRecords: document.querySelector('#periodRecords'),
  chartTotal: document.querySelector('#chartTotal'),
  chartStart: document.querySelector('#chartStart'),
  chartEnd: document.querySelector('#chartEnd'),
  chartWrap: document.querySelector('#chartWrap'),
  chartEmpty: document.querySelector('#chartEmpty'),
  consumptionChart: document.querySelector('#consumptionChart'),
  readingsTableBody: document.querySelector('#readingsTableBody'),
  tableCount: document.querySelector('#tableCount'),
  lastSync: document.querySelector('#lastSync'),
  footerStatus: document.querySelector('#footerStatus'),
  dateFrom: document.querySelector('#dateFrom'),
  dateTo: document.querySelector('#dateTo'),
  applyFilterButton: document.querySelector('#applyFilterButton'),
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field);
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    if (row.some(cell => cell !== '')) rows.push(row);
  }

  return rows;
}

function parseLocaleNumber(value) {
  if (value == null) return NaN;
  let normalized = String(value).trim().replace(/R\$|\s/g, '');
  if (!normalized) return NaN;

  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }

  return Number(normalized);
}

function parseBrazilianDateTime(dateText, timeText) {
  const match = String(dateText || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;

  const [, day, month, year] = match;
  const time = String(timeText || '00:00:00').trim();
  const timeMatch = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!timeMatch) return null;

  const [, hour, minute, second = '0'] = timeMatch;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return Number.isNaN(date.getTime()) ? null : date;
}

function approximatelyEqual(a, b, tolerance = 0.06) {
  return Math.abs(a - b) <= Math.max(tolerance, Math.abs(b) * 0.002);
}

function buildReadings(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return [];

  const result = [];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const dateText = row[0];
    const timeText = row[1];
    const pulses = parseLocaleNumber(row[2]);
    const liters = parseLocaleNumber(row[3]);
    const value = parseLocaleNumber(row[4]);
    const timestamp = parseBrazilianDateTime(dateText, timeText);

    if (!timestamp || !Number.isFinite(pulses) || !Number.isFinite(liters) || !Number.isFinite(value)) continue;
    if (pulses < 0 || liters < 0 || value < 0) continue;

    // Ignora testes antigos e linhas incompletas. O padrão atual da planilha é:
    // 1 pulso = 10 L e 1 pulso = R$ 5,30.
    const matchesLiters = approximatelyEqual(liters, pulses * 10);
    const matchesValue = approximatelyEqual(value, pulses * 5.3);
    if (!matchesLiters || !matchesValue) continue;

    result.push({
      dateText: String(dateText).trim(),
      timeText: String(timeText).trim(),
      timestamp,
      pulses,
      liters,
      value,
      deltaPulses: 0,
      deltaLiters: 0,
      deltaValue: 0,
    });
  }

  result.sort((a, b) => a.timestamp - b.timestamp);

  result.forEach((reading, index) => {
    const previous = result[index - 1];
    let deltaPulses;

    if (!previous) {
      deltaPulses = reading.pulses;
    } else if (reading.pulses >= previous.pulses) {
      deltaPulses = reading.pulses - previous.pulses;
    } else {
      // Queda no contador = nova sessão/reinício do equipamento.
      deltaPulses = reading.pulses;
    }

    reading.deltaPulses = Math.max(0, deltaPulses);
    reading.deltaLiters = reading.deltaPulses * 10;
    reading.deltaValue = reading.deltaPulses * 5.3;
  });

  return result;
}

function formatNumber(value, maxDecimals = 0) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: maxDecimals }).format(value || 0);
}

function formatMoney(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(date);
}

function formatShortDate(date) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(date);
}

function toInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function setConnection(status, label) {
  els.connectionBadge.className = `status-badge status-${status}`;
  els.connectionBadge.innerHTML = '<span class="status-dot"></span>' + label;
}

function showError(message) {
  els.errorBanner.hidden = false;
  els.errorMessage.textContent = message;
  setConnection('error', 'Sem conexão');
  els.footerStatus.textContent = 'Falha ao sincronizar com a planilha';
}

function clearError() {
  els.errorBanner.hidden = true;
  els.errorMessage.textContent = '';
}

function activatePreset(name) {
  document.querySelectorAll('.preset-button').forEach(button => {
    button.classList.toggle('is-active', button.dataset.preset === name);
  });
  state.preset = name;
}

function getPresetRange(name) {
  if (!state.readings.length || name === 'all') return { from: null, to: null };

  // Usa a data mais recente da própria planilha como referência para que
  // os filtros funcionem também com dados de teste/históricos.
  const latest = new Date(state.readings[state.readings.length - 1].timestamp);
  const to = new Date(latest);
  to.setHours(23, 59, 59, 999);

  if (name === 'today') {
    const from = new Date(latest);
    from.setHours(0, 0, 0, 0);
    return { from, to };
  }

  const days = name === '7d' ? 7 : 30;
  const from = new Date(latest);
  from.setDate(from.getDate() - (days - 1));
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

function applyPreset(name) {
  activatePreset(name);
  const { from, to } = getPresetRange(name);
  els.dateFrom.value = from ? toInputDate(from) : '';
  els.dateTo.value = to ? toInputDate(to) : '';
  applyFilters();
}

function applyFilters() {
  let from = null;
  let to = null;

  if (els.dateFrom.value) {
    from = new Date(`${els.dateFrom.value}T00:00:00`);
  }
  if (els.dateTo.value) {
    to = new Date(`${els.dateTo.value}T23:59:59.999`);
  }

  state.filtered = state.readings.filter(reading => {
    if (from && reading.timestamp < from) return false;
    if (to && reading.timestamp > to) return false;
    return true;
  });

  renderPeriod();
}

function renderCurrent() {
  const latest = state.readings[state.readings.length - 1];
  if (!latest) {
    els.currentLiters.textContent = '--';
    els.currentCost.textContent = 'R$ --';
    els.currentPulses.textContent = '--';
    els.lastReadingAt.textContent = '--';
    return;
  }

  els.currentLiters.textContent = formatNumber(latest.liters, 2);
  els.currentCost.textContent = formatMoney(latest.value);
  els.currentPulses.textContent = formatNumber(latest.pulses, 2);
  els.lastReadingAt.textContent = formatDateTime(latest.timestamp);
}

function renderPeriod() {
  const readings = state.filtered;
  const totalPulses = readings.reduce((sum, reading) => sum + reading.deltaPulses, 0);
  const totalLiters = readings.reduce((sum, reading) => sum + reading.deltaLiters, 0);
  const totalValue = readings.reduce((sum, reading) => sum + reading.deltaValue, 0);

  els.periodLiters.textContent = `${formatNumber(totalLiters, 2)} L`;
  els.periodCost.textContent = formatMoney(totalValue);
  els.periodPulses.textContent = formatNumber(totalPulses, 2);
  els.periodRecords.textContent = formatNumber(readings.length);
  els.chartTotal.textContent = `${formatNumber(totalLiters, 2)} L`;

  renderChart(readings);
  renderTable(readings);
}

function renderChart(readings) {
  const svg = els.consumptionChart;
  svg.innerHTML = '';

  if (!readings.length) {
    els.chartWrap.hidden = true;
    els.chartEmpty.hidden = false;
    els.chartStart.textContent = '--';
    els.chartEnd.textContent = '--';
    return;
  }

  els.chartWrap.hidden = false;
  els.chartEmpty.hidden = true;

  const width = 900;
  const height = 300;
  const paddingX = 18;
  const paddingY = 22;
  const usableWidth = width - paddingX * 2;
  const usableHeight = height - paddingY * 2;

  let accumulated = 0;
  const series = readings.map(reading => {
    accumulated += reading.deltaLiters;
    return { ...reading, accumulated };
  });
  const maxValue = Math.max(...series.map(item => item.accumulated), 1);

  const points = series.map((item, index) => {
    const x = series.length === 1 ? width / 2 : paddingX + (index / (series.length - 1)) * usableWidth;
    const y = height - paddingY - (item.accumulated / maxValue) * usableHeight;
    return { x, y };
  });

  const ns = 'http://www.w3.org/2000/svg';

  for (let i = 0; i < 4; i += 1) {
    const y = paddingY + (i / 3) * usableHeight;
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', paddingX);
    line.setAttribute('x2', width - paddingX);
    line.setAttribute('y1', y);
    line.setAttribute('y2', y);
    line.setAttribute('stroke', 'rgba(255,255,255,.07)');
    line.setAttribute('stroke-width', '1');
    svg.appendChild(line);
  }

  if (points.length > 1) {
    const area = document.createElementNS(ns, 'path');
    const areaPath = `M ${points[0].x} ${height - paddingY} ` +
      points.map(point => `L ${point.x} ${point.y}`).join(' ') +
      ` L ${points[points.length - 1].x} ${height - paddingY} Z`;
    area.setAttribute('d', areaPath);
    area.setAttribute('fill', 'rgba(85,215,155,.10)');
    svg.appendChild(area);
  }

  const polyline = document.createElementNS(ns, 'polyline');
  polyline.setAttribute('points', points.map(point => `${point.x},${point.y}`).join(' '));
  polyline.setAttribute('fill', 'none');
  polyline.setAttribute('stroke', '#55d79b');
  polyline.setAttribute('stroke-width', '4');
  polyline.setAttribute('stroke-linecap', 'round');
  polyline.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(polyline);

  const lastPoint = points[points.length - 1];
  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('cx', lastPoint.x);
  dot.setAttribute('cy', lastPoint.y);
  dot.setAttribute('r', '7');
  dot.setAttribute('fill', '#55d79b');
  dot.setAttribute('stroke', '#08111f');
  dot.setAttribute('stroke-width', '4');
  svg.appendChild(dot);

  els.chartStart.textContent = `${formatShortDate(readings[0].timestamp)} ${readings[0].timeText.slice(0, 5)}`;
  els.chartEnd.textContent = `${formatShortDate(readings[readings.length - 1].timestamp)} ${readings[readings.length - 1].timeText.slice(0, 5)}`;
}

function renderTable(readings) {
  const recent = [...readings].reverse().slice(0, 50);
  els.readingsTableBody.innerHTML = '';

  if (!recent.length) {
    els.readingsTableBody.innerHTML = '<tr><td colspan="6" class="muted">Nenhuma leitura no período selecionado.</td></tr>';
    els.tableCount.textContent = '0 registros';
    return;
  }

  const fragment = document.createDocumentFragment();
  recent.forEach(reading => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${reading.dateText}</td>
      <td>${reading.timeText}</td>
      <td>${formatNumber(reading.pulses, 2)}</td>
      <td>${formatNumber(reading.liters, 2)} L</td>
      <td>${formatMoney(reading.value)}</td>
      <td class="increment-positive">+${formatNumber(reading.deltaLiters, 2)} L</td>
    `;
    fragment.appendChild(tr);
  });

  els.readingsTableBody.appendChild(fragment);
  els.tableCount.textContent = `${readings.length} ${readings.length === 1 ? 'registro' : 'registros'}`;
}

async function loadData({ silent = false } = {}) {
  if (state.isLoading) return;
  state.isLoading = true;

  if (!silent) setConnection('loading', 'Atualizando');
  els.refreshButton.disabled = true;

  try {
    const separator = SHEET_CSV_URL.includes('?') ? '&' : '?';
    const response = await fetch(`${SHEET_CSV_URL}${separator}_=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Google Sheets respondeu com HTTP ${response.status}.`);

    const csvText = await response.text();
    const readings = buildReadings(csvText);
    if (!readings.length) {
      throw new Error('A planilha respondeu, mas nenhuma linha válida no padrão Pulsos → Litros → Valor foi encontrada.');
    }

    state.readings = readings;
    clearError();
    renderCurrent();

    if (state.preset === 'all' && !els.dateFrom.value && !els.dateTo.value) {
      state.filtered = [...readings];
      renderPeriod();
    } else if (state.preset !== 'all') {
      const { from, to } = getPresetRange(state.preset);
      els.dateFrom.value = from ? toInputDate(from) : '';
      els.dateTo.value = to ? toInputDate(to) : '';
      applyFilters();
    } else {
      applyFilters();
    }

    const now = new Date();
    els.lastSync.textContent = formatDateTime(now);
    els.footerStatus.textContent = `${readings.length} leituras válidas sincronizadas`;
    setConnection('ok', 'Online');
  } catch (error) {
    console.error(error);
    showError(`${error.message} Confirme se a planilha está acessível para qualquer pessoa com o link ou publicada para visualização.`);
  } finally {
    state.isLoading = false;
    els.refreshButton.disabled = false;
  }
}

document.querySelectorAll('.preset-button').forEach(button => {
  button.addEventListener('click', () => applyPreset(button.dataset.preset));
});

els.applyFilterButton.addEventListener('click', () => {
  activatePreset('custom');
  document.querySelectorAll('.preset-button').forEach(button => button.classList.remove('is-active'));
  applyFilters();
});

els.refreshButton.addEventListener('click', () => loadData());

loadData();
setInterval(() => loadData({ silent: true }), REFRESH_INTERVAL_MS);
