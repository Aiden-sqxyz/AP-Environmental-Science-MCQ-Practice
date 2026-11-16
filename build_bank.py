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


def read_stimulus_sets():
    sets = {}
    path = Path(__file__).with_name('stimulus_sets.txt')
    for line in path.read_text().splitlines():
        if not line or line.startswith('#'):
            continue
        unit, ranges = line.split(':', 1)
        for entry in ranges.split(','):
            entry = entry.strip()
            inline = entry.startswith('*')
            first, _, last = entry.lstrip('*').partition('-')
            source = f'{unit}-{first}'
            for number in range(int(first), int(last or first) + 1):
                id = f'{unit}-{number}'
                assert id not in sets, ('Overlapping stimulus sets', id)
                sets[id] = (source, source if not inline else None)
    return sets


def line_text(lines):
    """Read runs on the same baseline in their left-to-right order."""
    rows = []
    for line in lines:
        if not rows or line[0] - rows[-1][0][0] > 1.8:
            rows.append([])
        rows[-1].append(line)
    return normalize(' '.join(line[4] for row in rows for line in sorted(row, key=lambda item: item[2])))


class Book:
    def __init__(self, path, scored=False):
        self.pdf = fitz.open(path)
        self.lines, self.numbers, self.choices, self.visuals, self.key = [], [], [], [], []
        self.choice_block_tops = {}
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
                choice_labels = []
                for line in block.get('lines', []):
                    x, y, right, bottom = line['bbox']
                    text = normalize(''.join(s['text'] for s in line['spans']))
                    if 65 <= x < 71 and re.match(r'^\([A-E]\)(?:\s|$)', text):
                        choice_labels.append(offset + y)
                    if 81 < y < 755 and 34 <= x < 577 and text:
                        self.lines.append((offset + y, offset + bottom, x, right, text))
                if len(choice_labels) == 1:
                    self.choice_block_tops[round(choice_labels[0], 2)] = offset + block['bbox'][1]
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

    def image(self, content, left, bounds):
        parts = []
        first = int(min(y for y, *_ in content) // 1000)
        last = int(max(b for _, b, *_ in content) // 1000)
        for index in range(first, last + 1):
            offset = index * 1000
            page_items = [(y - offset, bottom - offset, right) for y, bottom, _, right in content
                          if offset <= y < offset + 1000]
            if not page_items:
                continue
            top = max(80, min(y for y, _, _ in page_items) - 3, bounds[0] - offset)
            bottom = min(756, max(b for _, b, _ in page_items) + 3, bounds[1] - offset)
            right = min(578, max(r for _, _, r in page_items) + 4)
            if top >= bottom or left >= right:
                continue
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

    def region(self, lines, visuals, left=34, force_image=False, bounds=(-float('inf'), float('inf'))):
        text = line_text(lines)
        content = [line[:4] for line in lines] + visuals
        picture = self.image(content, left, bounds) if content and (visuals or force_image) else None
        return {'text': text, **({'image': picture} if picture else {})}

    def choice_boundaries(self, options, visuals, end):
        """Find the top of each choice, including graphics above its letter."""
        centers = [(top + bottom) / 2 for top, _, bottom in options]
        boxes = [[(top, bottom) for top, bottom, left, right in visuals
                  if left >= 82 and right - left > 3 and top <= center <= bottom
                  and all(not top <= other <= bottom for other in centers if other != center)]
                 for center in centers]
        cuts = []
        for index, (y, _, _) in enumerate(options):
            block_top = self.choice_block_tops.get(round(y, 2), y)
            top = min(y - 8, block_top - .8, *(left - .8 for left, _ in boxes[index]))
            if index:
                top = max(top, options[index - 1][2] + .3)
                # A label can be printed on the previous page when its table
                # starts on the next page. Leave the preceding table intact.
                prior_edges = [bottom for _, bottom in boxes[index - 1] if bottom < y - .4]
                if prior_edges:
                    top = max(top, min(y - .2, max(prior_edges) + .3))
            cuts.append(top)
        return [*cuts, end]

    def extract(self, unit, guide, sets):
        assert len(self.numbers) == len(guide.key), (unit, 'booklet and guide length differ')
        questions, contexts = [], {}
        context_start = 0
        for i, (start, number) in enumerate(self.numbers):
            id = f'{unit}-{number}'
            set_id, context_id = sets.get(id, (id, None))
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
            if context_id == id:
                context_lines = self.span(context_start, stem_start)
                context_visuals = self.images(context_start, stem_start)
                assert context_lines or context_visuals, ('Missing source material', id)
                contexts[id] = self.region(context_lines, context_visuals, force_image=True)
            visuals = self.images(stem_start, end - 6)
            cuts = self.choice_boundaries(ordered, visuals, end - 6)
            first_choice = cuts[0]
            stem_lines = self.span(stem_start, first_choice)
            stem_visuals = [item for item in visuals
                            if (item[0] + item[1]) / 2 < first_choice]
            stem = self.region(stem_lines, stem_visuals, force_image=any(x >= 150 for _, _, x, _, _ in stem_lines),
                               bounds=(stem_start, first_choice))
            stem['text'] = line_text([(*line[:4], re.sub(rf'^{number}\.\s*', '', line[4]) if line[2] < 45 else line[4])
                                      for line in stem_lines])
            choices = []
            for j, (y, letter, bottom) in enumerate(ordered):
                final = j + 1 == len(ordered)
                top, limit = cuts[j:j+2]
                lines = self.span(top, limit)
                choice_visuals = [item for item in visuals if top <= (item[0] + item[1]) / 2 < limit]
                if final:
                    lines, choice_visuals, context_start = self.finish_choice(lines, choice_visuals, y, bottom)
                    limit = min(limit, context_start + 2)
                choice = self.region(lines, choice_visuals, left=84, force_image=any(x >= 140 for _, _, x, _, _ in lines),
                                     bounds=(top, limit))
                choice['text'] = line_text([(*line[:4], re.sub(rf'^\({letter}\)\s*', '', line[4]) if line[2] < 72 else line[4])
                                            for line in lines])
                choices.append(choice)
            questions.append(dict(id=id, sourceUnit=unit, number=number, page=int(start // 1000) + 1,
                                  stem=stem, choices=choices, answer=guide.key[i], context=context_id, setId=set_id))
        return questions, contexts

    def finish_choice(self, lines, visuals, y, bottom):
        # Final-option text continues at the option indent with normal line spacing.
        # Stop at the next paragraph or page, before inspecting the next stimulus.
        center = (y + bottom) / 2
        anchored_edges = [end for top, end, left, _ in visuals if left >= 82 and top <= center <= end]
        end_of_text = max([bottom, *anchored_edges])
        option_lines = []
        for line in lines:
            top, end, x, *_ = line
            if top > y + 9 and (x < 85 or top > end_of_text + 13):
                break
            option_lines.append(line)
            end_of_text = max(end_of_text, end)
        option_visuals = [item for item in visuals if item[0] <= end_of_text + 3 and item[2] >= 82]
        content_end = max([end_of_text, *[item[1] for item in option_visuals]])
        return option_lines, option_visuals, content_end + 1


def build(source):
    questions, contexts = [], {}
    sets = read_stimulus_sets()
    for unit in range(1, 10):
        booklet = source / f'test booklet-unit {unit}.pdf'
        guide = source / f'scoring guide-unit {unit}.pdf'
        if unit == 5 and not guide.exists():
            guide = source / 'scoring guide-unit 5(1).pdf'
        batch, shared = Book(booklet).extract(unit, Book(guide, scored=True), sets)
        questions.extend(batch)
        contexts.update(shared)
        print(f'Unit {unit}: {len(batch)} questions, {len(shared)} stimulus blocks')
    known = {question['id'] for question in questions}
    assert set(sets) <= known
    assert all(question['context'] in contexts for question in questions if question['context'])
    assert all(choice['text'] or choice.get('image') for q in questions for choice in q['choices'])
    return dict(questions=questions, contexts=contexts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf_directory', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.write_text(json.dumps(build(args.pdf_directory), ensure_ascii=False), encoding='utf-8')


if __name__ == '__main__':
    main()
