'use strict';

const course = JSON.parse(document.querySelector('#course-data').textContent);
const app = document.querySelector('#app');
const storageKey = 'apes-practice-fall-2026-v1';
const letters = 'ABCDE';
const questions = new Map();
const units = new Map(course.map(unit => [unit.id, unit]));
const topics = new Map(course.flatMap(unit => unit.topics.map(topic => [topic.id, topic])));
const topicBank = new Map([...topics.keys()].map(id => [id, []]));
const unitBank = new Map([...units.keys()].map(id => [id, []]));
const setBank = new Map();
let data;
let bankRequest;

function loadPractice() {
  bankRequest ??= (async () => {
    const node = document.querySelector('#practice-data');
    if (node.dataset.src) {
      const response = await fetch(node.dataset.src);
      if (!response.ok) throw new Error('Practice bank unavailable');
      data = await response.json();
    } else {
      data = JSON.parse(node.textContent);
    }
    for (const question of data.questions) {
      questions.set(question.id, question);
      const setId = question.setId || question.id;
      if (!setBank.has(setId)) setBank.set(setId, []);
      setBank.get(setId).push(question.id);
      const linkedUnits = new Set();
      for (const topic of question.topics) {
        topicBank.get(topic).push(question.id);
        linkedUnits.add(Number(topic.split('.')[0]));
      }
      for (const unit of linkedUnits) unitBank.get(unit).push(question.id);
    }
    session = readSession();
  })().catch(error => { bankRequest = null; throw error; });
  return bankRequest;
}

function setIdsFor(questionIds) {
  return [...new Set(questionIds.map(id => questions.get(id).setId || id))];
}

function countFor(questionIds) {
  return setIdsFor(questionIds).reduce((sum, id) => sum + setBank.get(id).length, 0);
}

function makeSet(questionIds, target = Infinity) {
  const ids = [];
  for (const setId of shuffled(setIdsFor(questionIds))) {
    ids.push(...setBank.get(setId));
    if (ids.length >= target) break;
  }
  return ids;
}

