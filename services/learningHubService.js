const COURSE_STATUSES = new Set(['draft', 'published', 'archived']);
const EXTERNAL_ASSET_PROVIDERS = new Set(['onedrive', 'youtube']);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeProvider(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeBoolean(value) {
  return value === true || value === 'true';
}

function normalizeCourseStatus(value) {
  const normalized = normalizeString(value).toLowerCase();
  return COURSE_STATUSES.has(normalized) ? normalized : '';
}

function parseYouTubeVideoId(value) {
  const input = normalizeString(value);
  if (!input) return '';

  try {
    const parsed = new URL(input);
    if (parsed.hostname.includes('youtu.be')) {
      return normalizeString(parsed.pathname.split('/').filter(Boolean)[0]);
    }
    if (parsed.hostname.includes('youtube.com')) {
      const videoId = parsed.searchParams.get('v');
      if (videoId) return normalizeString(videoId);
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      const embedIndex = pathParts.indexOf('embed');
      if (embedIndex !== -1 && pathParts[embedIndex + 1]) {
        return normalizeString(pathParts[embedIndex + 1]);
      }
    }
  } catch (error) {
    if (/^[\w-]{11}$/.test(input)) {
      return input;
    }
  }

  return '';
}

function buildAssetMetadata(payload = {}, { url, provider } = {}) {
  const oneDrive = payload.oneDrive && typeof payload.oneDrive === 'object'
    ? {
        driveId: normalizeString(payload.oneDrive.driveId),
        itemId: normalizeString(payload.oneDrive.itemId),
        shareId: normalizeString(payload.oneDrive.shareId),
        webUrl: normalizeString(payload.oneDrive.webUrl)
      }
    : null;
  const youtube = payload.youtube && typeof payload.youtube === 'object'
    ? {
        videoId: normalizeString(payload.youtube.videoId)
      }
    : null;
  const normalizedProvider = normalizeProvider(provider);
  const normalizedUrl = normalizeString(url);

  if (normalizedProvider === 'youtube' && normalizedUrl) {
    const videoId = parseYouTubeVideoId(normalizedUrl);
    if (videoId && (!youtube || !youtube.videoId)) {
      if (youtube) {
        youtube.videoId = videoId;
      } else {
        payload.youtube = { videoId };
      }
    }
  }

  if (normalizedProvider === 'onedrive' && normalizedUrl) {
    if (oneDrive) {
      if (!oneDrive.webUrl) {
        oneDrive.webUrl = normalizedUrl;
      }
    } else {
      payload.oneDrive = { webUrl: normalizedUrl };
    }
  }

  return {
    oneDrive: payload.oneDrive && typeof payload.oneDrive === 'object'
      ? {
          driveId: normalizeString(payload.oneDrive.driveId),
          itemId: normalizeString(payload.oneDrive.itemId),
          shareId: normalizeString(payload.oneDrive.shareId),
          webUrl: normalizeString(payload.oneDrive.webUrl)
        }
      : null,
    youtube: payload.youtube && typeof payload.youtube === 'object'
      ? {
          videoId: normalizeString(payload.youtube.videoId)
        }
      : null,
    mimeType: normalizeString(payload.mimeType),
    fileName: normalizeString(payload.fileName),
    fileSize: Number.isFinite(Number(payload.fileSize)) ? Number(payload.fileSize) : null,
    durationSeconds: Number.isFinite(Number(payload.durationSeconds))
      ? Number(payload.durationSeconds)
      : null,
    thumbnailUrl: normalizeString(payload.thumbnailUrl)
  };
}

function buildCourse(payload = {}, { userId } = {}) {
  const title = normalizeString(payload.title);
  if (!title) {
    return { error: 'title_required' };
  }

  const status = normalizeCourseStatus(payload.status) || 'draft';
  const now = new Date();
  const course = {
    title,
    summary: normalizeString(payload.summary),
    description: normalizeString(payload.description),
    status,
    createdAt: now,
    updatedAt: now,
    publishedAt: status === 'published' ? now : null,
    archivedAt: status === 'archived' ? now : null
  };

  if (userId) {
    course.createdBy = userId;
  }

  return { course };
}

function buildModule(payload = {}) {
  const title = normalizeString(payload.title);
  if (!title) {
    return { error: 'title_required' };
  }
  if (!payload.courseId) {
    return { error: 'course_id_required' };
  }

  const now = new Date();
  return {
    module: {
      courseId: String(payload.courseId),
      title,
      description: normalizeString(payload.description),
      order: Number.isFinite(Number(payload.order)) ? Number(payload.order) : 0,
      required: normalizeBoolean(payload.required),
      createdAt: now,
      updatedAt: now
    }
  };
}

function buildLesson(payload = {}) {
  const title = normalizeString(payload.title);
  if (!title) {
    return { error: 'title_required' };
  }
  if (!payload.moduleId) {
    return { error: 'module_id_required' };
  }

  const now = new Date();
  return {
    lesson: {
      moduleId: String(payload.moduleId),
      title,
      description: normalizeString(payload.description),
      order: Number.isFinite(Number(payload.order)) ? Number(payload.order) : 0,
      durationMinutes: Number.isFinite(Number(payload.durationMinutes))
        ? Number(payload.durationMinutes)
        : null,
      required: normalizeBoolean(payload.required),
      createdAt: now,
      updatedAt: now
    }
  };
}

function buildLessonAsset(payload = {}) {
  const lessonId = payload.lessonId;
  const provider = normalizeString(payload.provider);
  const normalizedProvider = normalizeProvider(provider);
  const url = normalizeString(payload.url);
  const isExternalProvider = EXTERNAL_ASSET_PROVIDERS.has(normalizedProvider);

  if (!lessonId) {
    return { error: 'lesson_id_required' };
  }
  if (!provider) {
    return { error: 'provider_required' };
  }
  if (!url && !isExternalProvider) {
    return { error: 'url_required' };
  }

  const now = new Date();
  return {
    asset: {
      lessonId: String(lessonId),
      provider,
      url: isExternalProvider ? null : url,
      title: normalizeString(payload.title),
      description: normalizeString(payload.description),
      required: normalizeBoolean(payload.required),
      metadata: buildAssetMetadata(payload, { url, provider }),
      createdAt: now,
      updatedAt: now
    }
  };
}

function buildCourseAssignments(payload = {}, { assignedBy } = {}) {
  const courseId = payload.courseId;
  if (!courseId) {
    return { error: 'course_id_required' };
  }

  const roles = Array.isArray(payload.roles)
    ? payload.roles.map(role => normalizeString(role)).filter(Boolean)
    : [];
  const employeeIds = Array.isArray(payload.employeeIds)
    ? payload.employeeIds.map(id => normalizeString(id)).filter(Boolean)
    : [];

  if (!roles.length && !employeeIds.length) {
    return { error: 'assignment_targets_required' };
  }

  const required = normalizeBoolean(payload.required);
  const dueDate = payload.dueDate ? new Date(payload.dueDate) : null;
  const now = new Date();

  const assignments = [
    ...roles.map(role => ({
      courseId: String(courseId),
      assignmentType: 'role',
      role,
      employeeId: null,
      required,
      dueDate,
      assignedAt: now,
      assignedBy: assignedBy || null
    })),
    ...employeeIds.map(employeeId => ({
      courseId: String(courseId),
      assignmentType: 'employee',
      role: null,
      employeeId,
      required,
      dueDate,
      assignedAt: now,
      assignedBy: assignedBy || null
    }))
  ];

  return { assignments };
}

function buildProgressEntry(payload = {}) {
  if (!payload.employeeId) {
    return { error: 'employee_id_required' };
  }
  if (!payload.courseId) {
    return { error: 'course_id_required' };
  }

  const progressType = normalizeString(payload.progressType) || 'course';
  const status = normalizeString(payload.status) || 'not_started';
  const now = new Date();

  return {
    progress: {
      employeeId: String(payload.employeeId),
      courseId: String(payload.courseId),
      moduleId: payload.moduleId ? String(payload.moduleId) : null,
      lessonId: payload.lessonId ? String(payload.lessonId) : null,
      progressType,
      status,
      startedAt: payload.startedAt ? new Date(payload.startedAt) : null,
      completedAt: payload.completedAt ? new Date(payload.completedAt) : null,
      updatedAt: now
    }
  };
}

function applyCourseUpdates(payload = {}) {
  const updates = {};

  if (Object.prototype.hasOwnProperty.call(payload, 'title')) {
    const title = normalizeString(payload.title);
    if (!title) {
      return { error: 'title_required' };
    }
    updates.title = title;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'summary')) {
    updates.summary = normalizeString(payload.summary);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'description')) {
    updates.description = normalizeString(payload.description);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
    const status = normalizeCourseStatus(payload.status);
    if (!status) {
      return { error: 'invalid_status' };
    }
    updates.status = status;
  }

  if (!Object.keys(updates).length) {
    return { error: 'no_fields_to_update' };
  }

  updates.updatedAt = new Date();
  return { updates };
}

