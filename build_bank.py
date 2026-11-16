#!/usr/bin/env python3
"""Build a personal quiz from the nine test booklets and scoring guides."""

import argparse
import base64
import io
import json
import re
from pathlib import Path

import fitz
from PIL import Image


def normalize(text):
    return re.sub(r"\s+", " ", text).strip()


class Book:
    def __init__(self, path, scored=False):
        self.pdf = fitz.open(path)
        self.lines, self.numbers, self.choices, self.visuals, self.key = [], [], [], [], []
        highlights = []
        for index, page in enumerate(self.pdf):
            offset = index * 1000
            words = page.get_text('words')
            for x, y, _, bottom, word, *_ in words:
                if 35 <= x < 40 and 85 < y < 753 and re.fullmatch(r'\d{1,3}\.', word):
                    self.numbers.append((offset + y, int(word[:-1])))
                if 65 <= x < 71 and 80 < y < 753 and re.fullmatch(r'\([A-E]\)', word):
                    self.choices.append((offset + y, word[1], offset + bottom))
            for block in page.get_text('dict', flags=fitz.TEXTFLAGS_TEXT)['blocks']:
                for line in block.get('lines', []):
                    x, y, right, bottom = line['bbox']
                    text = normalize(''.join(s['text'] for s in line['spans']))
                    if 81 < y < 755 and 34 <= x < 577 and text:
                        self.lines.append((offset + y, offset + bottom, x, right, text))
            for item in page.get_image_info():
                x, y, right, bottom = item['bbox']
                if 81 < y < 750 and right - x > 4:
                    self.visuals.append((offset + y, offset + bottom, x, right))
            for drawing in page.get_drawings():
                rect, fill = drawing['rect'], drawing['fill']
                if (not scored and 80.9 < rect.y0 < 751 and rect.y1 < 756 and rect.x1 > 64
                        and rect.width > .3 and not (rect.x0 < 40 and rect.width > 450 and rect.height < 2)):
                    self.visuals.append((offset + rect.y0, offset + rect.y1, rect.x0, rect.x1))
                if scored and rect.width > 400 and fill and .89 < fill[0] < .92 and fill[1] > .98:
                    marked = [w[4][1] for w in words if 65 <= w[0] < 71
                              and re.fullmatch(r'\([A-E]\)', w[4])
                              and rect.y0 <= (w[1] + w[3]) / 2 <= rect.y1]
                    assert len(marked) == 1, (path, index + 1, rect, marked)
                    highlights.append((offset + (rect.y0 + rect.y1) / 2, marked[0]))
        for name in ('lines', 'numbers', 'choices', 'visuals'):
            getattr(self, name).sort()
        assert [n for _, n in self.numbers] == list(range(1, len(self.numbers) + 1)), path
        if scored:
            located = sorted(highlights)
            assert len(located) == len(self.numbers), path
            for i, ((start, question), (y, letter)) in enumerate(zip(self.numbers, located)):
                end = self.numbers[i + 1][0] if i + 1 < len(located) else len(self.pdf) * 1000
                assert start < y < end, (path, question, letter)
                self.key.append(letter)

    def span(self, start, end):
        return [line for line in self.lines if start <= line[0] < end]

    def images(self, start, end):
        return [item for item in self.visuals if start <= item[0] < end]

    def image(self, content, left):
        parts = []
        first = int(min(y for y, *_ in content) // 1000)
        last = int(max(b for _, b, *_ in content) // 1000)
        for index in range(first, last + 1):
            offset = index * 1000
            page_items = [(y - offset, bottom - offset, right) for y, bottom, _, right in content
                          if offset <= y < offset + 1000]
            if not page_items:
                continue
            top = max(80, min(y for y, _, _ in page_items) - 3)
            bottom = min(756, max(b for _, b, _ in page_items) + 3)
            right = min(578, max(r for _, _, r in page_items) + 4)
            pix = self.pdf[index].get_pixmap(matrix=fitz.Matrix(2, 2), clip=fitz.Rect(left, top, right, bottom), alpha=False)
            parts.append(Image.frombytes('RGB', (pix.width, pix.height), pix.samples))
        if not parts:
            return None
        image = Image.new('RGB', (max(im.width for im in parts), sum(im.height for im in parts)), 'white')
        y = 0
        for part in parts:
            image.paste(part, (0, y))
            y += part.height
        output = io.BytesIO()
        image.save(output, format='WEBP', quality=83, method=3)
        return 'data:image/webp;base64,' + base64.b64encode(output.getvalue()).decode()

    def region(self, lines, visuals, left=34, force_image=False):
        text = normalize(' '.join(line[4] for line in lines))
        content = [line[:4] for line in lines] + visuals
        picture = self.image(content, left) if content and (visuals or force_image) else None
        return {'text': text, **({'image': picture} if picture else {})}

    def extract(self, unit, guide):
        assert len(self.numbers) == len(guide.key), (unit, 'booklet and guide length differ')
        questions, contexts = [], {}
        context_start = 0
        shared = None
        shared_options = None
        for i, (start, number) in enumerate(self.numbers):
            end = self.numbers[i + 1][0] if i + 1 < len(self.numbers) else len(self.pdf) * 1000
            options = [option for option in self.choices if start < option[0] < end]
            ordered = []
            for option in options:
                if option[1] == 'ABCDE'[len(ordered)]:
                    ordered.append(option)
                    if len(ordered) == 5:
                        break
            assert 4 <= len(ordered) <= 5 and guide.key[i] in 'ABCDE'[:len(ordered)], (unit, number, options)
            stem_start = start - 6
            context_lines = self.span(context_start, stem_start)
            context_visuals = self.images(context_start, stem_start)
            if context_lines or context_visuals:
                candidate = self.region(context_lines, context_visuals, force_image=True)
                shared = f'{unit}-{number}'
                contexts[shared] = candidate
            first_choice = ordered[0][0]
            stem_lines = self.span(stem_start, first_choice - 3)
            stem_visuals = [item for item in self.images(stem_start, end - 6)
                            if (item[0] + item[1]) / 2 < first_choice - 3]
            stem = self.region(stem_lines, stem_visuals, force_image=any(x >= 150 for _, _, x, _, _ in stem_lines))
            stem['text'] = normalize(' '.join(re.sub(rf'^{number}\.\s*', '', line[4]) if line[2] < 45 else line[4]
                                             for line in stem_lines))
            choices = []
            for j, (y, letter, bottom) in enumerate(ordered):
                final = j + 1 == len(ordered)
                limit = end - 6 if final else ordered[j + 1][0] - 3
                start_text = y - (7 if j == 0 or y - ordered[j - 1][0] > 14 else 3)
                lines = self.span(start_text, limit)
                start_visual = max(y - 10, (ordered[j - 1][0] + y) / 2) if j else y - 7
                end_visual = limit if final else (y + ordered[j + 1][0]) / 2
                visuals = [item for item in self.images(stem_start, end - 6)
                           if start_visual <= (item[0] + item[1]) / 2 < end_visual]
                if final:
                    # The options are indented. Top-level text after the final answer
                    # belongs to the stimulus for the following question.
                    later_text = next((line[0] for line in lines if line[0] > y + 10 and line[2] < 65), limit)
                    lines = [line for line in lines if line[0] < later_text]
                    visuals = [v for v in visuals if v[0] < later_text and v[0] < max(bottom + 8, max((l[1] for l in lines), default=bottom) + 3)]
                    context_start = max([bottom, *[l[1] for l in lines], *[v[1] for v in visuals]]) + 1
                choice = self.region(lines, visuals, left=66, force_image=any(x >= 140 for _, _, x, _, _ in lines))
                choice['text'] = normalize(' '.join(re.sub(rf'^\({letter}\)\s*', '', line[4]) if line[2] < 72 else line[4]
                                                   for line in lines))
                choices.append(choice)
            option_text = tuple(choice['text'] for choice in choices)
            needs_context = bool(shared and number - int(shared.split('-')[1]) <= 5 and re.search(
                r'(?i)\b(above|shown|scenario|passage|study|data|graph|diagram|table|figure|map|model|according to|experiment|researchers|location [1-9]|these results|which site|which area|which letter|lettered)\b', stem['text']))
            at_context_start = shared == f'{unit}-{number}'
            if at_context_start:
                shared_options = option_text
            same_choices = shared_options == option_text and shared and number - int(shared.split('-')[1]) <= 5
            context_id = shared if at_context_start or needs_context or same_choices else None
            questions.append(dict(id=f'{unit}-{number}', sourceUnit=unit, number=number, page=int(start // 1000) + 1,
                                  stem=stem, choices=choices, answer=guide.key[i], context=context_id))
        return questions, contexts


def build(source):
    questions, contexts = [], {}
    for unit in range(1, 10):
        booklet = source / f'test booklet-unit {unit}.pdf'
        guide = source / f'scoring guide-unit {unit}.pdf'
        if unit == 5 and not guide.exists():
            guide = source / 'scoring guide-unit 5(1).pdf'
        batch, shared = Book(booklet).extract(unit, Book(guide, scored=True))
        questions.extend(batch)
        contexts.update(shared)
        print(f'Unit {unit}: {len(batch)} questions, {len(shared)} stimulus blocks')
    return dict(questions=questions, contexts=contexts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf_directory', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.write_text(json.dumps(build(args.pdf_directory), ensure_ascii=False), encoding='utf-8')


if __name__ == '__main__':
    main()
