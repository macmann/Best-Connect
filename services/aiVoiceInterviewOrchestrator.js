const {
  SCORING_VERSION,
  RUBRIC_VERSION,
  inferCompetency,
  buildCoverageUpdate,
  scoreAnswer
} = require('./aiVoiceInterviewScoring');

const PROMPT_VERSION = process.env.PUBLIC_AI_VOICE_PROMPT_VERSION || 'voice-prompt-v1';
const CONTRACT_VERSION = 'orchestration-contract-v2';
const PHASES = ['intro', 'calibration', 'core', 'deep_dive', 'wrap_up'];

const THRESHOLDS = {
  lowTimeSec: Number(process.env.PUBLIC_AI_PHASE_LOW_TIME_SEC || 120),
  criticalTimeSec: Number(process.env.PUBLIC_AI_PHASE_CRITICAL_TIME_SEC || 45),
  calibrationMinAnswers: Number(process.env.PUBLIC_AI_PHASE_CALIBRATION_MIN_ANSWERS || 2),
  coreMinCompetencies: Number(process.env.PUBLIC_AI_PHASE_CORE_MIN_COMPETENCIES || 2),
  deepDiveMinCompetencies: Number(process.env.PUBLIC_AI_PHASE_DEEP_DIVE_MIN_COMPETENCIES || 3),
  deepDiveMinAverage: Number(process.env.PUBLIC_AI_PHASE_DEEP_DIVE_MIN_AVERAGE || 3),
  wrapUpFatigueSignals: Number(process.env.PUBLIC_AI_PHASE_WRAP_UP_FATIGUE_SIGNALS || 2),
  wrapUpNonAnswerStreak: Number(process.env.PUBLIC_AI_PHASE_WRAP_UP_NON_ANSWER_STREAK || 2)
};