const filters = { mode: 'unit', unit: 1, topic: null, size: '10' };
let session = null;
const selected = new Map();
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
        stored.answers && typeof stored.answers === 'object') {
      if (stored.grouped) return stored;
      const current = stored.ids[stored.index];
      const ids = setIdsFor(stored.ids).flatMap(id => setBank.get(id));
      const group = setBank.get(questions.get(current).setId || current);
      return { ...stored, ids, index: ids.indexOf(group[0]), grouped: true };
    }
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
  const availableCount = countFor(options.ids);
  const questionOptions = [5, 10, 20, 40, 80].filter(n => n < availableCount).map(n => [String(n), `About ${n}`]);
  questionOptions.push(['all', `All ${availableCount || ''}`.trim()]);
  const size = questionOptions.some(([value]) => value === filters.size) ? filters.size : 'all';
  const rows = course.map(unit => {
    const active = unit.id === filters.unit;
    const available = countFor(unitBank.get(unit.id));
    const topicRows = filters.mode === 'topic' && active ? `<div class="topic-list">${unit.topics.map(topic => {
      const count = countFor(topicBank.get(topic.id));
      return `<button type="button" class="topic-row" data-topic="${topic.id}" aria-pressed="${topic.id === filters.topic}" ${count ? '' : 'disabled'}><span class="topic-code">${topic.id}</span><strong>${escapeHtml(topic.name)}</strong><span class="count">${count}</span></button>`;
    }).join('')}</div>` : '';
    return `<div><button type="button" class="unit-row" data-unit="${unit.id}" aria-pressed="${active}"><span class="unit-badge">${unit.id}</span><strong>${escapeHtml(unit.name)}</strong><span class="count">${questionCount(available)}</span></button>${topicRows}</div>`;
  }).join('');

  app.innerHTML = `
    <section class="practice-intro" aria-labelledby="practice-title">
      <h1 id="practice-title" tabindex="-1">MCQ Practice</h1><p class="subtle">${questionCount(questions.size)} · Practice by topic, unit, or across the whole course.</p>
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
        <p class="selection subtle" aria-live="polite">${escapeHtml(options.name)}${availableCount ? `<br>${questionCount(availableCount)} available` : ''}</p>
        <label for="set-size">Questions per set</label>
        <select id="set-size" ${options.ids.length ? '' : 'disabled'}>${questionOptions.map(([value, label]) => `<option value="${value}" ${value === size ? 'selected' : ''}>${label}</option>`).join('')}</select>
        <p class="set-note subtle">Questions that share material stay together.</p>
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
  session = { ids, name, index: 0, answers: {}, done: false, grouped: true };
  selected.clear();
  saveSession();
  renderQuestion(true);
}

function activeSet() {
  const question = questions.get(session.ids[session.index]);
  return setBank.get(question.setId || question.id).map(id => questions.get(id));
}

function renderItem(q, position, groupSize) {
  const answer = session.answers[q.id];
  const checked = answer !== undefined;
  const correct = answer === q.answer;
  return `<article class="quiz-item" data-question="${q.id}" aria-label="Question ${position}">
    ${groupSize > 1 ? `<p class="item-number">Question ${position} · Booklet #${q.number}</p>` : ''}
    <div class="stem" id="stem-${q.id}" tabindex="-1">${imageOrText(q.stem, 'Question text')}</div>
    <div class="choices" role="group" aria-label="Answer choices for question ${position}">
      ${q.choices.map((choice, index) => {
        const letter = letters[index];
        const chosen = (checked ? answer : selected.get(q.id)) === letter;
        const result = checked && letter === q.answer ? 'correct' : checked && chosen ? 'wrong' : '';
        return `<button class="choice ${result}" type="button" data-choice="${letter}" aria-pressed="${chosen}" ${checked ? 'disabled' : ''}><span class="letter">${letter}</span>${imageOrText(choice, `Option ${letter}`)}${result ? `<span class="choice-icon" aria-hidden="true">${result === 'correct' ? '✓' : '×'}</span>` : ''}</button>`;
      }).join('')}
    </div>
    ${checked ? `<div class="feedback ${correct ? '' : 'wrong'}" role="status" tabindex="-1"><strong>${correct ? 'Correct.' : `Correct answer: ${q.answer}.`}</strong> <span>${q.topics.map(id => `${id} ${escapeHtml(topics.get(id).name)}`).join(' · ')}${q.topicReview ? ' (provisional)' : ''}</span>${q.explanation ? `<p>${escapeHtml(q.explanation)}</p>` : ''}</div>` : `<div class="item-controls"><button class="button primary" type="button" data-check ${selected.has(q.id) ? '' : 'disabled'}>Check answer</button></div>`}
  </article>`;
}

function renderQuestion(moveFocus = false) {
  view = 'question';
  const group = activeSet();
  const first = group[0];
  const context = data.contexts[first.context];
  const position = session.index + 1;
  const end = session.index + group.length;
  const range = group.length === 1 ? `Question ${position}` : `Questions ${position}–${end}`;
  const bookletRange = group.length === 1 ? `#${first.number}` : `#${first.number}–${group.at(-1).number}`;
  const scope = session.name || 'Practice set';
  app.innerHTML = `
    <div class="session">
      <div class="session-head"><button class="button" type="button" id="back">← Practice menu</button><strong id="set-position" tabindex="-1">${range} of ${session.ids.length}</strong></div>
      <div class="progress" role="progressbar" aria-label="Set position" aria-valuenow="${end}" aria-valuemin="0" aria-valuemax="${session.ids.length}"><span style="width:${100 * end / session.ids.length}%"></span></div>
      <section class="panel question" aria-label="${range}">
        <div class="question-meta"><span class="label">${escapeHtml(scope)}</span><span class="subtle">Booklet ${first.sourceUnit} · ${bookletRange}</span></div>
        ${context ? `<details class="stimulus" open><summary>${group.length > 1 ? 'Shared material' : 'Question material'}</summary>${imageOrText(context, 'Question figure or passage')}</details>` : ''}
        ${group.map((q, index) => renderItem(q, position + index, group.length)).join('')}
      </section>
      <div class="control-row">
        <button class="button" type="button" id="previous" ${position === 1 ? 'disabled' : ''}>← Previous</button>
        <div class="right-controls">
          <button class="button" type="button" id="next">${end === session.ids.length ? 'See results' : 'Continue →'}</button>
        </div>
      </div>
    </div>`;
  if (moveFocus) {
    window.scrollTo(0, 0);
    document.querySelector('#set-position').focus({ preventScroll: true });
  }
}

