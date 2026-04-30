// ─── State ───────────────────────────────────────────────────────────────────
let isRecording = false;
let recognition = null;
let finalTranscript = '';
let timerInterval = null;
let elapsedSeconds = 0;
let audioCtx = null;
let analyser = null;
let animFrame = null;
let mediaStream = null;
let selectedDeviceId = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const recordBtn         = document.getElementById('recordBtn');
const recordIcon        = document.getElementById('recordIcon');
const recordLabel       = document.getElementById('recordLabel');
const timer             = document.getElementById('timer');
const statusBar         = document.getElementById('statusBar');
const transcriptBox     = document.getElementById('transcriptBox');
const summarizeBtn      = document.getElementById('summarizeBtn');
const summarizeBtnTxt   = document.getElementById('summarizeBtnText');
const clearBtn          = document.getElementById('clearBtn');
const newBtn            = document.getElementById('newBtn');
const historyList       = document.getElementById('historyList');
const recordView        = document.getElementById('recordView');
const summaryView       = document.getElementById('summaryView');
const loadingOverlay    = document.getElementById('loadingOverlay');
const canvas            = document.getElementById('visualizer');
const ctx2d             = canvas.getContext('2d');
const meetingTitle      = document.getElementById('meetingTitle');
const backBtn           = document.getElementById('backBtn');
const summaryTitle      = document.getElementById('summaryTitle');
const summaryDate       = document.getElementById('summaryDate');
const summaryBody       = document.getElementById('summaryBody');
const summaryTranscript = document.getElementById('summaryTranscript');
const copyBtn           = document.getElementById('copyBtn');
const notionBtn         = document.getElementById('notionBtn');
const notionSettingsBtn = document.getElementById('notionSettingsBtn');
const notionModal       = document.getElementById('notionModal');
const notionModalClose  = document.getElementById('notionModalClose');
const notionModalCancel = document.getElementById('notionModalCancel');
const notionModalSave   = document.getElementById('notionModalSave');
const notionTokenInput  = document.getElementById('notionToken');
const notionPageIdInput = document.getElementById('notionPageId');
const micSelect         = { value: null, disabled: false }; // Web Speech API はシステムデフォルトマイクを使用

// Context inputs
const templateSelect    = document.getElementById('templateSelect');
const templateMgrBtn    = document.getElementById('templateMgrBtn');
const meetingTypeInput  = document.getElementById('meetingType');
const participantsInput = document.getElementById('participants');
const agendaInput       = document.getElementById('agenda');

// Template modal
const templateModal      = document.getElementById('templateModal');
const templateModalClose = document.getElementById('templateModalClose');
const tplList            = document.getElementById('tplList');
const tplNewBtn          = document.getElementById('tplNewBtn');
const tplCancelBtn       = document.getElementById('tplCancelBtn');
const tplSaveBtn         = document.getElementById('tplSaveBtn');
const tplDeleteBtn       = document.getElementById('tplDeleteBtn');
const tplNameInput       = document.getElementById('tplName');
const tplTypeInput       = document.getElementById('tplType');
const tplParticipantsInput = document.getElementById('tplParticipants');
const tplAgendaInput     = document.getElementById('tplAgenda');

let currentMeetingId = null;
let editingTplId = null;

// ─── Templates ───────────────────────────────────────────────────────────────
const DEFAULT_TEMPLATES = [
  { id: 'tpl_discussion', name: 'ディスカッション', meeting_type: 'ディスカッション', participants: '', agenda: '' },
  { id: 'tpl_brainstorm', name: 'ブレインストーミング', meeting_type: 'ブレインストーミング', participants: '', agenda: '' },
  { id: 'tpl_1on1', name: '1on1', meeting_type: '1on1', participants: '', agenda: '' },
  { id: 'tpl_retro', name: '振り返り（レトロ）', meeting_type: '振り返り（レトロ）', participants: '', agenda: '' },
  { id: 'tpl_lecture', name: '講義・勉強会', meeting_type: '講義・勉強会', participants: '', agenda: '' },
];

function loadTemplates() {
  const s = localStorage.getItem('meetingTemplates');
  return s ? JSON.parse(s) : JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
}

function saveTemplates(templates) {
  localStorage.setItem('meetingTemplates', JSON.stringify(templates));
}

function genId() {
  return 'tpl_' + Math.random().toString(36).slice(2, 10);
}

function populateTemplateSelect() {
  const templates = loadTemplates();
  const current = templateSelect.value;
  templateSelect.innerHTML = '<option value="">── テンプレートを選択 ──</option>';
  templates.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    templateSelect.appendChild(opt);
  });
  if (current) templateSelect.value = current;
}

