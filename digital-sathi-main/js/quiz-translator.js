/* Digital Saathi quiz translation helper.
   English quiz content remains the source of truth. Hindi/Marathi text is
   translated on demand and cached locally so the quiz can stay unchanged
   while supporting all three languages. */
const DS_TRANSLATION_CACHE_KEY = 'digitalSaathi_quizTranslationCache_v1';
let DS_TRANSLATION_CACHE = {};
try { DS_TRANSLATION_CACHE = JSON.parse(localStorage.getItem(DS_TRANSLATION_CACHE_KEY) || '{}'); } catch (_) {}

function dsQuizCacheKey(text, lang) { return lang + '|' + text; }

async function dsTranslateBlock(texts, lang) {
    if (!texts.length || lang === 'en') return texts;
    const out = texts.slice();
    const missing = [];
    texts.forEach((text, i) => {
        const key = dsQuizCacheKey(text, lang);
        if (DS_TRANSLATION_CACHE[key]) out[i] = DS_TRANSLATION_CACHE[key];
        else missing.push({ text, i, key });
    });
    if (!missing.length) return out;

    // One request per question instead of one request per label/option.
    const marker = '<<<DS_SEPARATOR_7F2A>>>';
    const payload = missing.map(x => x.text).join('\n' + marker + '\n');
    try {
        const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=' + encodeURIComponent(lang) + '&dt=t&q=' + encodeURIComponent(payload);
        const response = await fetch(url);
        if (!response.ok) throw new Error('translation request failed');
        const data = await response.json();
        const translated = Array.isArray(data) && Array.isArray(data[0])
            ? data[0].map(part => Array.isArray(part) ? (part[0] || '') : '').join('')
            : '';
        const parts = translated.split(marker);
        if (parts.length !== missing.length) throw new Error('translation split failed');
        missing.forEach((x, j) => {
            const value = (parts[j] || '').trim();
            if (value) {
                DS_TRANSLATION_CACHE[x.key] = value;
                out[x.i] = value;
            }
        });
        localStorage.setItem(DS_TRANSLATION_CACHE_KEY, JSON.stringify(DS_TRANSLATION_CACHE));
    } catch (err) {
        console.warn('Quiz translation unavailable:', err);
        // Keep the English source as a safe fallback rather than breaking the quiz.
    }
    return out;
}

async function dsTranslateQuizItem(item, lang) {
    if (lang === 'en') return {
        q: item.q,
        options: item.options.slice(),
        explanation: item.explanation || ''
    };
    const texts = [item.q].concat(item.options, [item.explanation || '']);
    const translated = await dsTranslateBlock(texts, lang);
    return {
        q: translated[0] || item.q,
        options: translated.slice(1, 5).map((x, i) => x || item.options[i]),
        explanation: translated[5] || item.explanation || ''
    };
}