function toDate(input) {
  if (!input) return null;
  const value = input instanceof Date ? input : new Date(input);
  return Number.isNaN(value.getTime()) ? null : value;
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}_must_be_object`);
  }
}

function normalizePhase(value) {
  return PHASES.includes(value) ? value : 'intro';
}

function normalizeContractInput(input = {}) {
  const timeRemainingSec = Number.isFinite(input.timeRemainingSec) ? Math.max(0, Math.round(input.timeRemainingSec)) : null;
  return {
    ...input,
    timeRemainingSec,
    transitionContext: input.transitionContext && typeof input.transitionContext === 'object' ? input.transitionContext : {}
  };
}

function buildInitialOrchestration(session) {
  const existing = session?.orchestration && typeof session.orchestration === 'object'
    ? session.orchestration
    : {};

  return {
    phase: normalizePhase(existing.phase),
    phaseHistory: Array.isArray(existing.phaseHistory) ? existing.phaseHistory : [],
    transitionReasons: Array.isArray(existing.transitionReasons) ? existing.transitionReasons : [],
    startedAt: existing.startedAt || session?.voice?.startedAt || session?.startedAt || null,
    endedAt: existing.endedAt || null,
    durationSec: Number.isFinite(existing.durationSec) ? existing.durationSec : null,
    promptVersion: existing.promptVersion || PROMPT_VERSION,
    rubricVersion: existing.rubricVersion || RUBRIC_VERSION,
    scoringVersion: existing.scoringVersion || SCORING_VERSION,
    contractVersion: existing.contractVersion || CONTRACT_VERSION,
    coverage: existing.coverage && typeof existing.coverage === 'object' ? existing.coverage : {},
    difficulty: existing.difficulty || 'medium',
    evidenceCandidates: Array.isArray(existing.evidenceCandidates) ? existing.evidenceCandidates : [],
    turnAssessments: Array.isArray(existing.turnAssessments) ? existing.turnAssessments : [],
    askedQuestionIds: Array.isArray(existing.askedQuestionIds) ? existing.askedQuestionIds : [],
    lastQuestionId: existing.lastQuestionId || null,
    fatigueSignals: Number.isFinite(existing.fatigueSignals) ? existing.fatigueSignals : 0,
    nonAnswerSignals: Number.isFinite(existing.nonAnswerSignals) ? existing.nonAnswerSignals : 0,
    nonAnswerStreak: Number.isFinite(existing.nonAnswerStreak) ? existing.nonAnswerStreak : 0,
    lastTransitionReason: existing.lastTransitionReason || null,
    lastTransitionAt: existing.lastTransitionAt || null
  };
}

function extractSignalFlags(answerText) {
  const text = typeof answerText === 'string' ? answerText.trim() : '';
  const wordCount = text ? text.split(/\s+/).length : 0;
  const isNonAnswer =
    wordCount <= 3 ||
    /\b(i\s*(do\s*not|don't)\s*know|not\s*sure|no\s*idea|pass|skip|next\s*question)\b/i.test(text);

  const isFatigued = /\b(tired|fatigue|fatigued|exhausted|drained|can\s*we\s*wrap|let'?s\s*finish|end\s*this)\b/i.test(text);

  return { isNonAnswer, isFatigued };
}

function coverageSummary(coverage = {}) {
  const competencies = Object.keys(coverage);
  const answered = competencies.filter(key => (coverage[key]?.answerCount || 0) > 0);
  const averageAcrossAnswered = answered.length
    ? answered.reduce((sum, key) => sum + Number(coverage[key]?.averageScore || 0), 0) / answered.length
    : 0;

  return {
    competencyCount: competencies.length,
    answeredCompetencyCount: answered.length,
    averageAcrossAnswered: Number(averageAcrossAnswered.toFixed(2))
  };
}

function phaseIndex(phase) {
  const index = PHASES.indexOf(phase);
  return index >= 0 ? index : 0;
}

function decideTargetPhase({ orchestration, timeRemainingSec }) {
  const summary = coverageSummary(orchestration.coverage);
  const totalAnswers = orchestration.turnAssessments.length;
  const reasons = [];

  if (Number.isFinite(timeRemainingSec) && timeRemainingSec <= THRESHOLDS.criticalTimeSec) {
    reasons.push('time_remaining_critical');
    return { phase: 'wrap_up', reasons };
  }

  if (Number.isFinite(timeRemainingSec) && timeRemainingSec <= THRESHOLDS.lowTimeSec) {
    reasons.push('time_remaining_low');
    return { phase: 'wrap_up', reasons };
  }

  if (
    orchestration.fatigueSignals >= THRESHOLDS.wrapUpFatigueSignals ||
    orchestration.nonAnswerStreak >= THRESHOLDS.wrapUpNonAnswerStreak
  ) {
    reasons.push('fatigue_or_non_answer_threshold_met');
    return { phase: 'wrap_up', reasons };
  }

  if (totalAnswers < 1) {
    reasons.push('opening_turns');
    return { phase: 'intro', reasons };
  }

  if (totalAnswers < THRESHOLDS.calibrationMinAnswers) {
    reasons.push('calibration_min_answers_not_met');
    return { phase: 'calibration', reasons };
  }

  if (
    summary.answeredCompetencyCount >= THRESHOLDS.deepDiveMinCompetencies &&
    summary.averageAcrossAnswered >= THRESHOLDS.deepDiveMinAverage
  ) {
    reasons.push('coverage_and_score_ready_for_deep_dive');
    return { phase: 'deep_dive', reasons };
  }

  if (summary.answeredCompetencyCount >= THRESHOLDS.coreMinCompetencies) {
    reasons.push('core_coverage_threshold_met');
    return { phase: 'core', reasons };
  }

  reasons.push('default_to_calibration');
  return { phase: 'calibration', reasons };
}

function applyPhaseTransition(orchestration, { timeRemainingSec, reasonSuffix = 'state_update' } = {}) {
  const { phase: targetPhase, reasons } = decideTargetPhase({ orchestration, timeRemainingSec });
  const currentIndex = phaseIndex(orchestration.phase);
  const targetIndex = phaseIndex(targetPhase);
  const nextPhase = targetIndex < currentIndex && targetPhase !== 'wrap_up' ? orchestration.phase : targetPhase;

  const didChange = nextPhase !== orchestration.phase;
  const transitionReason = `${reasons.join('|')}:${reasonSuffix}`;

  const updated = {
    ...orchestration,
    phase: nextPhase,
    lastTransitionReason: transitionReason,
    lastTransitionAt: new Date().toISOString()
  };

  if (!didChange) return updated;

  return {
    ...updated,
    phaseHistory: [...orchestration.phaseHistory, { from: orchestration.phase, to: nextPhase, reason: transitionReason, at: new Date().toISOString() }].slice(-30),
    transitionReasons: [...orchestration.transitionReasons, transitionReason].slice(-50)
  };
}

function score_answer(rawInput) {
  const input = normalizeContractInput(rawInput);
  assertObject(input, 'score_answer_input');
  assertObject(input.session, 'score_answer_session');
  assertObject(input.turn, 'score_answer_turn');

  const orchestration = buildInitialOrchestration(input.session);
  const questions = Array.isArray(input.session?.aiInterviewQuestions) ? input.session.aiInterviewQuestions : [];
  const askedCount = orchestration.turnAssessments.length;
  const currentQuestion = questions[askedCount] || null;
  const questionId = currentQuestion?.id || currentQuestion?.questionId || currentQuestion?._id?.toString?.() || null;
  const competency = inferCompetency(currentQuestion);
  const answerText = input.turn?.text || '';

  const assessment = scoreAnswer({
    answerText,
    competency,
    turnId: input.turn?.turnId || input.turn?.id || null,
    questionId,
    difficulty: orchestration.difficulty
  });

  const signalFlags = extractSignalFlags(answerText);
  const updatedCoverage = buildCoverageUpdate(orchestration.coverage, competency, assessment.score);
  const evidenceCandidates = assessment.evidenceCandidate?.quote
    ? [...orchestration.evidenceCandidates, assessment.evidenceCandidate].slice(-12)
    : orchestration.evidenceCandidates;

  const nextState = applyPhaseTransition({
    ...orchestration,
    coverage: updatedCoverage,
    difficulty: assessment.difficultyAfter,
    evidenceCandidates,
    turnAssessments: [...orchestration.turnAssessments, assessment],
    askedQuestionIds: questionId && !orchestration.askedQuestionIds.includes(questionId)
      ? [...orchestration.askedQuestionIds, questionId]
      : orchestration.askedQuestionIds,
    lastQuestionId: questionId || orchestration.lastQuestionId,
    fatigueSignals: orchestration.fatigueSignals + (signalFlags.isFatigued ? 1 : 0),
    nonAnswerSignals: orchestration.nonAnswerSignals + (signalFlags.isNonAnswer ? 1 : 0),
    nonAnswerStreak: signalFlags.isNonAnswer ? orchestration.nonAnswerStreak + 1 : 0,
    contractVersion: CONTRACT_VERSION
  }, {
    timeRemainingSec: input.timeRemainingSec,
    reasonSuffix: 'score_answer'
  });

  return {
    orchestration: nextState,
    signals: signalFlags,
    assessment,
    contract: {
      name: 'score_answer',
      version: CONTRACT_VERSION,
      input: {
        timeRemainingSec: input.timeRemainingSec,
        turnId: input.turn?.turnId || input.turn?.id || null,
        role: input.turn?.role || 'candidate'
      },
      output: {
        phase: nextState.phase,
        difficulty: nextState.difficulty,
        coverageCompetencies: Object.keys(nextState.coverage || {}),
        lastTransitionReason: nextState.lastTransitionReason
      }
    }
  };
}

function questionIdOf(question, index) {
  return question?.id || question?.questionId || question?._id?.toString?.() || `q${index + 1}`;
}

function pickQuestionForPhase({ phase, unansweredQuestions, coverage }) {
  if (!unansweredQuestions.length) return null;
  if (phase === 'intro' || phase === 'calibration' || phase === 'wrap_up') {
    return unansweredQuestions[0];
  }

  const questionsWithPriority = unansweredQuestions.map((entry) => {
    const competency = inferCompetency(entry.question);
    const competencyCoverage = coverage?.[competency] || {};
    const answerCount = Number(competencyCoverage.answerCount || 0);
    const averageScore = Number(competencyCoverage.averageScore || 0);
    const corePriority = answerCount;
    const deepDivePriority = averageScore > 0 ? averageScore : 999;

    return {
      ...entry,
      competency,
      corePriority,
      deepDivePriority,
      answerCount
    };
  });

  if (phase === 'core') {
    return questionsWithPriority
      .sort((a, b) => a.corePriority - b.corePriority || a.index - b.index)[0];
  }

  return questionsWithPriority
    .sort((a, b) => a.deepDivePriority - b.deepDivePriority || a.index - b.index)[0];
}

function next_question(rawInput) {
  const input = normalizeContractInput(rawInput);
  assertObject(input, 'next_question_input');
  assertObject(input.session, 'next_question_session');

  const orchestration = applyPhaseTransition(buildInitialOrchestration(input.session), {
    timeRemainingSec: input.timeRemainingSec,
    reasonSuffix: 'next_question'
  });

  const questions = Array.isArray(input.session?.aiInterviewQuestions) ? input.session.aiInterviewQuestions : [];
  const asked = new Set(orchestration.askedQuestionIds || []);
  const unansweredQuestions = questions
    .map((question, index) => ({ question, index, id: questionIdOf(question, index) }))
    .filter(entry => !asked.has(entry.id));

  const selected = pickQuestionForPhase({
    phase: orchestration.phase,
    unansweredQuestions,
    coverage: orchestration.coverage
  });

  if (!selected) {
    const wrapped = applyPhaseTransition({ ...orchestration, phase: 'wrap_up' }, {
      timeRemainingSec: input.timeRemainingSec,
      reasonSuffix: 'no_questions_remaining'
    });

    return {
      question: null,
      orchestration: wrapped,
      contract: {
        name: 'next_question',
        version: CONTRACT_VERSION,
        input: { timeRemainingSec: input.timeRemainingSec },
        output: {
          questionId: null,
          phase: wrapped.phase,
          transitionReason: wrapped.lastTransitionReason
        }
      }
    };
  }

  const competency = inferCompetency(selected.question);
  const questionId = selected.id;

  return {
    question: {
      id: questionId,
      text: selected.question?.text || selected.question?.question || '',
      competency
    },
    orchestration: {
      ...orchestration,
      lastQuestionId: questionId || orchestration.lastQuestionId,
      contractVersion: CONTRACT_VERSION
    },
    contract: {
      name: 'next_question',
      version: CONTRACT_VERSION,
      input: {
        timeRemainingSec: input.timeRemainingSec,
        currentPhase: orchestration.phase
      },
      output: {
        questionId,
        competency,
        phase: orchestration.phase,
        transitionReason: orchestration.lastTransitionReason
      }
    }
  };
}

function finalizeOrchestration({ session, endedAt }) {
  const orchestration = buildInitialOrchestration(session);
  const startedAt = toDate(orchestration.startedAt || session?.voice?.startedAt || session?.startedAt);
  const ended = toDate(endedAt) || new Date();
  const durationSec = startedAt
    ? Math.max(0, Math.round((ended.getTime() - startedAt.getTime()) / 1000))
    : 0;

  return {
    ...orchestration,
    phase: 'wrap_up',
    startedAt: startedAt || ended,
    endedAt: ended,
    durationSec
  };
}

module.exports = {
  score_answer,
  next_question,
  buildInitialOrchestration,
  finalizeOrchestration
};