function selectChoice(item, letter) {
  selected.set(item.dataset.question, letter);
  for (const button of item.querySelectorAll('[data-choice]')) {
    const active = button.dataset.choice === letter;
    button.setAttribute('aria-pressed', active);
  }
  item.querySelector('[data-check]').disabled = false;
}

function renderResults() {
  view = 'results';
  const missed = session.ids.filter(id => session.answers[id] !== questions.get(id).answer);
  const skipped = session.ids.filter(id => session.answers[id] === undefined).length;
  app.innerHTML = `<section class="session panel summary" aria-labelledby="results-title"><div class="label">${escapeHtml(session.name)}</div><h1 id="results-title" tabindex="-1">Set complete</h1><div class="result-count"><strong>${session.ids.length - missed.length} / ${session.ids.length}</strong> correct</div><p class="subtle">${missed.length - skipped} incorrect · ${skipped} skipped</p><div class="control-row"><button class="button" type="button" id="back">Practice menu</button>${missed.length ? '<button class="button primary" type="button" id="retry">Retry missed and skipped</button>' : ''}</div></section>`;
  window.scrollTo(0, 0);
  document.querySelector('#results-title').focus({ preventScroll: true });
}

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
  if (button.dataset.choice || button.hasAttribute('data-check')) {
    const item = button.closest('[data-question]');
    if (button.dataset.choice) {
      selectChoice(item, button.dataset.choice);
    } else {
      const id = item.dataset.question;
      session.answers[id] = selected.get(id);
      selected.delete(id);
      saveSession();
      const group = activeSet();
      const position = session.index + group.findIndex(q => q.id === id) + 1;
      item.outerHTML = renderItem(questions.get(id), position, group.length);
      app.querySelector(`[data-question="${id}"] .feedback`).focus({ preventScroll: true });
    }
    return;
  }
  switch (button.id) {
    case 'start': {
      const options = optionsForFilters();
      const amount = document.querySelector('#set-size').value;
      startSession(makeSet(options.ids, amount === 'all' ? Infinity : Number(amount)), options.name);
      break;
    }
    case 'resume': selected.clear(); renderQuestion(true); break;
    case 'back': renderHome(); window.scrollTo(0, 0); break;
    case 'previous': {
      const prior = questions.get(session.ids[session.index - 1]);
      session.index -= setBank.get(prior.setId || prior.id).length;
      selected.clear();
      saveSession();
      renderQuestion(true);
      break;
    }
    case 'next':
      selected.clear();
      if (session.index + activeSet().length === session.ids.length) {
        session.done = true;
        saveSession();
        renderResults();
      } else {
        session.index += activeSet().length;
        saveSession();
        renderQuestion(true);
      }
      break;
    case 'retry': startSession(makeSet(session.ids.filter(id => session.answers[id] !== questions.get(id).answer)), 'Review missed questions'); break;
  }
});

document.addEventListener('keydown', event => {
  if (view !== 'question' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const letter = event.key.toUpperCase();
  const item = event.target.closest?.('[data-question]') || (activeSet().length === 1 ? app.querySelector('[data-question]') : null);
  if (letter.length === 1 && letters.includes(letter)) item?.querySelector(`[data-choice="${letter}"]:not(:disabled)`)?.click();
});
