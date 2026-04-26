"""
Text Processing Layer
=====================
- Normalize transcript (contractions, numbers, punctuation)
- Convert to phoneme sequence via espeak G2P
- Include stress markers (primary ˈ / secondary ˌ)
- Provide word→phoneme mapping for downstream alignment

Uses espeak-ng as the G2P backend because it produces IPA with stress markers,
handles unknown words via rules, and is deterministic.
"""

import re
from dataclasses import dataclass, field
from phonemizer import phonemize
from phonemizer.separator import Separator


# ── Contractions & reductions ─────────────────────────────────────────────

CONTRACTIONS: dict[str, list[str]] = {
    "i'm": ["i", "am"], "i'll": ["i", "will"], "i'd": ["i", "would"],
    "i've": ["i", "have"],
    "you're": ["you", "are"], "you'll": ["you", "will"], "you'd": ["you", "would"],
    "you've": ["you", "have"],
    "he's": ["he", "is"], "he'll": ["he", "will"], "he'd": ["he", "would"],
    "she's": ["she", "is"], "she'll": ["she", "will"], "she'd": ["she", "would"],
    "it's": ["it", "is"], "it'll": ["it", "will"], "it'd": ["it", "would"],
    "we're": ["we", "are"], "we'll": ["we", "will"], "we'd": ["we", "would"],
    "we've": ["we", "have"],
    "they're": ["they", "are"], "they'll": ["they", "will"], "they'd": ["they", "would"],
    "they've": ["they", "have"],
    "that's": ["that", "is"], "that'll": ["that", "will"],
    "there's": ["there", "is"], "here's": ["here", "is"],
    "what's": ["what", "is"], "who's": ["who", "is"], "where's": ["where", "is"],
    "don't": ["do", "not"], "doesn't": ["does", "not"], "didn't": ["did", "not"],
    "isn't": ["is", "not"], "aren't": ["are", "not"], "wasn't": ["was", "not"],
    "weren't": ["were", "not"],
    "won't": ["will", "not"], "wouldn't": ["would", "not"],
    "can't": ["can", "not"], "couldn't": ["could", "not"],
    "shouldn't": ["should", "not"],
    "hasn't": ["has", "not"], "haven't": ["have", "not"], "hadn't": ["had", "not"],
    "let's": ["let", "us"],
    "gonna": ["going", "to"], "gotta": ["got", "to"], "wanna": ["want", "to"],
    "kinda": ["kind", "of"], "sorta": ["sort", "of"],
    "coulda": ["could", "have"], "shoulda": ["should", "have"],
    "woulda": ["would", "have"],
    "dunno": ["do", "not", "know"], "lemme": ["let", "me"], "gimme": ["give", "me"],
}

# Function words — unstressed in natural English
FUNCTION_WORDS: set[str] = {
    "a", "an", "the", "is", "am", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "shall", "should",
    "may", "might", "can", "could", "must",
    "i", "me", "my", "mine", "you", "your", "yours", "he", "him", "his",
    "she", "her", "hers", "it", "its", "we", "us", "our", "ours",
    "they", "them", "their", "theirs",
    "this", "that", "these", "those",
    "in", "on", "at", "to", "for", "of", "with", "by", "from", "up", "about",
    "into", "through", "during", "before", "after", "above", "below", "between",
    "and", "but", "or", "nor", "so", "yet", "if", "when", "while", "as",
    "not", "no", "than", "then", "just", "also", "very", "too",
}


# ── Number expansion ─────────────────────────────────────────────────────

_ONES = [
    "", "one", "two", "three", "four", "five", "six", "seven",
    "eight", "nine", "ten", "eleven", "twelve", "thirteen",
    "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
]
_TENS = [
    "", "", "twenty", "thirty", "forty", "fifty",
    "sixty", "seventy", "eighty", "ninety",
]


