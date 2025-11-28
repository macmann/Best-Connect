(function () {
  const root = document.getElementById('interview-root');
  const token = window.location.pathname.split('/').pop();
  const draftKey = `ai_interview_${token}`;

  function renderMessage(title, description) {
    root.innerHTML = `
      <div class="space-y-3 text-center">
        <h2 class="text-xl font-semibold text-gray-900">${title}</h2>
        <p class="text-gray-600">${description || ''}</p>
      </div>
    `;
  }

  function getDraft() {
    if (!token) return {};
    try {
      const value = localStorage.getItem(draftKey);
      return value ? JSON.parse(value) : {};
    } catch (err) {
      return {};
    }
  }

  function saveDraft(data) {
    if (!token) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify(data));
    } catch (err) {
      // Ignore storage errors
    }
  }

  function clearDraft() {
    if (!token) return;
    try {
      localStorage.removeItem(draftKey);
    } catch (err) {
      // Ignore storage errors
    }
  }

  async function fetchSession() {
    try {
      const response = await fetch(`/api/public/ai-interview/${encodeURIComponent(token)}`);
      if (response.status === 404) {
        renderMessage(
          'Invalid or expired link',
          'This interview link is invalid or has expired. Please contact your recruiter for a new link.'
        );
        return null;
      }

      if (!response.ok) {
        renderMessage('Unable to load interview', 'Please refresh the page or try again later.');
        return null;
      }

      return await response.json();
    } catch (err) {
      console.error('Failed to fetch interview session', err);
      renderMessage('Network error', 'Please check your connection and try again.');
      return null;
    }
  }

  function renderForm(session) {
    const draft = getDraft();
    const questions = Array.isArray(session.questions) ? session.questions : [];
    if (!questions.length) {
      renderMessage('No interview questions available', 'Please contact your recruiter for an updated link.');
      return;
    }
    let currentIndex = 0;

    const greeting = `Hi ${session.candidateName || 'there'}, welcome to your written interview for ${
      session.positionTitle || 'this role'
    } at Brillar.`;

    root.innerHTML = `
      <div class="space-y-8">
        <div class="space-y-2">
          <h2 class="text-2xl font-semibold text-gray-900">${session.templateTitle || 'AI Interview'}</h2>
          <p class="text-gray-600">${greeting}</p>
          <p class="text-gray-600">Answer each question one at a time. Your responses are saved locally as drafts until you submit.</p>
        </div>

        <div id="message" class="hidden rounded-md bg-red-50 border border-red-200 text-red-800 px-4 py-3 text-sm"></div>

        <div class="card space-y-4">
          <div class="flex items-center justify-between">
            <p id="progress" class="badge">Question 1 of ${questions.length}</p>
            <p class="text-sm text-gray-600">You can go back anytime before submitting.</p>
          </div>

          <form id="interview-form" class="space-y-4">
            <div class="space-y-3">
              <h3 id="question-text" class="text-lg font-semibold text-gray-900"></h3>
              <p class="text-sm text-gray-600">Write your response in the box below. Your draft will be saved as you type.</p>
              <label class="text-sm font-semibold text-gray-900" for="question-answer">Your Answer</label>
              <textarea
                id="question-answer"
                class="input-field"
                rows="6"
                aria-describedby="progress"
              ></textarea>
            </div>

            <div class="flex items-center justify-between pt-2 gap-3">
              <button type="button" id="prev-btn" class="btn btn-secondary">Previous</button>
              <div class="flex gap-3">
                <button type="button" id="next-btn" class="btn btn-secondary">Save & Next</button>
                <button type="submit" id="submit-btn" class="btn btn-primary">Submit Interview</button>
              </div>
            </div>
          </form>
        </div>
      </div>
    `;

    const form = document.getElementById('interview-form');
    const messageBox = document.getElementById('message');
    const progress = document.getElementById('progress');
    const questionText = document.getElementById('question-text');
    const answerField = document.getElementById('question-answer');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const submitBtn = document.getElementById('submit-btn');

    function syncButtons() {
      prevBtn.disabled = currentIndex === 0;
      const onLastQuestion = currentIndex === questions.length - 1;
      nextBtn.classList.toggle('hidden', onLastQuestion);
      submitBtn.classList.toggle('hidden', !onLastQuestion);
    }

    function loadQuestion() {
      const question = questions[currentIndex];
      if (!question) return;

      messageBox.classList.add('hidden');
      messageBox.textContent = '';
      progress.textContent = `Question ${currentIndex + 1} of ${questions.length}`;
      questionText.textContent = question.text;
      answerField.value = draft[question.id] || '';
      syncButtons();
      answerField.focus();
    }

    function persistCurrentAnswer() {
      const question = questions[currentIndex];
      if (!question) return;
      draft[question.id] = answerField.value;
      saveDraft(draft);
    }

    answerField.addEventListener('input', persistCurrentAnswer);

    prevBtn.addEventListener('click', () => {
      persistCurrentAnswer();
      if (currentIndex > 0) {
        currentIndex -= 1;
        loadQuestion();
      }
    });

    nextBtn.addEventListener('click', () => {
      persistCurrentAnswer();
      if (currentIndex < questions.length - 1) {
        currentIndex += 1;
        loadQuestion();
      }
    });

    form.addEventListener('submit', async event => {
      event.preventDefault();
      persistCurrentAnswer();
      messageBox.classList.add('hidden');
      messageBox.textContent = '';

      const answers = questions.map(question => ({
        questionId: question.id,
        answerText: (draft[question.id] || '').trim()
      }));

      const missing = answers.some(answer => !answer.answerText);
      if (missing) {
        messageBox.textContent = 'Please answer all questions before submitting.';
        messageBox.classList.remove('hidden');
        return;
      }

      try {
        const response = await fetch(`/api/public/ai-interview/${encodeURIComponent(token)}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers })
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          const message =
            error.error === 'session_already_completed'
              ? 'This interview has already been submitted.'
              : 'Unable to submit your interview. Please try again.';
          messageBox.textContent = message;
          messageBox.classList.remove('hidden');
          return;
        }

        clearDraft();
        renderMessage('Thank you!', 'Your interview responses have been submitted.');
      } catch (err) {
        console.error('Failed to submit interview', err);
        messageBox.textContent = 'Network error while submitting. Please try again.';
        messageBox.classList.remove('hidden');
      }
    });

    loadQuestion();
  }

  async function init() {
    if (!token) {
      renderMessage('Invalid link', 'This interview link appears to be missing.');
      return;
    }

    const session = await fetchSession();
    if (!session) return;

    if (session.status === 'completed') {
      renderMessage(
        'Interview already submitted',
        'Our team has already received your responses. Thank you!'
      );
      return;
    }

    renderForm(session);
  }

  init();
})();
