#!/usr/bin/env python3
"""Assemble APES Practice for web hosting or as a self-contained HTML file."""

import argparse
from base64 import b64encode
from collections import Counter
from html import escape
import json
from pathlib import Path
import re


HERE = Path(__file__).resolve().parent
UNIT_LABELS = ('Ecosystems', 'Biodiversity', 'Populations', 'Earth Systems', 'Land & Water',
               'Energy', 'Air Pollution', 'Water & Soil', 'Global Change')


def script_json(data):
    return json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')


def build_html(output, course, bank, split_bank):
    payload = script_json(dict(course=course, **bank))
    source = ''
    if split_bank:
        bank_name = 'practice-bank.json'
        output.with_name(bank_name).write_text(payload, encoding='utf-8')
        source = f'data-src="{bank_name}"'
        payload = ''

    links = []
    for unit in course:
        number = unit['id']
        label = escape(UNIT_LABELS[number - 1])
        links.append(f'<a class="unit-link" href="#practice/unit/{number}" aria-label="Unit {number}: '
                     f'{escape(unit["name"])}"><span>U{number}</span><span>{label}</span></a>')
    landing = (HERE / 'homepage.html').read_text().replace('/* UNIT LINKS */', '\n    '.join(links))
    photo = b64encode((HERE / 'assets' / 'delta.webp').read_bytes()).decode('ascii')
    landing_css = (HERE / 'homepage.css').read_text().replace('/* DELTA PHOTO */', f'data:image/webp;base64,{photo}')
    template = (HERE / 'template.html').read_text()
    slots = {'STYLE': (HERE / 'style.css').read_text(), 'LANDING STYLE': landing_css,
             'LANDING': landing, 'COURSE': script_json(course), 'DATA SOURCE': source, 'DATA': payload,
             'APP': (HERE / 'app.js').read_text(), 'LANDING SCRIPT': (HERE / 'homepage.js').read_text()}
    output.write_text(re.sub(r'/\* ([A-Z ]+) \*/', lambda match: slots[match[1]], template), encoding='utf-8')


def load_rules():
    rules = {}
    for line in (HERE / 'topic_rules.txt').read_text().splitlines():
        if line and not line.startswith('#'):
            topic, *signals = line.split('|')
            rules[topic] = [re.compile(f'(?<![a-z])(?:{signal})', re.I) for signal in signals]
    return rules


def classify(question, context, rules):
    stem = question['stem']['text']
    answer = question['choices'][ord(question['answer']) - ord('A')]['text']
    options = ' '.join(choice['text'] for choice in question['choices'])
    unit = question['sourceUnit']
    scores = {}
    for topic, signals in rules.items():
        score = 0
        for i, signal in enumerate(signals):
            weight = 1.2 if i < 2 else (.62 if i >= len(signals) - 2 else .88)
            score += weight * (3.3 * bool(signal.search(stem)) + 2.4 * bool(signal.search(answer))
                               + 1.15 * bool(signal.search(context)) + .20 * bool(signal.search(options)))
        if score:
            scores[topic] = score * (1.19 if str(unit) == topic[0] else 1)
    ranked = sorted(scores, key=scores.get, reverse=True)
    if not ranked:
        defaults = ('1.1', '2.1', '3.5', '4.8', '5.4', '6.2', '7.1', '8.2', '9.5')
        return [defaults[unit - 1]], True
    top = ranked[0]
    uncertain = scores[top] < 2.5 or (len(ranked) > 1 and scores[ranked[1]] > scores[top] * .83)
    return [top], uncertain


def attach_tags(bank, course):
    rules = load_rules()
    path = HERE / 'topic_overrides.txt'
    overrides = {}
    if path.is_file():
        for line in path.read_text().splitlines():
            if line and not line.startswith('#'):
                source, label = line.split(':', 1)
                u, ids = source.split('-', 1)
                for item in ids.split(','):
                    first, _, last = item.strip().partition('–')
                    for n in range(int(first), int(last or first) + 1):
                        overrides[f'{u}-{n}'] = label.split()
    valid_topics = {topic['id'] for unit in course for topic in unit['topics']}
    assert valid_topics == set(rules)
    assert set(overrides) <= {question['id'] for question in bank['questions']}
    for question in bank['questions']:
        context = bank['contexts'].get(question['context'], {}).get('text', '')
        question['topics'], question['topicReview'] = classify(question, context, rules)
        if question['id'] in overrides:
            question['topics'], question['topicReview'] = overrides[question['id']], False
        assert set(question['topics']) <= valid_topics


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    inputs = parser.add_mutually_exclusive_group()
    inputs.add_argument('--bank', type=Path, help='JSON from build_bank.py')
    inputs.add_argument('--pdfs', type=Path, help='Directory with all nine pairs of source PDFs')
    inputs.add_argument('--prepared-bank', type=Path, help='Rebuild the interface around an existing, already tagged bank')
    parser.add_argument('--split-bank', action='store_true', help='Load questions on demand from a second file for hosting')
    parser.add_argument('--report', type=Path, help='Write question-by-question topic review TSV')
    args = parser.parse_args()
    course = json.loads((HERE / 'course.json').read_text())
    if args.prepared_bank:
        bank = json.loads(args.prepared_bank.read_text())
        course = bank.pop('course', course)
    elif args.bank:
        bank = json.loads(args.bank.read_text())
    elif args.pdfs:
        from build_bank import build
        bank = build(args.pdfs)
    else:
        bank = dict(questions=[], contexts={})
    if not args.prepared_bank:
        attach_tags(bank, course)
    if args.report:
        lines = ['id\ttopic\treview\tstem\tkey\tanswer_text\tstimulus']
        for q in bank['questions']:
            answer = q['choices'][ord(q['answer']) - 65]['text']
            context = bank['contexts'].get(q['context'], {}).get('text', '')
            lines.append('\t'.join((q['id'], ','.join(q['topics']), str(int(q['topicReview'])), q['stem']['text'], q['answer'], answer, context)))
        args.report.write_text('\n'.join(lines) + '\n')
    build_html(args.output, course, bank, args.split_bank)
    print(f'{len(bank["questions"]):,} questions across {len(course)} units')
    print(f'{sum(q["topicReview"] for q in bank["questions"]):,} provisional topic matches')
    print('Topics with questions:', len(Counter(t for q in bank['questions'] for t in q['topics'])))


if __name__ == '__main__':
    main()