def _number_to_words(s: str) -> str:
    try:
        n = int(s)
    except ValueError:
        return s
    if n < 0:
        return "minus " + _number_to_words(str(-n))
    if n < 20:
        return _ONES[n]
    if n < 100:
        return _TENS[n // 10] + ("" if n % 10 == 0 else " " + _ONES[n % 10])
    if n < 1000:
        rest = _number_to_words(str(n % 100))
        return _ONES[n // 100] + " hundred" + ("" if not rest else " " + rest)
    if n < 1_000_000:
        rest = _number_to_words(str(n % 1000))
        return _number_to_words(str(n // 1000)) + " thousand" + ("" if not rest else " " + rest)
    return s


# ── Data structures ──────────────────────────────────────────────────────

@dataclass
class PhonemeInfo:
    """A single phoneme with stress and position info."""
    phone: str              # IPA symbol (e.g. "p", "æ", "t")
    stress: int             # 0=none, 1=primary, 2=secondary
    is_vowel: bool          # True for vowels (carries stress)


@dataclass
class WordPhonemes:
    """Phoneme breakdown for a single word."""
    word: str                           # Original word text
    phonemes: list[PhonemeInfo]         # Ordered phonemes with stress
    raw_ipa: str                        # Raw IPA string from G2P
    is_content_word: bool               # True if content word (should be stressed)


@dataclass
class ProcessedText:
    """Full processed text ready for alignment."""
    original: str                       # Original input text
    words: list[WordPhonemes]           # Per-word phoneme data
    flat_phonemes: list[str]            # Flat phoneme list for alignment
    word_boundaries: list[tuple[int, int]]  # (start, end) indices into flat_phonemes


# ── Phoneme classification ───────────────────────────────────────────────

_VOWELS = set("iyɨʉɯuɪʏʊeøɘɵɤoəɛœɜɞʌɔæɐaɶɑɒɚɝ")

# Compound IPA tokens that should be split for alignment
_COMPOUND_SPLITS: dict[str, list[str]] = {
    "tʃ": ["t", "ʃ"], "dʒ": ["d", "ʒ"],
    "aɪ": ["a", "ɪ"], "aʊ": ["a", "ʊ"], "eɪ": ["e", "ɪ"],
    "oɪ": ["o", "ɪ"], "oʊ": ["o", "ʊ"], "əʊ": ["ə", "ʊ"],
    "aɪə": ["a", "ɪ", "ə"], "aɪɚ": ["a", "ɪ", "ɚ"],
    "ɪə": ["ɪ", "ə"], "ʊə": ["ʊ", "ə"], "eə": ["e", "ə"],
    "ɑːɹ": ["ɑ", "ɹ"], "ɔːɹ": ["ɔ", "ɹ"], "oːɹ": ["o", "ɹ"],
    "ɪɹ": ["ɪ", "ɹ"], "ɛɹ": ["ɛ", "ɹ"], "ʊɹ": ["ʊ", "ɹ"],
    "æɹ": ["æ", "ɹ"], "ʌɹ": ["ʌ", "ɹ"], "ɒɹ": ["ɒ", "ɹ"],
    "ɜːɹ": ["ɜ", "ɹ"], "əɹ": ["ə", "ɹ"],
    "əl": ["ə", "l"],
}

# Merge variant IPA symbols
_PHONE_ALIASES: dict[str, str] = {
    "r": "ɹ", "ɝ": "ɚ", "ɜ": "ə", "ɐ": "ə", "ᵻ": "ɪ",
    "g": "ɡ", "ɫ": "l", "ɾ": "ɹ", "ɻ": "ɹ", "ɽ": "ɹ", "ʋ": "v",
}

_LENGTH_STRIP = str.maketrans("", "", "ː")


def _is_vowel(phone: str) -> bool:
    """Check if a phoneme is a vowel."""
    base = phone.translate(_LENGTH_STRIP)
    base = _PHONE_ALIASES.get(base, base)
    return any(c in _VOWELS for c in base)


def normalize_phoneme(phone: str) -> str:
    """Normalize a single phoneme: strip length, apply aliases."""
    stripped = phone.translate(_LENGTH_STRIP)
    return _PHONE_ALIASES.get(stripped, stripped)


def normalize_phoneme_list(phones: list[str]) -> list[str]:
    """Split compounds, strip length marks, apply aliases."""
    out: list[str] = []
    for tok in phones:
        if tok in _COMPOUND_SPLITS:
            out.extend(_COMPOUND_SPLITS[tok])
        else:
            stripped = tok.translate(_LENGTH_STRIP)
            if stripped:
                out.append(stripped)
    return [_PHONE_ALIASES.get(p, p) for p in out]


# ── G2P ──────────────────────────────────────────────────────────────────

def _parse_ipa_with_stress(ipa: str) -> list[PhonemeInfo]:
    """Parse an IPA string into PhonemeInfo list, extracting stress markers.

    Stress markers ˈ (primary) and ˌ (secondary) apply to the next vowel.
    """
    # Remove syllable boundaries
    ipa = ipa.replace(".", "").replace("-", "")

    phonemes: list[PhonemeInfo] = []
    current_stress = 0
    i = 0

    while i < len(ipa):
        ch = ipa[i]

        # Stress markers
        if ch == "ˈ":
            current_stress = 1
            i += 1
            continue
        elif ch == "ˌ":
            current_stress = 2
            i += 1
            continue

        # Try matching multi-character phonemes (longest first)
        matched = False
        for length in (3, 2):
            if i + length <= len(ipa):
                candidate = ipa[i:i + length]
                if candidate in _COMPOUND_SPLITS:
                    # Split compound into atomic phonemes
                    for j, sub in enumerate(_COMPOUND_SPLITS[candidate]):
                        is_v = _is_vowel(sub)
                        stress = current_stress if is_v and j == 0 else 0
                        phonemes.append(PhonemeInfo(
                            phone=normalize_phoneme(sub),
                            stress=stress,
                            is_vowel=is_v,
                        ))
                    if any(_is_vowel(s) for s in _COMPOUND_SPLITS[candidate]):
                        current_stress = 0
                    i += length
                    matched = True
                    break

        if matched:
            continue

        # Skip length marks and other modifiers
        if ch in "ːˑ":
            i += 1
            continue

        # Single character phoneme
        if ch.isalpha() or ch in _VOWELS or ch in "ðθʃʒŋɡɹɪʊəɛæɑɒʌɔɚɝ":
            is_v = _is_vowel(ch)
            stress = current_stress if is_v else 0
            norm = normalize_phoneme(ch)
            if norm:  # Skip if normalization produces empty
                phonemes.append(PhonemeInfo(
                    phone=norm,
                    stress=stress,
                    is_vowel=is_v,
                ))
                if is_v:
                    current_stress = 0
        i += 1

    return phonemes


def process_text(text: str) -> ProcessedText:
    """Full text processing: normalize → G2P → stress extraction.

    Returns ProcessedText with per-word phoneme data and flat phoneme sequence
    ready for CTC forced alignment.
    """
    # Tokenize: extract words and numbers
    raw_tokens = re.findall(r"[a-zA-Z']+|\d+", text)
    if not raw_tokens:
        return ProcessedText(original=text, words=[], flat_phonemes=[], word_boundaries=[])

    # Expand numbers
    tokens: list[str] = []
    for tok in raw_tokens:
        if re.fullmatch(r"\d+", tok):
            tokens.extend(_number_to_words(tok).split())
        else:
            tokens.append(tok)

    if not tokens:
        return ProcessedText(original=text, words=[], flat_phonemes=[], word_boundaries=[])

    # G2P with stress markers preserved
    # phonemize with preserve_punctuation=False, with_stress=True
    ipa_strs = phonemize(
        tokens,
        language="en-us",
        backend="espeak",
        separator=Separator(phone=" ", word="", syllable=""),
        strip=True,
        preserve_punctuation=False,
        with_stress=True,
    )

    words: list[WordPhonemes] = []
    flat_phonemes: list[str] = []
    word_boundaries: list[tuple[int, int]] = []

    for word, ipa in zip(tokens, ipa_strs):
        ipa = ipa.strip()
        phoneme_infos = _parse_ipa_with_stress(ipa)

        is_content = word.lower() not in FUNCTION_WORDS

        start_idx = len(flat_phonemes)
        for pi in phoneme_infos:
            flat_phonemes.append(pi.phone)
        end_idx = len(flat_phonemes)

        word_boundaries.append((start_idx, end_idx))

        words.append(WordPhonemes(
            word=word,
            phonemes=phoneme_infos,
            raw_ipa=ipa,
            is_content_word=is_content,
        ))

    return ProcessedText(
        original=text,
        words=words,
        flat_phonemes=flat_phonemes,
        word_boundaries=word_boundaries,
    )


def expand_contractions(words: list[str]) -> list[str]:
    """Expand contractions for word-level alignment."""
    result: list[str] = []
    for w in words:
        low = w.lower()
        if low in CONTRACTIONS:
            result.extend(CONTRACTIONS[low])
        else:
            result.append(low)
    return result