function applyModuleUpdates(payload = {}) {
  const updates = {};

  if (Object.prototype.hasOwnProperty.call(payload, 'title')) {
    const title = normalizeString(payload.title);
    if (!title) {
      return { error: 'title_required' };
    }
    updates.title = title;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'description')) {
    updates.description = normalizeString(payload.description);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'order')) {
    updates.order = Number.isFinite(Number(payload.order)) ? Number(payload.order) : 0;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'required')) {
    updates.required = normalizeBoolean(payload.required);
  }

  if (!Object.keys(updates).length) {
    return { error: 'no_fields_to_update' };
  }

  updates.updatedAt = new Date();
  return { updates };
}

function applyLessonUpdates(payload = {}) {
  const updates = {};

  if (Object.prototype.hasOwnProperty.call(payload, 'title')) {
    const title = normalizeString(payload.title);
    if (!title) {
      return { error: 'title_required' };
    }
    updates.title = title;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'description')) {
    updates.description = normalizeString(payload.description);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'order')) {
    updates.order = Number.isFinite(Number(payload.order)) ? Number(payload.order) : 0;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'required')) {
    updates.required = normalizeBoolean(payload.required);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'durationMinutes')) {
    updates.durationMinutes = Number.isFinite(Number(payload.durationMinutes))
      ? Number(payload.durationMinutes)
      : null;
  }

  if (!Object.keys(updates).length) {
    return { error: 'no_fields_to_update' };
  }

  updates.updatedAt = new Date();
  return { updates };
}

