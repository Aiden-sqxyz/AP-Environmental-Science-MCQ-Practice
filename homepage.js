'use strict';

const landing = document.querySelector('#landing');
const practiceHeader = document.querySelector('.topbar');
const practiceFooter = document.querySelector('.footer');
const nav = document.querySelector('#landing-nav');
const menuButton = document.querySelector('.menu-icon');
const landingDialog = document.querySelector('#landing-dialog');
const dialogBody = document.querySelector('#landing-dialog-body');
let activeHash;

function toggleMenu(open) {
  menuButton.setAttribute('aria-expanded', String(open));
  nav.classList.toggle('menu-open', open);
}

menuButton.addEventListener('click', () => toggleMenu(menuButton.getAttribute('aria-expanded') === 'false'));
nav.addEventListener('click', () => toggleMenu(false));
landing.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
    toggleMenu(false);
    menuButton.focus();
  }
});

document.querySelector('#about-open').addEventListener('click', () => {
  dialogBody.innerHTML = `<h2 id="landing-dialog-title">About APES Practice</h2>
    <p>Practice AP Environmental Science multiple choice questions by topic, by unit, or across the full course.</p>
    <p>Questions that use the same figure, table, or passage stay together. You can check each answer, resume a set, or retry missed questions.</p>`;
  landingDialog.showModal();
});

document.querySelector('#topic-search-open').addEventListener('click', () => {
  dialogBody.innerHTML = `<h2 id="landing-dialog-title">Find a topic</h2>
    <label for="topic-query">Search by topic name or number</label>
    <input id="topic-query" class="topic-search-input" type="search" placeholder="Try 4.3 or soil" autocomplete="off">
    <p id="topic-match-count" class="visually-hidden" aria-live="polite"></p>
    <ul class="topic-search-results"></ul>`;
  const input = dialogBody.querySelector('#topic-query');
  const result = dialogBody.querySelector('.topic-search-results');
  const count = dialogBody.querySelector('#topic-match-count');
  function search() {
    const query = input.value.trim().toLowerCase();
    const matches = [...topics.values()].filter(topic => `${topic.id} ${topic.name}`.toLowerCase().includes(query));
    result.innerHTML = matches.slice(0, 9).map(topic => `<li><a href="#practice/topic/${topic.id}">${topic.id} · ${escapeHtml(topic.name)}</a></li>`).join('') || '<li>No matching topics.</li>';
    count.textContent = `${matches.length} matching ${matches.length === 1 ? 'topic' : 'topics'}.`;
  }
  input.addEventListener('input', search);
  search();
  landingDialog.showModal();
  input.focus();
});

dialogBody.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#practice"]');
  if (link) landingDialog.close();
});

async function routeLanding() {
  const hash = window.location.hash;
  activeHash = hash;
  const practice = /^#practice(?:\/|$)/.test(hash);
  landing.hidden = practice;
  practiceHeader.hidden = !practice;
  practiceFooter.hidden = !practice;
  app.hidden = !practice;
  toggleMenu(false);
  window.scrollTo(0, 0);
  if (!practice) {
    view = 'landing';
    return;
  }

  if (!data) app.innerHTML = '<p class="subtle" role="status">Loading practice questions…</p>';
  try {
    await loadPractice();
  } catch {
    if (activeHash === hash) {
      app.innerHTML = '<p role="alert">The practice questions couldn’t load.</p><button type="button" class="button" id="retry-bank">Try again</button>';
      app.querySelector('#retry-bank').addEventListener('click', routeLanding);
    }
    return;
  }
  if (activeHash !== hash) return;

  const unit = Number(hash.match(/^#practice\/unit\/(\d+)$/)?.[1]);
  const topic = hash.match(/^#practice\/topic\/(\d+\.\d+)$/)?.[1];
  if (units.has(unit)) {
    Object.assign(filters, { mode: 'unit', unit, topic: null });
  } else if (topics.has(topic)) {
    Object.assign(filters, { mode: 'topic', unit: Number(topic.split('.')[0]), topic });
  } else if (hash === '#practice/topics') {
    Object.assign(filters, { mode: 'topic', topic: null });
  }
  renderHome();
  app.querySelector('#practice-title').focus({ preventScroll: true });
}

window.addEventListener('hashchange', routeLanding);
routeLanding();