templateSelect.addEventListener('change', () => {
  const id = templateSelect.value;
  if (!id) return;
  const tpl = loadTemplates().find(t => t.id === id);
  if (!tpl) return;
  meetingTypeInput.value  = tpl.meeting_type  || '';
  participantsInput.value = tpl.participants   || '';
  agendaInput.value       = tpl.agenda        || '';
});

// ── Template modal ──────────────────────────────────────────────────��─────────
function openTemplateModal() {
  renderTplList();
  selectTplItem(null);
  templateModal.classList.remove('hidden');
}

function closeTemplateModal() {
  templateModal.classList.add('hidden');
}

function renderTplList() {
  const templates = loadTemplates();
  tplList.innerHTML = '';
  templates.forEach(t => {
    const li = document.createElement('li');
    li.className = 'tpl-list-item' + (t.id === editingTplId ? ' active' : '');
    li.textContent = t.name;
    li.dataset.id = t.id;
    li.addEventListener('click', () => selectTplItem(t.id));
    tplList.appendChild(li);
  });
}

function selectTplItem(id) {
  editingTplId = id;
  document.querySelectorAll('.tpl-list-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });
  if (!id) {
    tplNameInput.value = '';
    tplTypeInput.value = '';
    tplParticipantsInput.value = '';
    tplAgendaInput.value = '';
    tplDeleteBtn.classList.add('hidden');
    return;
  }
  const tpl = loadTemplates().find(t => t.id === id);
  if (!tpl) return;
  tplNameInput.value         = tpl.name         || '';
  tplTypeInput.value         = tpl.meeting_type  || '';
  tplParticipantsInput.value = tpl.participants  || '';
  tplAgendaInput.value       = tpl.agenda        || '';
  tplDeleteBtn.classList.remove('hidden');
}

templateMgrBtn.addEventListener('click', openTemplateModal);
templateModalClose.addEventListener('click', closeTemplateModal);
tplCancelBtn.addEventListener('click', closeTemplateModal);
templateModal.addEventListener('click', e => { if (e.target === templateModal) closeTemplateModal(); });

tplNewBtn.addEventListener('click', () => {
  editingTplId = null;
  document.querySelectorAll('.tpl-list-item').forEach(el => el.classList.remove('active'));
  tplNameInput.value = '';
  tplTypeInput.value = '';
  tplParticipantsInput.value = '';
  tplAgendaInput.value = '';
  tplDeleteBtn.classList.add('hidden');
  tplNameInput.focus();
});

tplSaveBtn.addEventListener('click', () => {
  const name = tplNameInput.value.trim();
  if (!name) { alert('テンプレート名を入力してください'); return; }

  const templates = loadTemplates();
  if (editingTplId) {
    const idx = templates.findIndex(t => t.id === editingTplId);
    if (idx !== -1) {
      templates[idx] = {
        id: editingTplId,
        name,
        meeting_type: tplTypeInput.value.trim(),
        participants: tplParticipantsInput.value.trim(),
        agenda: tplAgendaInput.value.trim(),
      };
    }
  } else {
    const newTpl = {
      id: genId(),
      name,
      meeting_type: tplTypeInput.value.trim(),
      participants: tplParticipantsInput.value.trim(),
      agenda: tplAgendaInput.value.trim(),
    };
    templates.push(newTpl);
    editingTplId = newTpl.id;
  }

  saveTemplates(templates);
  populateTemplateSelect();
  renderTplList();
  document.querySelectorAll('.tpl-list-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === editingTplId);
  });
  tplDeleteBtn.classList.remove('hidden');
});

tplDeleteBtn.addEventListener('click', () => {
  if (!editingTplId) return;
  if (!confirm('このテンプレートを削除しますか？')) return;
  const templates = loadTemplates().filter(t => t.id !== editingTplId);
  saveTemplates(templates);
  editingTplId = null;
  populateTemplateSelect();
  renderTplList();
  selectTplItem(null);
});

// ─── Microphone permission ────────────────────────────────────────────────────
async function loadMicDevices() {
  try {
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    tempStream.getTracks().forEach(t => t.stop());
  } catch {
    setStatus('マイクへのアクセスが拒否されました', true);
  }
}

