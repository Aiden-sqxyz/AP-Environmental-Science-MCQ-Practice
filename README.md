# APES MCQ Practice

[Open APES MCQ Practice](https://apes-mcq-practice-aiden.humblecob8.chatgpt.site/)

A personal AP Environmental Science multiple-choice practice site. Choose a numbered topic, a unit, or a randomized whole-course set. The site checks answers against the nine scoring guides, scores the set, and lets you retry missed questions. It saves the current session in the browser.

The topic list follows College Board's [AP Environmental Science Course and Exam Description, effective fall 2026](https://apcentral.collegeboard.org/media/pdf/ap-environmental-science-course-and-exam-description.pdf). The source booklet remains visible inside each quiz. Unit filters follow the content tags, so a question can appear in a unit other than the one named in the original booklet.

`stimulus_sets.txt` records which original booklet questions use the same material. The quiz displays these questions together in source order, including on retries. Topic and unit filters can pick a set when any question in the set matches. Approximate quiz lengths leave room for complete sets.

## Build the personal site

Place the nine test booklets and nine scoring guides in a local directory, using their original names, such as `test booklet-unit 1.pdf` and `scoring guide-unit 1.pdf`. The original `scoring guide-unit 5(1).pdf` filename is also supported. Run from the repository root:

```sh
python -m pip install -r requirements.txt
python build_site.py APES-MCQ-Practice.html --pdfs /path/to/pdfs
```

Open `APES-MCQ-Practice.html` in your browser. It includes the questions and figures and works offline. Keep this generated file with your personal study materials. The repository contains the app and build files.

## Review topic assignments

Pass `--report topic-review.tsv` to the build command for a list of question IDs, tags, provisional matches, and source text. IDs use `booklet-question`, such as `4-97`. `topic_overrides.txt` records reviewed matches. `topic_rules.txt` provides the initial classification for other questions using the stem, keyed choice, and shared material. The displayed course unit comes from the CED topic ID. Provisional tags are marked in answer feedback.

The app supports an optional explanation field on each question for a later revision. The first build shows the keyed answers and topic tags.
