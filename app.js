'use strict';

const data = JSON.parse(document.querySelector('#practice-data').textContent);
const app = document.querySelector('#app');
const storageKey = 'apes-practice-fall-2026-v1';
const letters = 'ABCDE';
const questions = new Map(data.questions.map(question => [question.id, question]));
const units = new Map(data.course.map(unit => [unit.id, unit]));
const topics = new Map(data.course.flatMap(unit => unit.topics.map(topic => [topic.id, topic])));
const topicBank = new Map([...topics.keys()].map(id => [id, []]));
const unitBank = new Map([...units.keys()].map(id => [id, []]));

for (const question of questions.values()) {
  const linkedUnits = new Set();
  for (const topic of question.topics) {
    topicBank.get(topic).push(question.id);
    linkedUnits.add(Number(topic.split('.')[0]));
  }
  for (const unit of linkedUnits) unitBank.get(unit).push(question.id);
}

const filters = { mode: 'unit', unit: 1, topic: null, size: '10' };
let session = readSession();
let selected = null;
let view = 'home';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[character]));
}

function imageOrText(part, fallback) {
  if (part.image && /^data:image\/webp;base64,[a-z0-9+/=]+$/i.test(part.image)) {
    return `<img class="source-image" src="${part.image}" alt="${escapeHtml(part.text || fallback)}">`;
  }
  return `<span>${escapeHtml(part.text || fallback)}</span>`;
}

function readSession() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey));
    if (Array.isArray(stored?.ids) && stored.ids.length && stored.ids.every(id => questions.has(id)) &&
        Number.isInteger(stored.index) && stored.index >= 0 && stored.index < stored.ids.length &&
        stored.answers && typeof stored.answers === 'object') return stored;
  } catch { /* Practice still works if browser storage is disabled. */ }
  return null;
}

function saveSession() {
  try { localStorage.setItem(storageKey, JSON.stringify(session)); } catch { /* Session stays in memory. */ }
}

function questionCount(count) { return `${count.toLocaleString()} ${count === 1 ? 'question' : 'questions'}`; }

function optionsForFilters() {
  if (filters.mode === 'course') return { ids: [...questions.keys()], name: 'Whole course' };
  if (filters.mode === 'unit') {
    const unit = units.get(filters.unit);
    return { ids: unitBank.get(unit.id), name: `Unit ${unit.id} · ${unit.name}` };
  }
  const topic = topics.get(filters.topic);
  return !topic ? { ids: [], name: 'Choose a topic to begin.' } : { ids: topicBank.get(topic.id), name: `${topic.id} · ${topic.name}` };
}

function renderHome() {
  view = 'home';
  const options = optionsForFilters();
  const questionOptions = [5, 10, 20, 40, 80].filter(n => n < options.ids.length).map(n => [String(n), n]);
  questionOptions.push(['all', `All ${options.ids.length || ''}`.trim()]);
  const size = questionOptions.some(([value]) => value === filters.size) ? filters.size : 'all';
  const rows = data.course.map(unit => {
    const active = unit.id === filters.unit;
    const available = unitBank.get(unit.id).length;
    const topicRows = filters.mode === 'topic' && active ? `<div class="topic-list">${unit.topics.map(topic => {
      const count = topicBank.get(topic.id).length;
      return `<button type="button" class="topic-row" data-topic="${topic.id}" aria-pressed="${topic.id === filters.topic}" ${count ? '' : 'disabled'}><span class="topic-code">${topic.id}</span><strong>${escapeHtml(topic.name)}</strong><span class="count">${count}</span></button>`;
    }).join('')}</div>` : '';
    return `<div><button type="button" class="unit-row" data-unit="${unit.id}" aria-pressed="${active}"><span class="unit-badge">${unit.id}</span><strong>${escapeHtml(unit.name)}</strong><span class="count">${questionCount(available)}</span></button>${topicRows}</div>`;
  }).join('');

  app.innerHTML = `
    <section class="hero" aria-labelledby="hero-title">
      <div><div class="label">AP Environmental Science</div><h1 id="hero-title">MCQ Practice</h1><p>Pick a topic, a unit, or a mix from the whole course.</p></div>
      <div class="stat"><strong>${questions.size.toLocaleString()}</strong><small>questions in the bank</small></div>
    </section>
    <div class="workspace">
      <section class="panel" aria-labelledby="browse-title">
        <h2 id="browse-title">Choose what to practice</h2>
        <div class="tabs" role="group" aria-label="Practice scope">
          ${[['unit','By unit'], ['topic','By topic'], ['course','Whole course']].map(([value, label]) => `<button type="button" class="tab" data-mode="${value}" aria-pressed="${filters.mode === value}">${label}</button>`).join('')}
        </div>
        ${filters.mode === 'course' ? '<p class="mixed">Draw a random set from all nine units.</p>' : `<div class="unit-list">${rows}</div>`}
      </section>
      <section class="panel settings" aria-labelledby="set-title">
        <h2 id="set-title">Practice set</h2>
        <p class="selection subtle" aria-live="polite">${escapeHtml(options.name)}${options.ids.length ? `<br>${questionCount(options.ids.length)} available` : ''}</p>
        <label for="set-size">Questions per set</label>
        <select id="set-size" ${options.ids.length ? '' : 'disabled'}>${questionOptions.map(([value, label]) => `<option value="${value}" ${value === size ? 'selected' : ''}>${label}</option>`).join('')}</select>
        <button class="button primary" type="button" id="start" ${options.ids.length ? '' : 'disabled'}>Start practice <span aria-hidden="true">→</span></button>
        ${session && !session.done ? '<button class="button" type="button" id="resume">Resume last set</button>' : ''}
        ${!questions.size ? '<p class="feedback">Build the site with your PDFs to add the question bank. Follow the instructions in the repository.</p>' : ''}
      </section>
    </div>`;
}