function applyAssetUpdates(payload = {}) {
  const updates = {};
  const provider = Object.prototype.hasOwnProperty.call(payload, 'provider')
    ? normalizeString(payload.provider)
    : '';
  const normalizedProvider = normalizeProvider(provider);
  const isExternalProvider = EXTERNAL_ASSET_PROVIDERS.has(normalizedProvider);
  const url = Object.prototype.hasOwnProperty.call(payload, 'url')
    ? normalizeString(payload.url)
    : '';

  if (Object.prototype.hasOwnProperty.call(payload, 'provider')) {
    if (!provider) {
      return { error: 'provider_required' };
    }
    updates.provider = provider;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'url')) {
    if (!url && !isExternalProvider) {
      return { error: 'url_required' };
    }
    if (!isExternalProvider) {
      updates.url = url;
    } else if (!updates.provider) {
      updates.url = null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'title')) {
    updates.title = normalizeString(payload.title);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'description')) {
    updates.description = normalizeString(payload.description);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'required')) {
    updates.required = normalizeBoolean(payload.required);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'oneDrive')
    || Object.prototype.hasOwnProperty.call(payload, 'youtube')
    || Object.prototype.hasOwnProperty.call(payload, 'mimeType')
    || Object.prototype.hasOwnProperty.call(payload, 'fileName')
    || Object.prototype.hasOwnProperty.call(payload, 'fileSize')
    || Object.prototype.hasOwnProperty.call(payload, 'durationSeconds')
    || Object.prototype.hasOwnProperty.call(payload, 'thumbnailUrl')
    || (isExternalProvider && Object.prototype.hasOwnProperty.call(payload, 'url'))) {
    updates.metadata = buildAssetMetadata(payload, { url, provider });
  }

  if (!Object.keys(updates).length) {
    return { error: 'no_fields_to_update' };
  }

  updates.updatedAt = new Date();
  return { updates };
}

module.exports = {
  normalizeCourseStatus,
  buildCourse,
  buildModule,
  buildLesson,
  buildLessonAsset,
  buildCourseAssignments,
  buildProgressEntry,
  applyCourseUpdates,
  applyModuleUpdates,
  applyLessonUpdates,
  applyAssetUpdates
};
