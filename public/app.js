/* ══════════════════════════════════════════
   SBS COOPAC + INSACO LAFT — App Client JS
   ══════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── Estado global ─────────────────────────────────
  let currentJobId = null;
  let pollingTimer = null;
  let lastStepCount = 0;

  const STEP_ICONS = {
    info:    '⏳',
    success: '✅',
    error:   '❌',
    warn:    '⚠️'
  };

  // ─── Elementos DOM ──────────────────────────────────
  const queryForm    = document.getElementById('queryForm');
  const consultantName = document.getElementById('consultantName');
  const docType      = document.getElementById('docType');
  const docNumber    = document.getElementById('docNumber');
  const queryBtn     = document.getElementById('queryBtn');
  const queryIcon    = document.getElementById('queryIcon');
  const queryBtnText = document.getElementById('queryBtnText');
  const querySpinner = document.getElementById('querySpinner');
  const queryError   = document.getElementById('queryError');
  const queryErrText = document.getElementById('queryErrorText');

  const queueSection   = document.getElementById('queueSection');
  const queueCount     = document.getElementById('queueCount');
  const queueTableBody = document.getElementById('queueTableBody');

  const progressSection = document.getElementById('progressSection');
  const progressBar     = document.getElementById('progressBar');
  const progressDoc     = document.getElementById('progressDoc');
  const pulseDot        = document.getElementById('pulseDot');
  const stepsLog        = document.getElementById('stepsLog');

  const resultsSection  = document.getElementById('resultsSection');
  const sbsGallery      = document.getElementById('sbsGallery');
  const sbsResultsCount = document.getElementById('sbsResultsCount');
  const insacoBadge     = document.getElementById('insacoBadge');
  const insacoMeta      = document.getElementById('insacoResultMeta');
  const insacoBlock     = document.getElementById('insacoResultBlock');
  const newQueryBtn     = document.getElementById('newQueryBtn');

  const imageModal    = document.getElementById('imageModal');
  const modalImg      = document.getElementById('modalImg');
  const modalLabel    = document.getElementById('modalLabel');
  const modalDownload = document.getElementById('modalDownload');
  const modalClose    = document.getElementById('modalClose');

  const logoutBtn    = document.getElementById('logoutBtn');
  const navUsername  = document.getElementById('navUsername');

  // ─── Init ───────────────────────────────────────────
  async function init() {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) { window.location.href = '/login'; return; }
      const data = await res.json();
      if (navUsername) navUsername.textContent = data.username;
      
      // Iniciar polling de cola de espera general
      setInterval(pollQueue, 3000);
      pollQueue();
    } catch {
      window.location.href = '/login';
    }
  }

  // ─── Logout ─────────────────────────────────────────
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    });
  }

  // ─── Validación de input según tipo de documento ───
  docType && docType.addEventListener('change', () => {
    const type = docType.value;
    if (type === 'DNI') {
      docNumber.placeholder = 'Ej: 74659034 (8 dígitos)';
      docNumber.maxLength = 8;
    } else if (type === 'RUC') {
      docNumber.placeholder = 'Ej: 10746590341 (11 dígitos)';
      docNumber.maxLength = 11;
    } else if (type === 'CE') {
      docNumber.placeholder = 'Ej: 000123456 (5-15 caracteres)';
      docNumber.maxLength = 15;
    }
  });

  // ─── Submit consulta ────────────────────────────────
  queryForm && queryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name   = consultantName ? consultantName.value.trim() : 'Anónimo';
    const type   = docType.value.trim();
    const number = docNumber.value.trim();

    // Validación básica
    queryError.classList.add('hidden');
    if (!number) {
      queryErrText.textContent = 'Ingresa el número de documento';
      queryError.classList.remove('hidden');
      docNumber.focus();
      return;
    }
    if (type === 'DNI' && !/^\d{8}$/.test(number)) {
      queryErrText.textContent = 'El DNI debe tener exactamente 8 dígitos';
      queryError.classList.remove('hidden');
      return;
    }
    if (type === 'RUC' && !/^\d{11}$/.test(number)) {
      queryErrText.textContent = 'El RUC debe tener exactamente 11 dígitos';
      queryError.classList.remove('hidden');
      return;
    }
    if (type === 'CE' && number.length < 5) {
      queryErrText.textContent = 'El Carnet de Extranjería debe tener al menos 5 caracteres';
      queryError.classList.remove('hidden');
      return;
    }

    // Resetear estado anterior
    resetResults();

    // UI: loading
    queryBtn.disabled = true;
    queryIcon.classList.add('hidden');
    querySpinner.classList.remove('hidden');
    queryBtnText.textContent = 'Iniciando...';

    try {
      const res = await fetch('/api/consultar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, number, consultantName: name })
      });

      if (res.status === 401) { window.location.href = '/login'; return; }

      const data = await res.json();
      if (!res.ok) {
        showQueryError(data.error || 'Error al iniciar la consulta');
        resetQueryBtn();
        return;
      }

      currentJobId = data.jobId;
      showProgress(type, number);
      startPolling();
    } catch (err) {
      showQueryError('Error de conexión. ¿El servidor está activo?');
      resetQueryBtn();
    }
  });

  // ─── Polling ────────────────────────────────────────
  function startPolling() {
    if (pollingTimer) clearInterval(pollingTimer);
    pollingTimer = setInterval(pollJob, 1800);
  }

  function stopPolling() {
    if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; }
  }

  async function pollJob() {
    if (!currentJobId) return;
    try {
      const res = await fetch(`/api/estado/${currentJobId}`);
      if (res.status === 401) { window.location.href = '/login'; return; }
      const job = await res.json();
      updateProgress(job);
      if (job.status === 'done' || job.status === 'error') {
        stopPolling();
        finishJob(job);
      }
    } catch {
      // Silencio en errores transitorios de red
    }
  }

  async function pollQueue() {
    try {
      const res = await fetch('/api/queue');
      if (!res.ok) return;
      const data = await res.json();
      
      const q = data.queue || [];
      if (q.length > 0) {
        if (queueSection) queueSection.classList.remove('hidden');
        if (queueCount) queueCount.textContent = q.length;
        
        if (queueTableBody) {
          let html = '';
          q.forEach(item => {
            html += `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
              <td style="padding: 0.75rem 0.5rem; color: ${item.status === 'Procesando' ? '#4ade80' : '#fbbf24'};">${escHtml(item.status)}</td>
              <td style="padding: 0.75rem 0.5rem; color: #f8fafc;">${escHtml(item.consultantName)}</td>
              <td style="padding: 0.75rem 0.5rem;">${escHtml(item.docType)}</td>
              <td style="padding: 0.75rem 0.5rem;">${escHtml(item.docNumber)}</td>
            </tr>`;
          });
          queueTableBody.innerHTML = html;
        }
      } else {
        if (queueSection) queueSection.classList.add('hidden');
      }
    } catch (e) {
      // silencio
    }
  }

  // ─── UI: Progreso ────────────────────────────────────
  function showProgress(type, number) {
    progressSection.classList.remove('hidden');
    resultsSection.classList.add('hidden');
    progressDoc.textContent = `${type}: ${number}`;
    stepsLog.innerHTML = '';
    lastStepCount = 0;
    progressBar.style.width = '5%';
    pulseDot.className = 'pulse-dot';
  }

  function updateProgress(job) {
    // Nuevos pasos del log
    const newSteps = job.steps.slice(lastStepCount);
    newSteps.forEach(step => {
      const el = document.createElement('div');
      el.className = `step-item step-${step.type}`;
      el.innerHTML = `<span class="step-icon">${STEP_ICONS[step.type] || '▸'}</span><span>${escHtml(step.text)}</span>`;
      stepsLog.appendChild(el);
    });
    lastStepCount = job.steps.length;

    // Auto-scroll
    stepsLog.scrollTop = stepsLog.scrollHeight;

    // Barra de progreso estimada
    const sbsDone = job.sbsResults.length > 0 || (job.steps.some(s => s.text.includes('INSACO')));
    const insacoDone = job.insacoResult !== null;
    if (insacoDone)      progressBar.style.width = '95%';
    else if (sbsDone)    progressBar.style.width = '55%';
    else                 progressBar.style.width = '20%';
  }

  function finishJob(job) {
    progressBar.style.width = '100%';
    if (job.status === 'error') {
      pulseDot.className = 'pulse-dot error';
      addStep(job.error || 'Error desconocido', 'error');
    } else {
      pulseDot.className = 'pulse-dot done';
    }

    resetQueryBtn();
    fetchHistory(); // Actualizar el historial al terminar una consulta

    // Mostrar resultados con delay para que se vea el 100%
    setTimeout(() => renderResults(job), 500);
  }

  function addStep(text, type = 'info') {
    const el = document.createElement('div');
    el.className = `step-item step-${type}`;
    el.innerHTML = `<span class="step-icon">${STEP_ICONS[type] || '▸'}</span><span>${escHtml(text)}</span>`;
    stepsLog.appendChild(el);
    stepsLog.scrollTop = stepsLog.scrollHeight;
  }

  // ─── UI: Resultados ──────────────────────────────────
  function renderResults(job) {
    resultsSection.classList.remove('hidden');

    // ── SBS Gallery ──
    sbsGallery.innerHTML = '';
    if (job.sbsResults && job.sbsResults.length > 0) {
      sbsResultsCount.textContent = `${job.sbsResults.length} módulo(s) capturado(s)`;
      job.sbsResults.forEach((item, idx) => {
        const card = document.createElement('div');
        card.className = 'gallery-item';
        card.style.animationDelay = `${idx * 0.07}s`;
        card.innerHTML = `
          <img class="gallery-item-img" src="${item.url}" alt="${escAttr(item.label)}" loading="lazy" />
          <div class="gallery-item-label">${escHtml(item.label)}</div>
        `;
        card.addEventListener('click', () => openModal(item.url, item.label));
        sbsGallery.appendChild(card);
      });
    } else {
      sbsResultsCount.textContent = '';
      sbsGallery.innerHTML = `<div class="step-item step-warn"><span class="step-icon">⚠️</span><span>No se obtuvieron capturas de SBS COOPAC</span></div>`;
    }

    // ── INSACO — card con mismo formato que galería SBS ──
    insacoBlock.innerHTML = '';
    if (job.insacoResult) {
      const hasMatches = job.insacoResult.hasMatches;
      const matchClass = hasMatches ? 'has-matches' : 'no-matches';
      const matchIcon  = hasMatches ? '⚠️' : '📋';
      const matchTitle = hasMatches ? '¡Coincidencias en listas PLAFT!' : 'Sin coincidencias en listas PLAFT';
      const matchDesc  = hasMatches
        ? 'Se encontraron registros. Revise el reporte.'
        : 'No registra coincidencias en listas de prevención.';
      const ext = job.insacoResult.filename?.split('.').pop() || 'pdf';
      const isPdf = ext === 'pdf';
      const fileLabel = isPdf ? 'Reporte PDF' : `Reporte ${ext.toUpperCase()}`;

      insacoBadge.className = `results-badge ${hasMatches ? 'badge-warn' : 'badge-green'}`;
      insacoMeta.textContent = `1 reporte generado`;

      // Card con formato idéntico a gallery-item
      const card = document.createElement('div');
      card.className = 'insaco-card';
      card.innerHTML = `
        <a href="/api/descargar/${currentJobId}" target="_blank" rel="noopener"
           class="insaco-card-thumb ${matchClass}" title="Ver ${fileLabel}">
          <span class="insaco-card-status">${escHtml(matchTitle)}</span>
          <span class="insaco-card-desc">${escHtml(matchDesc)}</span>
        </a>
        <div class="insaco-card-footer">
          <span class="insaco-card-label ${matchClass}">${escHtml(fileLabel)} — INSACO LAFT</span>
          <a href="/api/descargar/${currentJobId}"
             download="${escAttr(job.insacoResult.filename || 'INSACO_reporte.pdf')}"
             class="btn btn-ghost btn-sm"
             title="Descargar archivo">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
            Descargar
          </a>
        </div>
      `;
      insacoBlock.appendChild(card);
    } else {
      insacoMeta.textContent = '';
      insacoBlock.innerHTML = `<div class="step-item step-warn"><span class="step-icon">⚠️</span><span>No se obtuvo resultado de INSACO LAFT</span></div>`;
    }

    // Scroll suave a los resultados
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ─── Modal de imagen ────────────────────────────────
  function openModal(url, label) {
    modalImg.src = url;
    modalLabel.textContent = label;
    modalDownload.href = url;
    modalDownload.download = label + '.png';
    imageModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    imageModal.classList.add('hidden');
    modalImg.src = '';
    document.body.style.overflow = '';
  }

  modalClose && modalClose.addEventListener('click', closeModal);
  imageModal && imageModal.addEventListener('click', (e) => { if (e.target === imageModal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  // ─── Nueva consulta ──────────────────────────────────
  newQueryBtn && newQueryBtn.addEventListener('click', () => {
    resetResults();
    progressSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    docNumber.value = '';
    docNumber.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // ─── Helpers ─────────────────────────────────────────
  function resetQueryBtn() {
    queryBtn.disabled = false;
    queryIcon.classList.remove('hidden');
    querySpinner.classList.add('hidden');
    queryBtnText.textContent = 'Consultar';
  }

  function showQueryError(msg) {
    queryErrText.textContent = msg;
    queryError.classList.remove('hidden');
  }

  function resetResults() {
    currentJobId = null;
    lastStepCount = 0;
    stopPolling();
    sbsGallery.innerHTML = '';
    insacoBlock.innerHTML = '';
    stepsLog.innerHTML = '';
    progressBar.style.width = '5%';
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function escAttr(str) { return escHtml(str); }

  // ─── Historial Dinámico ────────────────────────────────
  const historyList = document.getElementById('historyList');
  const historyDateLabel = document.getElementById('historyDateLabel');

  async function fetchHistory() {
    try {
      const res = await fetch('/api/history');
      if (!res.ok) return;
      const data = await res.json();
      
      if (historyDateLabel) {
        historyDateLabel.textContent = data.date || 'Hoy';
      }

      if (historyList) {
        if (!data.history || data.history.length === 0) {
          historyList.innerHTML = '<div class="history-empty">No hay consultas aún</div>';
          return;
        }

        let html = '';
        data.history.forEach(item => {
          html += `
            <div class="history-item">
              <div class="history-item-info">
                <span class="history-item-name">${escHtml(item.consultantName)}</span>
                <span class="history-item-doc">${escHtml(item.docType)}: ${escHtml(item.docNumber)}</span>
              </div>
              <span class="history-item-time">${escHtml(item.time)}</span>
            </div>
          `;
        });
        historyList.innerHTML = html;
      }
    } catch (e) {
      console.error('Error fetching history:', e);
    }
  }

  // ─── Arrancar ────────────────────────────────────────
  init();
  fetchHistory();

})();
