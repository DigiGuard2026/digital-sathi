/* =========================================================
   DIGITAL SAATHI 2.0 — quiz.js (v3, randomized)
   Each quiz page defines, before loading this file:
     const quizId = "smartphone" | "payments" | "online-safety"
                    | "fake-news" | "government"
     const nextTopicUrl = "relative/path.html" or null
     const nextTopicLabel = "Next topic name" or null
   Question data comes from QUESTION_BANKS[quizId] (question-banks.js).
   Each attempt: picks 10 random questions, shuffles their order,
   and shuffles each question's option order (tracking the correct
   answer through the shuffle).

   Two-set "Try Again" behavior: on first load the 20-question bank is
   split into two disjoint 10-question pools (Set 1 and Set 2). The
   first attempt plays Set 1. Clicking "Try Again" moves to Set 2,
   which is guaranteed to share no questions with Set 1. Clicking
   "Try Again" again after Set 2 reshuffles fresh pools and restarts
   from Set 1. Progress/results/dashboard tracking (best score, XP,
   completion) is unchanged and applies per topic as before.
   ========================================================= */

let current = 0;
let score = 0;
let answered = false;
let userAnswers = [];
let quizSet = []; // the 10 randomized questions for this attempt
let quizSetNumber = 1; // which question set (1 or 2) is currently active
let questionSetPools = null; // { 1: [...10 questions...], 2: [...10 questions...] }, split so Set 2 never repeats Set 1

const progressText = document.getElementById('progressText');
const progressBarInner = document.getElementById('progressBarInner');
const questionArea = document.getElementById('questionArea');
const nextBtn = document.getElementById('nextBtn');
const resultArea = document.getElementById('resultArea');
const resultScoreEl = document.getElementById('resultScore');
const resultPercentEl = document.getElementById('resultPercent');
const resultCorrectEl = document.getElementById('resultCorrect');
const resultIncorrectEl = document.getElementById('resultIncorrect');
const resultBestEl = document.getElementById('resultBest');
const reviewList = document.getElementById('reviewList');
const restartBtn = document.getElementById('restartBtn');
const reviewBtn = document.getElementById('reviewBtn');
const nextTopicBtn = document.getElementById('nextTopicBtn');
const quizTitleEl = document.getElementById('quizTitle');

const storageKey = 'digitalSaathi_bestScore_' + (typeof quizId !== 'undefined' ? quizId : 'quiz');
const QUIZ_LENGTH = 10;

function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Splits the topic's question bank into two non-overlapping 10-question
// pools: Set 1 and Set 2. Because each topic bank has 20 questions, this
// guarantees Set 2 shares no questions with Set 1. If a bank is ever
// smaller than 20, Set 2 gets whatever unused questions remain rather
// than repeating Set 1's questions.
function buildQuestionSetPools() {
    const bank = (typeof QUESTION_BANKS !== 'undefined' && QUESTION_BANKS[quizId]) ? QUESTION_BANKS[quizId] : [];
    const shuffledBank = shuffleArray(bank);
    const setOneSize = Math.min(QUIZ_LENGTH, shuffledBank.length);
    const setOne = shuffledBank.slice(0, setOneSize);
    const remaining = shuffledBank.slice(setOneSize);
    const setTwo = remaining.length > 0 ? remaining.slice(0, QUIZ_LENGTH) : shuffleArray(bank).slice(0, setOneSize);
    return { 1: setOne, 2: setTwo };
}

// Turns a chosen 10-question pool into a playable quiz set by shuffling
// question order and each question's option order (tracking the correct answer).
function finalizeQuizSet(picked) {
    return picked.map(item => {
        const optionObjs = item.options.map((text, idx) => ({ text, isCorrect: idx === item.correct }));
        const shuffledOptions = shuffleArray(optionObjs);
        const newCorrectIndex = shuffledOptions.findIndex(o => o.isCorrect);
        return {
            source: item,
            q: item.q,
            options: shuffledOptions.map(o => o.text),
            optionSources: shuffledOptions.map(o => o.text),
            correct: newCorrectIndex,
            explanation: item.explanation
        };
    });
}

async function applyQuizLanguage(lang, preserveAnswered = false) {
    if (!quizSet.length || typeof dsTranslateQuizItem !== 'function') return;
    const translated = await Promise.all(quizSet.map(item => dsTranslateQuizItem(item.source || item, lang)));
    quizSet.forEach((item, i) => {
        item.q = translated[i].q;
        // Keep the already-shuffled option order and its correct index.
        // source.options order is not the same as displayed order, so translate each displayed option by its original source text.
        item.options = item.optionSources.map(oldText => {
            const srcIndex = (item.source.options || []).indexOf(oldText);
            return srcIndex >= 0 ? translated[i].options[srcIndex] : oldText;
        });
        item.explanation = translated[i].explanation;
    });
    updateQuizTitle();
    renderQuestion(preserveAnswered);
}

