import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { findSessionUser, publicUser, requireSession } from './auth-routes.js';
import { createShareCode, normalizeBodyType, normalizeShareCode, validateProjectCreate, validateProjectUpdate } from './project-utils.js';

const PROJECT_BODY_LIMIT = 2 * 1024 * 1024;

// Summary columns shared by every listing. `p` is the projects alias.
const SUMMARY_COLUMNS = `p.id, p.source_project_id, p.name, p.description, p.visibility, p.share_code, p.body_type,
  JSON_UNQUOTE(JSON_EXTRACT(p.project_data, '$.metadata.communityIcon')) AS community_icon,
  p.thumbnail_updated_at, p.content_revision, p.created_at, p.updated_at`;
const AUTHOR_COLUMNS = `u.id AS user_id, u.username, u.display_name, u.website_url,
  u.avatar_updated_at, u.created_at AS user_created_at`;

const projectSummary = (row) => ({
  id: row.id,
  sourceProjectId: row.source_project_id ?? null,
  name: row.name,
  description: row.description ?? null,
  visibility: row.visibility,
  shareCode: row.share_code,
  bodyType: row.body_type ?? 'planet',
  communityIcon: row.community_icon ?? null,
  thumbnailUpdatedAt: row.thumbnail_updated_at ?? null,
  contentRevision: Number(row.content_revision ?? 1),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// Authors are shown to anyone: never include the account email or settings.
const projectAuthor = (row) => {
  const { id, username, displayName, websiteUrl, avatarUpdatedAt, createdAt } = publicUser({
    ...row, id: row.user_id, created_at: row.user_created_at,
  });
  return { id, username, displayName, websiteUrl, avatarUpdatedAt, createdAt };
};

function validationReply(reply, errors) {
  return reply.code(400).send({
    error: { code: 'VALIDATION_ERROR', message: 'Check the highlighted fields.', fields: errors },
  });
}

function notFound(reply) {
  return reply.code(404).send({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' } });
}

function parseProjectData(row) {
  try { return JSON.parse(row.project_data); }
  catch { return null; }
}

const projectIdParam = (request) => String(request.params.projectId ?? '').slice(0, 36);

async function ownedSummary(projectId, userId) {
  const [[row]] = await db.execute(
    `SELECT ${SUMMARY_COLUMNS} FROM projects p WHERE p.id = ? AND p.user_id = ? LIMIT 1`,
    [projectId, userId],
  );
  return row ?? null;
}

async function insertWithShareCode(value, userId, projectId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const shareCode = createShareCode();
    try {
      await db.execute(
        `INSERT INTO projects
           (id, user_id, source_project_id, name, description, visibility, body_type, share_code, project_data,
            thumbnail_mime, thumbnail_data, thumbnail_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${value.thumbnail ? 'UTC_TIMESTAMP(3)' : 'NULL'})`,
        [
          projectId, userId, value.sourceProjectId, value.name, value.description, value.visibility,
          value.bodyType, shareCode, value.projectData,
          value.thumbnail?.mimeType ?? null, value.thumbnail?.data ?? null,
        ],
      );
      return shareCode;
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
      if (String(error.message).includes('uq_projects_user_source')) throw error;
    }
  }
  throw new Error('Could not allocate a unique share code');
}

export async function registerProjectRoutes(app) {
  app.get('/api/v1/me/projects', async (request, reply) => {
    const user = await requireSession(request, reply);
    if (!user) return;
    const [rows] = await db.execute(
      `SELECT ${SUMMARY_COLUMNS} FROM projects p WHERE p.user_id = ? ORDER BY p.updated_at DESC`,
      [user.id],
    );
    reply.header('Cache-Control', 'no-store');
    return { projects: rows.map(projectSummary) };
  });

  app.post('/api/v1/me/projects', {
    bodyLimit: PROJECT_BODY_LIMIT,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = await requireSession(request, reply);
    if (!user) return;
    const result = validateProjectCreate(request.body, user.default_project_visibility);
    if (!result.ok) return validationReply(reply, result.errors);
    const projectId = randomUUID();
    try {
      await insertWithShareCode(result.value, user.id, projectId);
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        return reply.code(409).send({ error: { code: 'PROJECT_ALREADY_SYNCED', message: 'This local project is already synced.' } });
      }
      throw error;
    }
    reply.header('Cache-Control', 'no-store');
    return reply.code(201).send({ project: projectSummary(await ownedSummary(projectId, user.id)) });
  });

  app.get('/api/v1/me/projects/:projectId', async (request, reply) => {
    const user = await requireSession(request, reply);
    if (!user) return;
    const [[row]] = await db.execute(
      `SELECT ${SUMMARY_COLUMNS}, p.project_data FROM projects p WHERE p.id = ? AND p.user_id = ? LIMIT 1`,
      [projectIdParam(request), user.id],
    );
    if (!row) return notFound(reply);
    const projectData = parseProjectData(row);
    if (!projectData) throw new Error(`Project ${row.id} contains invalid JSON`);
    reply.header('Cache-Control', 'no-store');
    return { project: { ...projectSummary(row), data: projectData } };
  });

  app.patch('/api/v1/me/projects/:projectId', {
    bodyLimit: PROJECT_BODY_LIMIT,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = await requireSession(request, reply);
    if (!user) return;
    const result = validateProjectUpdate(request.body);
    if (!result.ok) return validationReply(reply, result.errors);
    const projectId = projectIdParam(request);
    const nextUpdate = { ...result.value };
    // The community icon lives in the document metadata, so it is merged into
    // whichever project JSON this update ends up writing.
    if (Object.hasOwn(nextUpdate, 'communityIcon')) {
      let projectData;
      if (Object.hasOwn(nextUpdate, 'projectData')) {
        projectData = JSON.parse(nextUpdate.projectData);
      } else {
        const [[currentRow]] = await db.execute(
          'SELECT project_data FROM projects WHERE id = ? AND user_id = ? LIMIT 1',
          [projectId, user.id],
        );
        if (!currentRow) return notFound(reply);
        projectData = parseProjectData(currentRow);
      }
      if (!projectData || typeof projectData !== 'object' || Array.isArray(projectData)) {
        throw new Error('Project contains invalid JSON');
      }
      projectData.metadata = { ...(projectData.metadata ?? {}), communityIcon: nextUpdate.communityIcon };
      nextUpdate.projectData = JSON.stringify(projectData);
      delete nextUpdate.communityIcon;
    }
    const columns = {
      name: 'name', description: 'description', visibility: 'visibility', projectData: 'project_data', bodyType: 'body_type',
    };
    const entries = Object.entries(nextUpdate);
    const assignments = entries.map(([key]) => `${columns[key]} = ?`);
    const values = entries.map(([, value]) => value);
    if (Object.hasOwn(nextUpdate, 'projectData')) assignments.push('content_revision = content_revision + 1');
    if (result.thumbnail === null) {
      assignments.push('thumbnail_mime = NULL', 'thumbnail_data = NULL', 'thumbnail_updated_at = NULL');
    } else if (result.thumbnail) {
      assignments.push('thumbnail_mime = ?', 'thumbnail_data = ?', 'thumbnail_updated_at = UTC_TIMESTAMP(3)');
      values.push(result.thumbnail.mimeType, result.thumbnail.data);
    }
    const expectedClause = result.expectedContentRevision == null ? '' : ' AND content_revision = ?';
    values.push(projectId, user.id);
    if (result.expectedContentRevision != null) values.push(result.expectedContentRevision);
    const [updateResult] = await db.execute(
      `UPDATE projects SET ${assignments.join(', ')} WHERE id = ? AND user_id = ?${expectedClause}`,
      values,
    );
    if (!updateResult.affectedRows) {
      if (result.expectedContentRevision != null && await ownedSummary(projectId, user.id)) {
        return reply.code(409).send({ error: { code: 'PROJECT_SYNC_CONFLICT', message: 'The cloud copy changed before it could be synced.' } });
      }
      return notFound(reply);
    }
    reply.header('Cache-Control', 'no-store');
    return { project: projectSummary(await ownedSummary(projectId, user.id)) };
  });

  app.delete('/api/v1/me/projects/:projectId', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = await requireSession(request, reply);
    if (!user) return;
    const [result] = await db.execute(
      'DELETE FROM projects WHERE id = ? AND user_id = ?',
      [projectIdParam(request), user.id],
    );
    if (!result.affectedRows) return notFound(reply);
    reply.header('Cache-Control', 'no-store');
    return reply.code(204).send();
  });

  app.post('/api/v1/me/projects/:projectId/share-code', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const user = await requireSession(request, reply);
    if (!user) return;
    const projectId = projectIdParam(request);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const shareCode = createShareCode();
      try {
        const [result] = await db.execute(
          'UPDATE projects SET share_code = ? WHERE id = ? AND user_id = ?',
          [shareCode, projectId, user.id],
        );
        if (!result.affectedRows) return notFound(reply);
        reply.header('Cache-Control', 'no-store');
        return { shareCode };
      } catch (error) {
        if (error?.code !== 'ER_DUP_ENTRY') throw error;
      }
    }
    throw new Error('Could not allocate a unique share code');
  });

  // Thumbnails of shared (unlisted / public) projects are readable by anyone
  // holding the id; private thumbnails only by their owner.
  app.get('/api/v1/projects/:projectId/thumbnail', {
    config: { rateLimit: { max: 240, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const [[row]] = await db.execute(
      `SELECT p.user_id, p.visibility, p.thumbnail_mime, p.thumbnail_data
         FROM projects p JOIN users u ON u.id = p.user_id
        WHERE p.id = ? AND u.status = 'active' AND u.deleted_at IS NULL
        LIMIT 1`,
      [projectIdParam(request)],
    );
    let visible = row && row.visibility !== 'private';
    if (row && !visible) visible = (await findSessionUser(request, { touch: false }))?.id === row.user_id;
    if (!visible || !row.thumbnail_data || !row.thumbnail_mime) {
      return reply.code(404).send({ error: { code: 'THUMBNAIL_NOT_FOUND', message: 'Thumbnail not found.' } });
    }
    reply.header('Content-Type', row.thumbnail_mime);
    // URLs carry ?v=<thumbnailUpdatedAt>, so a new render is a new URL.
    reply.header('Cache-Control', row.visibility === 'private' ? 'private, max-age=31536000, immutable' : 'public, max-age=31536000, immutable');
    return reply.send(row.thumbnail_data);
  });

  app.get('/api/v1/community/projects', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const search = String(request.query?.q ?? '').trim().slice(0, 120);
    const type = normalizeBodyType(request.query?.type) ?? '';
    const page = Math.min(10_000, Math.max(1, Number.parseInt(request.query?.page ?? '1', 10) || 1));
    const limit = 24;
    const offset = (page - 1) * limit;
    const filterParts = [];
    const values = [];
    if (search) {
      const normalizedCode = search.toUpperCase().replace(/[\s-]+/g, '');
      filterParts.push('(p.name LIKE ? OR p.description LIKE ? OR u.username LIKE ? OR UPPER(p.share_code) LIKE ?)');
      values.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${normalizedCode}%`);
    }
    if (type) {
      filterParts.push('p.body_type = ?');
      values.push(type);
    }
    const filter = filterParts.length ? `AND ${filterParts.join(' AND ')}` : '';
    const [[countRow]] = await db.execute(
      `SELECT COUNT(*) AS total
         FROM projects p JOIN users u ON u.id = p.user_id
        WHERE p.visibility = 'public' AND u.status = 'active' AND u.deleted_at IS NULL ${filter}`,
      values,
    );
    const [rows] = await db.execute(
      `SELECT ${SUMMARY_COLUMNS}, ${AUTHOR_COLUMNS}
         FROM projects p JOIN users u ON u.id = p.user_id
        WHERE p.visibility = 'public' AND u.status = 'active' AND u.deleted_at IS NULL ${filter}
        ORDER BY p.updated_at DESC
        LIMIT ${limit} OFFSET ${offset}`,
      values,
    );
    reply.header('Cache-Control', 'public, max-age=30');
    return {
      projects: rows.map((row) => ({ ...projectSummary(row), author: projectAuthor(row) })),
      page,
      total: Number(countRow.total),
      pages: Math.ceil(Number(countRow.total) / limit),
    };
  });

  app.get('/api/v1/projects/shared/:shareCode', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const shareCode = normalizeShareCode(request.params.shareCode);
    if (!shareCode) return notFound(reply);
    const [[row]] = await db.execute(
      `SELECT ${SUMMARY_COLUMNS}, p.project_data, ${AUTHOR_COLUMNS}
         FROM projects p JOIN users u ON u.id = p.user_id
        WHERE p.share_code = ? AND p.visibility IN ('unlisted', 'public')
          AND u.status = 'active' AND u.deleted_at IS NULL
        LIMIT 1`,
      [shareCode],
    );
    if (!row) return notFound(reply);
    const projectData = parseProjectData(row);
    if (!projectData) throw new Error(`Project ${row.id} contains invalid JSON`);
    reply.header('Cache-Control', row.visibility === 'public' ? 'public, max-age=30' : 'no-store');
    return { project: { ...projectSummary(row), author: projectAuthor(row), data: projectData } };
  });
}