// ─── Speech Recognition ───────────────────────────────────────────────────────
function initRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    setStatus('このブラウザは音声認識に対応していません。Chromeをお使いください。', true);
    recordBtn.disabled = true;
    return null;
  }
  const r = new SR();
  r.lang = 'ja-JP';
  r.continuous = true;
  r.interimResults = true;

  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        finalTranscript += t;
      } else {
        interim += t;
      }
    }
    renderTranscript(interim);
    updateSummarizeBtn();
  };

  r.onerror = (e) => {
    if (e.error === 'no-speech') return;
    if (e.error === 'aborted') return;
    if (e.error === 'audio-capture') {
      setStatus('マイクが切断されました。別のマイクを選択してください。', true);
      stopRecording();
      return;
    }
    setStatus(`エラー: ${e.error}`, true);
  };

  // auto-restart on timeout (browser stops after ~60s of silence)
  r.onend = () => {
    if (isRecording) {
      try { r.start(); } catch { /* already started */ }
    }
  };

  return r;
}

function renderTranscript(interim = '') {
  if (!finalTranscript && !interim) {
    transcriptBox.innerHTML = '<span class="placeholder">録音を開始すると、ここにリアルタイムで文字が表示されます</span>';
    return;
  }
  transcriptBox.innerHTML =
    escapeHtml(finalTranscript) +
    (interim ? `<span class="interim"> ${escapeHtml(interim)}</span>` : '');
  transcriptBox.scrollTop = transcriptBox.scrollHeight;
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Audio Visualizer ─────────────────────────────────────────────────────────
async function startVisualizer() {
  try {
    const constraints = {
      audio: selectedDeviceId
        ? { deviceId: { exact: selectedDeviceId } }
        : true,
    };
    mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    const source = audioCtx.createMediaStreamSource(mediaStream);
    source.connect(analyser);
    drawVisualizer();
    return true;
  } catch (err) {
    setStatus(`マイクへのアクセスに失敗しました: ${err.message}`, true);
    return false;
  }
}

function drawVisualizer() {
  const buf = new Uint8Array(analyser.frequencyBinCount);
  const W = canvas.width, H = canvas.height;

  function frame() {
    animFrame = requestAnimationFrame(frame);
    analyser.getByteFrequencyData(buf);
    ctx2d.clearRect(0, 0, W, H);

    const barW = W / buf.length * 2;
    let x = 0;
    buf.forEach(v => {
      const h = (v / 255) * H;
      const alpha = 0.4 + (v / 255) * 0.6;
      ctx2d.fillStyle = `rgba(35,131,226,${alpha})`;
      ctx2d.beginPath();
      ctx2d.roundRect(x, H / 2 - h / 2, barW - 2, h, 2);
      ctx2d.fill();
      x += barW;
    });
  }
  frame();
}

function stopVisualizer() {
  if (animFrame) cancelAnimationFrame(animFrame);
  if (analyser) analyser.disconnect();
  if (audioCtx) audioCtx.close();
  if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
  ctx2d.clearRect(0, 0, canvas.width, canvas.height);
  audioCtx = analyser = mediaStream = null;
}

// ─── Timer ────────────────────────────────────────────────────────────────────
function startTimer() {
  elapsedSeconds = 0;
  timerInterval = setInterval(() => {
    elapsedSeconds++;
    const m = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
    const s = String(elapsedSeconds % 60).padStart(2, '0');
    timer.textContent = `${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

// ─── Recording toggle ─────────────────────────────────────────────────────────
async function toggleRecording() {
  if (!isRecording) {
    recognition = initRecognition();
    if (!recognition) return;

    const ok = await startVisualizer();
    if (!ok) return;

    // getUserMedia で選択デバイスを確保してから SpeechRecognition を開始すると
    // Chrome が同じデバイスを使用する可能性が高まる
    recognition.start();
    isRecording = true;
    startTimer();
    micSelect.disabled = true;

    recordBtn.classList.add('recording');
    recordIcon.textContent = '■';
    recordLabel.textContent = '録音停止';
    setStatus('録音中... マイクに向かって話してください');
  } else {
    stopRecording();
  }
}

function stopRecording() {
  if (recognition) recognition.stop();
  stopVisualizer();
  isRecording = false;
  stopTimer();
  micSelect.disabled = false;

  recordBtn.classList.remove('recording');
  recordIcon.textContent = '●';
  recordLabel.textContent = '録音開始';
  setStatus('録音停止');
  updateSummarizeBtn();
}

function setStatus(msg, error = false) {
  statusBar.textContent = msg;
  statusBar.classList.toggle('error', error);
}

function updateSummarizeBtn() {
  summarizeBtn.disabled = !finalTranscript.trim();
}

// ─── Summarize ────────────────────────────────────────────────────────────────
async function summarize() {
  if (!finalTranscript.trim()) return;

  loadingOverlay.classList.remove('hidden');
  summarizeBtn.disabled = true;

  try {
    const res = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: finalTranscript,
        meeting_type: meetingTypeInput.value.trim(),
        participants: participantsInput.value.trim(),
        agenda: agendaInput.value.trim(),
      }),
    });

    if (!res.ok) {
      let msg = `サーバーエラー (${res.status})`;
      try {
        const err = await res.json();
        msg = err.detail || msg;
      } catch {}
      throw new Error(msg);
    }

    const data = await res.json();
    await loadHistory();
    showSummaryView(data.summary, finalTranscript, data.id);
  } catch (e) {
    alert(`エラー: ${e.message}`);
    summarizeBtn.disabled = false;
  } finally {
    loadingOverlay.classList.add('hidden');
  }
}

// ─── Copy ─────────────────────────────────────────────────────────────────────
function summaryToMarkdown(summary, title, date) {
  const lines = [`# ${title}`, `${date}`, ''];

  if (summary.overview) {
    lines.push('## 📋 概要', summary.overview, '');
  }
  if (summary.topics?.length) {
    lines.push('## 🗂️ 議題');
    summary.topics.forEach(t => lines.push(`- ${t}`));
    lines.push('');
  }
  if (summary.decisions?.length) {
    lines.push('## ✅ 決定事項');
    summary.decisions.forEach(d => lines.push(`- ${d}`));
    lines.push('');
  }
  if (summary.action_items?.length) {
    lines.push('## 📌 アクションアイテム');
    summary.action_items.forEach(a => {
      let line = `- [ ] ${a.task}`;
      if (a.owner) line += `　担当: ${a.owner}`;
      if (a.deadline) line += `　期限: ${a.deadline}`;
      lines.push(line);
    });
    lines.push('');
  }
  if (summary.next_steps?.length) {
    lines.push('## 🚀 次のステップ');
    summary.next_steps.forEach(s => lines.push(`- ${s}`));
    lines.push('');
  }
  return lines.join('\n');
}

copyBtn.addEventListener('click', async () => {
  const text = summaryToMarkdown(
    currentSummary,
    summaryTitle.textContent,
    summaryDate.textContent,
  );
  await navigator.clipboard.writeText(text);
  const orig = copyBtn.textContent;
  copyBtn.textContent = '✅ コピーしました';
  setTimeout(() => { copyBtn.textContent = orig; }, 2000);
});

// ─── Notion settings modal ────────────────────────────────────────────────────
function openNotionModal() {
  notionTokenInput.value  = localStorage.getItem('notionToken') || '';
  notionPageIdInput.value = localStorage.getItem('notionPageId') || '';
  notionModal.classList.remove('hidden');
}

function closeNotionModal() {
  notionModal.classList.add('hidden');
}

notionSettingsBtn.addEventListener('click', openNotionModal);
notionModalClose.addEventListener('click', closeNotionModal);
notionModalCancel.addEventListener('click', closeNotionModal);
notionModal.addEventListener('click', e => { if (e.target === notionModal) closeNotionModal(); });

notionModalSave.addEventListener('click', () => {
  const token  = notionTokenInput.value.trim();
  const pageId = notionPageIdInput.value.trim();
  if (!token || !pageId) { alert('トークンとページIDを両方入力してください'); return; }
  localStorage.setItem('notionToken', token);
  localStorage.setItem('notionPageId', pageId);
  closeNotionModal();
  alert('Notion設定を保存しました');
});

// ─── Notion export ────────────────────────────────────────────────────────────
notionBtn.addEventListener('click', async () => {
  const token  = localStorage.getItem('notionToken');
  const pageId = localStorage.getItem('notionPageId');

  if (!token || !pageId) {
    openNotionModal();
    return;
  }

  notionBtn.disabled = true;
  notionBtn.textContent = '書き出し中...';

  try {
    const res = await fetch('/api/export/notion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meeting_id: currentMeetingId,
        notion_token: token,
        parent_page_id: pageId,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `エラー (${res.status})`);
    }

    const data = await res.json();
    const msg = data.url
      ? `Notionへ書き出しました！\n${data.url}`
      : 'Notionへ書き出しました！';
    alert(msg);
  } catch (e) {
    alert(`書き出し失敗: ${e.message}`);
  } finally {
    notionBtn.disabled = false;
    notionBtn.innerHTML = '<img src="https://www.notion.so/images/favicon.ico" width="14" height="14" alt="" onerror="this.style.display=\'none\'"> Notionへ書き出し';
  }
});

// ─── Summary view ─────────────────────────────────────────────────────────────
let currentSummary = null;

function showSummaryView(summary, transcript, id) {
  recordView.classList.add('hidden');
  summaryView.classList.remove('hidden');

  currentSummary = summary;
  currentMeetingId = id;

  summaryTitle.textContent = summary.title || 'ミーティング要約';
  summaryDate.textContent = formatDate(new Date().toISOString());
  summaryTranscript.textContent = transcript;

  summaryBody.innerHTML = buildSummaryCards(summary);

  document.querySelectorAll('.history-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id == id);
  });
}

function buildSummaryCards(s) {
  let html = '';

  if (s.overview) {
    html += card('📋', '概要', `<p class="card-content">${escapeHtml(s.overview)}</p>`);
  }

  if (s.topics?.length) {
    html += card('🗂️', '議題', `<ul class="card-list">${s.topics.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`);
  }

  if (s.decisions?.length) {
    html += card('✅', '決定事項', `<ul class="card-list">${s.decisions.map(d => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`);
  }

  if (s.action_items?.length) {
    const rows = s.action_items.map(a => `
      <tr>
        <td>${escapeHtml(a.task || '')}</td>
        <td>${a.owner ? `<span class="tag">${escapeHtml(a.owner)}</span>` : '<span style="color:var(--text-muted)">―</span>'}</td>
        <td>${a.deadline ? `<span class="tag deadline">${escapeHtml(a.deadline)}</span>` : '<span style="color:var(--text-muted)">―</span>'}</td>
      </tr>`).join('');
    html += card('📌', 'アクションアイテム', `
      <table class="action-table">
        <thead><tr><th>タスク</th><th>担当者</th><th>期限</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`);
  }

  if (s.next_steps?.length) {
    html += card('🚀', '次のステップ', `<ul class="card-list">${s.next_steps.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`);
  }

  return html;
}

function card(icon, title, body) {
  return `<div class="card">
    <div class="card-title"><span class="icon">${icon}</span>${title}</div>
    ${body}
  </div>`;
}

// ─── History ──────────────────────────────────────────────────────────────────
async function loadHistory() {
  const meetings = await fetch('/api/meetings').then(r => r.json());
  historyList.innerHTML = '';

  if (!meetings.length) {
    historyList.innerHTML = '<li class="empty-state">まだ記録がありません</li>';
    return;
  }

  meetings.forEach(m => {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.dataset.id = m.id;
    li.innerHTML = `
      <div class="history-item-text">
        <div class="history-item-name">${escapeHtml(m.title)}</div>
        <div class="history-item-date">${formatDate(m.created_at)}</div>
      </div>
      <button class="history-del" title="削除">✕</button>`;

    li.querySelector('.history-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('このミーティングを削除しますか？')) return;
      await fetch(`/api/meetings/${m.id}`, { method: 'DELETE' });
      await loadHistory();
      if (!summaryView.classList.contains('hidden')) showRecordView();
    });

    li.addEventListener('click', () => openMeeting(m.id));
    historyList.appendChild(li);
  });
}