function updateQuizTitle() {
    if (!quizTitleEl) return;
    const lang = (typeof dsGetLang === 'function') ? dsGetLang() : 'en';
    const labels = (typeof DS_TOPIC_LABELS !== 'undefined' && DS_TOPIC_LABELS[quizId]) ? DS_TOPIC_LABELS[quizId] : { en: quizId, hi: quizId, mr: quizId };
    const quizWord = { en: 'Quiz', hi: 'क्विज़', mr: 'क्विझ' }[lang] || 'Quiz';
    quizTitleEl.textContent = (quizId === 'fake-news' ? '📰 ' : quizId === 'government' ? '🏛️ ' : quizId === 'payments' ? '💳 ' : quizId === 'online-safety' ? '🔐 ' : '📱 ') + labels[lang] + ' ' + quizWord;
}

window.dsQuizLanguageChanged = function() {
    if (typeof quizSet === 'undefined' || !quizSet.length) return;
    applyQuizLanguage(dsGetLang(), answered).then(() => {
        if (resultArea && !resultArea.classList.contains('hidden')) {
            const total = quizSet.length;
            const incorrect = total - score;
            const percent = Math.round((score / total) * 100);
            resultCorrectEl.textContent = `${dsT('quiz_correct_count')}: ${score}`;
            resultIncorrectEl.textContent = `${dsT('quiz_incorrect_count')}: ${incorrect}`;
            const best = getBestScore();
            resultBestEl.textContent = `${dsT('quiz_best')}: ${best === null ? score : best} / ${total}`;
            restartBtn.textContent = (quizSetNumber === 1) ? dsT('quiz_start_set2') : dsT('quiz_try_again');
        }
    });
};


function getBestScore() {
    return dsStorageGetNum(storageKey, null);
}

function saveBestScoreIfHigher(newScore) {
    const best = getBestScore();
    if (best === null || newScore > best) {
        dsStorageSet(storageKey, String(newScore));
        return newScore;
    }
    return best;
}

function updateProgressBar() {
    const pct = Math.round((current / quizSet.length) * 100);
    if (progressBarInner) progressBarInner.style.width = pct + '%';
    if (progressText) progressText.textContent = `${dsT('quiz_set')} ${quizSetNumber} · ${dsT('quiz_question')} ${current + 1} ${dsT('quiz_of')} ${quizSet.length}`;
}

function renderQuestion(preserveAnswered = false) {
    if (!preserveAnswered) answered = false;
    nextBtn.disabled = true;
    nextBtn.textContent = (current === quizSet.length - 1) ? dsT('quiz_submit') : dsT('quiz_next');
    updateProgressBar();

    const item = quizSet[current];
    const card = document.createElement('div');
    card.className = 'question-card';

    const h3 = document.createElement('h3');
    h3.textContent = item.q;
    card.appendChild(h3);

    const optionsWrap = document.createElement('div');
    optionsWrap.className = 'options';

    item.options.forEach((optText, idx) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.textContent = optText;
        if (preserveAnswered && userAnswers[current] !== undefined) {
            btn.disabled = true;
            if (idx === item.correct) btn.classList.add('correct');
            if (idx === userAnswers[current] && idx !== item.correct) btn.classList.add('incorrect');
        } else {
            btn.addEventListener('click', () => selectAnswer(idx, btn, optionsWrap));
        }
        optionsWrap.appendChild(btn);
    });

    card.appendChild(optionsWrap);

    const feedback = document.createElement('div');
    feedback.className = 'feedback';
    feedback.id = 'feedback';
    if (preserveAnswered) feedback.textContent = (userAnswers[current] === item.correct) ? '✅ ' + dsT('quiz_correct') : '❌ ' + dsT('quiz_not_quite');
    card.appendChild(feedback);

    const explanation = document.createElement('div');
    explanation.className = 'explanation hidden';
    explanation.id = 'explanation';
    if (preserveAnswered && item.explanation) { explanation.textContent = '💡 ' + item.explanation; explanation.classList.remove('hidden'); }
    card.appendChild(explanation);

    questionArea.innerHTML = '';
    questionArea.appendChild(card);
}

function selectAnswer(idx, btnEl, optionsWrap) {
    if (answered) return;
    answered = true;
    const item = quizSet[current];
    userAnswers[current] = idx;

    const buttons = optionsWrap.querySelectorAll('.option-btn');
    buttons.forEach((b, i) => {
        b.disabled = true;
        if (i === item.correct) b.classList.add('correct');
    });

    const feedback = document.getElementById('feedback');
    if (idx === item.correct) {
        score++;
        feedback.textContent = "✅ Correct!";
    } else {
        btnEl.classList.add('incorrect');
        feedback.textContent = "❌ Not quite — the correct answer is highlighted above.";
    }

    if (item.explanation) {
        const explanation = document.getElementById('explanation');
        explanation.textContent = "💡 " + item.explanation;
        explanation.classList.remove('hidden');
    }

    nextBtn.disabled = false;
}

