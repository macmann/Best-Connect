const express = require('express');
const { ObjectId } = require('mongodb');
const { getDatabase } = require('../db');
const { generateInterviewToken } = require('../utils/token');

const router = express.Router();

const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || process.env.APP_BASE_URL || '';

function buildCandidateName(candidate) {
  if (!candidate) return null;
  const parts = [];
  if (candidate.firstName) parts.push(candidate.firstName);
  if (candidate.lastName) parts.push(candidate.lastName);
  const combined = parts.join(' ').trim();
  if (combined) return combined;
  return candidate.fullName || candidate.name || candidate.email || null;
}

function buildInterviewUrl(req, interviewPath) {
  if (!interviewPath) return '';
  const base =
    PUBLIC_APP_URL || req.get('origin') || `${req.protocol}://${req.get('host')}`;
  try {
    return new URL(interviewPath, base).toString();
  } catch (err) {
    return interviewPath;
  }
}

// TODO: apply auth middleware if available

router.get('/ai-interview/application/:applicationId', async (req, res) => {
  try {
    const db = getDatabase();
    const { applicationId } = req.params;

    let appId;
    try {
      appId = new ObjectId(applicationId);
    } catch (e) {
      return res.status(400).json({ error: 'invalid_application_id' });
    }

    const session = await db
      .collection('ai_interview_sessions')
      .findOne({ applicationId: appId }, { sort: { createdAt: -1 } });

    if (!session) {
      return res.json({ hasSession: false });
    }

    let result = null;
    if (session.aiResultId) {
      result = await db.collection('ai_interview_results').findOne({ _id: session.aiResultId });
    }

    return res.json({
      hasSession: true,
      session: {
        id: session._id,
        status: session.status,
        createdAt: session.createdAt,
        completedAt: session.completedAt
      },
      result: result
        ? {
            scores: result.scores,
            verdict: result.verdict,
            summary: result.summary,
            strengths: result.strengths,
            risks: result.risks,
            recommendedNextSteps: result.recommendedNextSteps,
            createdAt: result.createdAt
          }
        : null
    });
  } catch (err) {
    console.error('Error fetching AI interview info for application:', err);
    return res.status(500).json({ error: 'failed_to_fetch_ai_interview_info' });
  }
});

// POST /api/hr/ai-interview/sessions
// Body: { applicationId: "<id>" }
router.post('/ai-interview/sessions', async (req, res) => {
  try {
    const db = getDatabase();
    const { applicationId } = req.body;

    if (!applicationId) {
      return res.status(400).json({ error: 'applicationId_required' });
    }

    let application;
    try {
      application = await db.collection('applications').findOne({ _id: new ObjectId(applicationId) });
    } catch (e) {
      return res.status(400).json({ error: 'invalid_application_id' });
    }

    if (!application) {
      return res.status(404).json({ error: 'application_not_found' });
    }

    const candidateId = application.candidateId;
    const positionId = application.positionId;

    if (!candidateId || !positionId) {
      return res.status(400).json({ error: 'application_missing_candidate_or_position' });
    }

    const candidate = await db.collection('candidates').findOne({ _id: new ObjectId(candidateId) });
    const position = await db.collection('positions').findOne({ _id: new ObjectId(positionId) });

    if (!candidate || !position) {
      return res.status(404).json({ error: 'candidate_or_position_not_found' });
    }

    const questions = Array.isArray(position.aiInterviewQuestions)
      ? position.aiInterviewQuestions
      : [];

    if (!questions.length) {
      return res.status(400).json({ error: 'no_ai_questions_defined_for_position' });
    }

    const token = generateInterviewToken();
    const sessionDoc = {
      token,
      applicationId: application._id,
      candidateId: candidate._id,
      positionId: position._id,
      status: 'sent',
      templateTitle: position.title || 'AI Interview',
      aiInterviewQuestions: questions,
      answers: [],
      startedAt: null,
      completedAt: null,
      aiResultId: null,
      createdAt: new Date()
    };

    const result = await db.collection('ai_interview_sessions').insertOne(sessionDoc);

    const interviewPath = `/ai-interview/${token}`;
    const interviewUrl = buildInterviewUrl(req, interviewPath);

    const sendEmail = req.app?.locals?.sendEmail;
    let emailSent = false;
    if (candidate.email && typeof sendEmail === 'function') {
      const candidateName = buildCandidateName(candidate) || 'there';
      const positionTitle = position.title || 'the position';
      const emailLines = [
        `Hi ${candidateName},`,
        '',
        `You have been invited to complete an AI interview for ${positionTitle}.`,
        `Start your interview here: ${interviewUrl || interviewPath}`,
        '',
        'Please complete the interview at your earliest convenience.'
      ];
      try {
        await sendEmail(
          candidate.email,
          `Your AI interview for ${positionTitle}`,
          emailLines.join('\n')
        );
        emailSent = true;
      } catch (err) {
        console.error('Failed to send AI interview invitation email:', err);
      }
    }

    return res.status(201).json({
      sessionId: result.insertedId,
      interviewPath,
      interviewUrl,
      token,
      candidateEmail: candidate.email,
      emailSent
    });
  } catch (err) {
    console.error('Error creating AI interview session:', err);
    return res.status(500).json({ error: 'failed_to_create_session' });
  }
});

module.exports = router;
