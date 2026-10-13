# Pocket Pantheon · Copyright (c) 2026 Albeen (albeen-sknight)
"""Checks every player string in data/text against the writing standard (PLAN section 25)."""
import json
import re
import sys
from pathlib import Path

TEXT_DIR = Path(__file__).resolve().parent.parent / "data" / "text"
LANGS = ("en", "es")
MAX_WORDS = 30

BANNED = {
    "en": ["delve", "leverage", "furthermore", "moreover", "additionally",
           "it is important to note", "in conclusion", "navigate", "robust",
           "seamless", "embark", "tapestry"],
    "es": ["cabe destacar", "es importante señalar", "en conclusión", "asimismo",
           "adentrarse", "sin fisuras", "robusto", "en definitiva"],
}

DASHES = re.compile(r"[\-‐‑‒–—―−]")
TAGS = re.compile(r"<[^>]+>")
SENTENCE_END = re.compile(r"(?<=[.!?…])\s+")
NUMBER = re.compile(r"\d[\d.,]*")


def flatten(node, prefix=""):
    if isinstance(node, str):
        yield prefix, node
        return
    for key, value in node.items():
        yield from flatten(value, f"{prefix}.{key}" if prefix else key)


def plain(text):
    return TAGS.sub(" ", text)


def numbers(text):
    # 3,184 and 3.184 are the same number in different languages
    return sorted(re.sub(r"[.,]", "", n.rstrip(".,")) for n in NUMBER.findall(plain(text)))


def check_string(lang, key, text):
    errors = []
    body = plain(text)
    if not body.strip():
        errors.append("empty string")
    if DASHES.search(body):
        errors.append("has a dash or hyphen")
    lower = body.lower()
    for word in BANNED[lang]:
        if re.search(rf"\b{re.escape(word)}\w*", lower):
            errors.append(f'banned phrase "{word}"')
    for sentence in SENTENCE_END.split(body):
        if len(sentence.split()) > MAX_WORDS:
            errors.append(f"sentence over {MAX_WORDS} words: {sentence[:40]}...")
    return [f"{lang}.json {key}: {e}" for e in errors]


def lint(texts):
    errors = []
    flat = {lang: dict(flatten(texts[lang])) for lang in LANGS}
    for lang in LANGS:
        for key, text in flat[lang].items():
            errors += check_string(lang, key, text)

    en, es = flat["en"], flat["es"]
    for key in en.keys() - es.keys():
        errors.append(f"es.json is missing {key}")
    for key in es.keys() - en.keys():
        errors.append(f"en.json is missing {key}")
    for key in en.keys() & es.keys():
        if numbers(en[key]) != numbers(es[key]):
            errors.append(f"{key}: numbers differ, en {numbers(en[key])} vs es {numbers(es[key])}")
    return errors


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    texts = {}
    for lang in LANGS:
        path = TEXT_DIR / f"{lang}.json"
        texts[lang] = json.loads(path.read_text(encoding="utf-8"))

    errors = lint(texts)
    for e in sorted(errors):
        print(e)
    if errors:
        print(f"text lint failed: {len(errors)} problem(s)")
        return 1
    count = sum(1 for _ in flatten(texts["en"]))
    print(f"text lint ok: {count} strings in {len(LANGS)} languages")
    return 0


if __name__ == "__main__":
    sys.exit(main())