nextBtn.addEventListener('click', () => {
    current++;
    if (current < quizSet.length) {
        renderQuestion();
    } else {
        showResults();
    }
});

function showResults() {
    if (progressText) progressText.textContent = '';
    if (progressBarInner) progressBarInner.style.width = '100%';
    questionArea.innerHTML = '';
    nextBtn.classList.add('hidden');
    resultArea.classList.remove('hidden');

    const total = quizSet.length;
    const incorrect = total - score;
    const percent = Math.round((score / total) * 100);

    resultScoreEl.textContent = `${score} / ${total}`;
    resultPercentEl.textContent = `${percent}%`;
    if (resultCorrectEl) resultCorrectEl.textContent = `${dsT('quiz_correct_count')}: ${score}`;
    if (resultIncorrectEl) resultIncorrectEl.textContent = `${dsT('quiz_incorrect_count')}: ${incorrect}`;

    const best = saveBestScoreIfHigher(score);
    resultBestEl.textContent = `${dsT('quiz_best')}: ${best} / ${total}`;

    if (typeof quizId !== 'undefined') {
        dsStorageSet('digitalSaathi_completed_' + quizId, 'true');
        dsAddXP(30);
        if (percent >= 90) dsAddXP(50);
    }

    if (nextTopicBtn) {
        if (typeof nextTopicUrl !== 'undefined' && nextTopicUrl) {
            nextTopicBtn.href = nextTopicUrl;
            const nextId = (typeof nextTopicUrl !== 'undefined' && nextTopicUrl) ? (nextTopicUrl.match(/(smartphone|payments|online-safety|fake-news|government)-quiz/) || [])[1] : null;
            const nextLabel = nextId && typeof DS_TOPIC_LABELS !== 'undefined' ? DS_TOPIC_LABELS[nextId][dsGetLang()] : (typeof nextTopicLabel !== 'undefined' ? nextTopicLabel : 'Continue');
            nextTopicBtn.textContent = dsT('quiz_next_topic') + ': ' + nextLabel;
            nextTopicBtn.classList.remove('hidden');
        } else {
            nextTopicBtn.classList.add('hidden');
        }
    }

    // Label the restart button with whichever set it will start next, so the
    // choice is explicit: after Set 1 it offers Set 2; after Set 2 it offers
    // to try again (which restarts from a fresh Set 1).
    if (restartBtn) {
        restartBtn.textContent = (quizSetNumber === 1) ? dsT('quiz_start_set2') : dsT('quiz_try_again');
    }
}

if (reviewBtn) {
    reviewBtn.addEventListener('click', () => {
        reviewList.classList.toggle('hidden');
        if (reviewList.classList.contains('hidden')) return;
        reviewList.innerHTML = '';
        quizSet.forEach((item, i) => {
            const chosen = userAnswers[i];
            const isRight = chosen === item.correct;
            const div = document.createElement('div');
            div.className = 'review-item ' + (isRight ? 'right' : 'wrong');
            const chosenText = (chosen !== undefined && chosen !== -1) ? item.options[chosen] : '(skipped)';
            div.innerHTML = `<strong>Q${i + 1}: ${item.q}</strong><br>
                ${dsT('quiz_your_answer')}: ${chosenText} ${isRight ? '✅' : '❌'}<br>
                ${!isRight ? dsT('quiz_correct_answer') + ': ' + item.options[item.correct] + '<br>' : ''}
                <em>${item.explanation || ''}</em>`;
            reviewList.appendChild(div);
        });
    });
}

restartBtn.addEventListener('click', () => {
    startNewAttempt();
});

function startNewAttempt() {
    if (!questionSetPools) {
        // First attempt on this page load: build the two disjoint pools and start with Set 1.
        questionSetPools = buildQuestionSetPools();
        quizSetNumber = 1;
    } else if (quizSetNumber === 1) {
        // "Try Again" after Set 1: move on to Set 2, which shares no questions with Set 1.
        quizSetNumber = 2;
    } else {
        // Both sets have now been played once — reshuffle fresh pools and start over from Set 1.
        questionSetPools = buildQuestionSetPools();
        quizSetNumber = 1;
    }

    quizSet = finalizeQuizSet(questionSetPools[quizSetNumber]);
    current = 0;
    score = 0;
    userAnswers = [];
    resultArea.classList.add('hidden');
    if (reviewList) { reviewList.classList.add('hidden'); reviewList.innerHTML = ''; }
    nextBtn.classList.remove('hidden');
    renderQuestion();
    applyQuizLanguage(dsGetLang());
}

startNewAttempt();