async function openMeeting(id) {
  const data = await fetch(`/api/meetings/${id}`).then(r => r.json());
  showSummaryView(data.summary, data.transcript, id);
  summaryDate.textContent = formatDate(data.created_at);
  currentMeetingId = id;
}

// ─── View transitions ─────────────────────────────────────────────────────────
function showRecordView() {
  summaryView.classList.add('hidden');
  recordView.classList.remove('hidden');
  document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
}

function resetRecordView() {
  finalTranscript = '';
  renderTranscript();
  meetingTitle.textContent = '';
  timer.textContent = '00:00';
  setStatus('使用するマイクを選択して録音を開始してください');
  summarizeBtn.disabled = true;
  if (isRecording) stopRecording();
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ─── Event listeners ──────────────────────────────────────────────────────────
recordBtn.addEventListener('click', toggleRecording);
summarizeBtn.addEventListener('click', summarize);
backBtn.addEventListener('click', showRecordView);

clearBtn.addEventListener('click', () => {
  if (!confirm('文字起こしをクリアしますか？')) return;
  finalTranscript = '';
  renderTranscript();
  updateSummarizeBtn();
});

newBtn.addEventListener('click', () => {
  resetRecordView();
  showRecordView();
});

window.addEventListener('resize', () => {
  canvas.width = canvas.offsetWidth;
});

// デバイスの抜き差し時にリストを更新
navigator.mediaDevices.addEventListener('devicechange', () => {
  if (!isRecording) loadMicDevices();
});

// ─── Init ─────────────────────────────────────────────────────────────────────
canvas.width = canvas.offsetWidth;
populateTemplateSelect();
loadMicDevices();
loadHistory();