function shuffled(ids) {
  const result = [...ids];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function startSession(ids, name) {
  session = { ids, name, index: 0, answers: {}, done: false };
  selected = null;
  saveSession();
  renderQuestion(true);
}

function renderQuestion(moveFocus = false) {
  view = 'question';
  const q = questions.get(session.ids[session.index]);
  const answer = session.answers[q.id];
  const context = data.contexts[q.context];
  const checked = answer !== undefined;
  const correct = answer === q.answer;
  const position = session.index + 1;
  const scope = session.name || 'Practice set';
  app.innerHTML = `
    <div class="session">
      <div class="session-head"><button class="button" type="button" id="back">← Practice menu</button><strong>Question ${position} of ${session.ids.length}</strong></div>
      <div class="progress" role="progressbar" aria-label="Set position" aria-valuenow="${position}" aria-valuemin="0" aria-valuemax="${session.ids.length}"><span style="width:${100 * position / session.ids.length}%"></span></div>
      <section class="panel question" aria-label="Question ${position}">
        <div class="question-meta"><span class="label">${escapeHtml(scope)}</span><span class="subtle">Booklet ${q.sourceUnit} · #${q.number}</span></div>
        ${context ? `<details class="stimulus" open><summary>Question material</summary>${imageOrText(context, 'Question figure or passage')}</details>` : ''}
        <div class="stem" id="stem" tabindex="-1">${imageOrText(q.stem, 'Question text')}</div>
        <div class="choices" role="group" aria-label="Answer choices">
          ${q.choices.map((choice, index) => {
            const letter = letters[index];
            const chosen = (checked ? answer : selected) === letter;
            const result = checked && letter === q.answer ? 'correct' : checked && chosen ? 'wrong' : '';
            return `<button class="choice ${result}" type="button" data-choice="${letter}" aria-pressed="${chosen}" ${checked ? 'disabled' : ''}><span class="letter">${letter}</span>${imageOrText(choice, `Option ${letter}`)}${result ? `<span class="choice-icon" aria-hidden="true">${result === 'correct' ? '✓' : '×'}</span>` : ''}</button>`;
          }).join('')}
        </div>
        ${checked ? `<div class="feedback ${correct ? '' : 'wrong'}" role="status" tabindex="-1" id="feedback"><strong>${correct ? 'Correct.' : `Correct answer: ${q.answer}.`}</strong> <span>${q.topics.map(id => `${id} ${escapeHtml(topics.get(id).name)}`).join(' · ')}${q.topicReview ? ' (provisional)' : ''}</span>${q.explanation ? `<p>${escapeHtml(q.explanation)}</p>` : ''}</div>` : ''}
      </section>
      <div class="control-row">
        <button class="button" type="button" id="previous" ${position === 1 ? 'disabled' : ''}>← Previous</button>
        <div class="right-controls">
          ${!checked ? `<button class="button" type="button" id="next">${position === session.ids.length ? 'Finish set' : 'Skip'}</button><button class="button primary" type="button" id="check" ${!selected ? 'disabled' : ''}>Check answer</button>` : `<button class="button primary" type="button" id="next">${position === session.ids.length ? 'See results' : 'Next question →'}</button>`}
        </div>
      </div>
    </div>`;
  if (moveFocus) {
    window.scrollTo(0, 0);
    document.querySelector('#stem').focus({ preventScroll: true });
  }
}

function selectChoice(letter) {
  selected = letter;
  for (const button of app.querySelectorAll('[data-choice]')) {
    const active = button.dataset.choice === letter;
    button.setAttribute('aria-pressed', active);
    button.classList.toggle('selected', active);
  }
  document.querySelector('#check').disabled = false;
}

function renderResults() {
  view = 'results';
  const missed = session.ids.filter(id => session.answers[id] !== questions.get(id).answer);
  const skipped = session.ids.filter(id => session.answers[id] === undefined).length;
  app.innerHTML = `<section class="session panel summary" aria-labelledby="results-title"><div class="label">${escapeHtml(session.name)}</div><h1 id="results-title" tabindex="-1">Set complete</h1><div class="result-count"><strong>${session.ids.length - missed.length} / ${session.ids.length}</strong> correct</div><p class="subtle">${missed.length - skipped} incorrect · ${skipped} skipped</p><div class="control-row"><button class="button" type="button" id="back">Practice menu</button>${missed.length ? '<button class="button primary" type="button" id="retry">Retry missed and skipped</button>' : ''}</div></section>`;
  window.scrollTo(0, 0);
  document.querySelector('#results-title').focus({ preventScroll: true });
}

document.querySelector('#home').addEventListener('click', () => { renderHome(); window.scrollTo(0, 0); });
app.addEventListener('change', event => { if (event.target.id === 'set-size') filters.size = event.target.value; });
app.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.mode || button.dataset.unit || button.dataset.topic) {
    if (button.dataset.mode) filters.mode = button.dataset.mode;
    if (button.dataset.unit) {
      filters.unit = Number(button.dataset.unit);
      if (filters.topic?.split('.')[0] !== button.dataset.unit) filters.topic = null;
    }
    if (button.dataset.topic) filters.topic = button.dataset.topic;
    const selector = button.dataset.mode ? `[data-mode="${button.dataset.mode}"]` : button.dataset.unit ? `[data-unit="${button.dataset.unit}"]` : `[data-topic="${button.dataset.topic}"]`;
    renderHome();
    app.querySelector(selector).focus({ preventScroll: true });
    return;
  }
  if (button.dataset.choice) { selectChoice(button.dataset.choice); return; }
  switch (button.id) {
    case 'start': {
      const options = optionsForFilters();
      const amount = document.querySelector('#set-size').value;
      startSession(shuffled(options.ids).slice(0, amount === 'all' ? options.ids.length : Number(amount)), options.name);
      break;
    }
    case 'resume': selected = null; renderQuestion(true); break;
    case 'back': renderHome(); window.scrollTo(0, 0); break;
    case 'previous': session.index--; selected = null; saveSession(); renderQuestion(true); break;
    case 'check':
      session.answers[session.ids[session.index]] = selected;
      saveSession();
      renderQuestion();
      document.querySelector('#feedback').focus();
      break;
    case 'next':
      selected = null;
      if (session.index === session.ids.length - 1) {
        session.done = true;
        saveSession();
        renderResults();
      } else {
        session.index++;
        saveSession();
        renderQuestion(true);
      }
      break;
    case 'retry': startSession(shuffled(session.ids.filter(id => session.answers[id] !== questions.get(id).answer)), 'Missed questions'); break;
  }
});

document.addEventListener('keydown', event => {
  if (view !== 'question' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const letter = event.key.toUpperCase();
  if (letter.length === 1 && letters.includes(letter)) app.querySelector(`[data-choice="${letter}"]:not(:disabled)`)?.click();
});

renderHome();
