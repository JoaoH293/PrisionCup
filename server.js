const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'troque-esta-chave-em-producao-copa-presidio';
const DB_PATH = path.join(__dirname, 'database', 'copa_presidio.sqlite');
const SCHEMA_PATH = path.join(__dirname, 'database', 'schema.sql');
const DEFAULT_ADMIN_ACCESS_CODE = '132217';
const DEFAULT_ADMIN_PASSWORD = 'EtecADM2002';

app.use(cors());
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));

if (!fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function initDatabase() {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  await new Promise((resolve, reject) => {
    db.exec(schema, (err) => (err ? reject(err) : resolve()));
  });

  const columns = await all('PRAGMA table_info(admins)');
  const hasAccessCode = columns.some((column) => column.name === 'access_code');
  const hasEmail = columns.some((column) => column.name === 'email');

  if (!hasAccessCode) {
    await run('ALTER TABLE admins ADD COLUMN access_code TEXT');
    await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_access_code ON admins(access_code)');
  }

  const hash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
  const admin = await get('SELECT id FROM admins WHERE access_code = ?', [DEFAULT_ADMIN_ACCESS_CODE]);

  if (admin) {
    await run('UPDATE admins SET name = ?, password_hash = ? WHERE id = ?', ['Administrador', hash, admin.id]);
  } else if (hasEmail) {
    await run('INSERT INTO admins (name, email, access_code, password_hash) VALUES (?, ?, ?, ?)', [
      'Administrador',
      `${DEFAULT_ADMIN_ACCESS_CODE}@copa-presidio.local`,
      DEFAULT_ADMIN_ACCESS_CODE,
      hash,
    ]);
  } else {
    await run('INSERT INTO admins (name, access_code, password_hash) VALUES (?, ?, ?)', [
      'Administrador',
      DEFAULT_ADMIN_ACCESS_CODE,
      hash,
    ]);
  }
}

function playerToken(player) {
  return jwt.sign({ type: 'player', id: player.id }, JWT_SECRET, { expiresIn: '7d' });
}

function adminToken(admin) {
  return jwt.sign({ type: 'admin', id: admin.id }, JWT_SECRET, { expiresIn: '7d' });
}

function removeSensitivePlayerFields(player) {
  if (!player) return player;
  const { password_hash, ...safe } = player;
  return safe;
}

function requireAuth(type) {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;
      if (!token) return res.status(401).json({ error: 'Faça login para continuar.' });

      const payload = jwt.verify(token, JWT_SECRET);
      if (type && payload.type !== type) return res.status(403).json({ error: 'Acesso negado.' });

      if (payload.type === 'player') {
        const player = await get('SELECT * FROM players WHERE id = ?', [payload.id]);
        if (!player || player.is_blocked) return res.status(403).json({ error: 'Conta bloqueada ou inexistente.' });
        req.player = player;
      }

      if (payload.type === 'admin') {
        const admin = await get('SELECT * FROM admins WHERE id = ?', [payload.id]);
        if (!admin) return res.status(403).json({ error: 'Administrador inexistente.' });
        req.admin = admin;
      }

      next();
    } catch (error) {
      return res.status(401).json({ error: 'Sessão inválida. Entre novamente.' });
    }
  };
}

async function generateAccessNumber() {
  const row = await get("SELECT MAX(CAST(access_number AS INTEGER)) as maxNumber FROM players");
  const next = Number(row?.maxNumber || 0) + 1;
  return String(next).padStart(3, '0');
}

async function generateTeamCode(prefix = 'CP') {
  for (let i = 0; i < 25; i++) {
    const code = `${prefix}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const existing = await get('SELECT id FROM teams WHERE access_code = ?', [code]);
    if (!existing) return code;
  }
  return `${prefix}-${Date.now().toString().slice(-6)}`;
}

function requireFields(body, fields) {
  for (const field of fields) {
    if (body[field] === undefined || body[field] === null || String(body[field]).trim() === '') {
      return field;
    }
  }
  return null;
}

async function calculateStandings() {
  const teams = await all('SELECT * FROM teams ORDER BY name ASC');
  const finished = await all("SELECT * FROM matches WHERE status = 'finalizada'");
  const table = new Map();

  teams.forEach((team) => {
    table.set(team.id, {
      team_id: team.id,
      name: team.name,
      logo: team.logo,
      points: 0,
      games: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goals_for: 0,
      goals_against: 0,
      goal_difference: 0,
    });
  });

  finished.forEach((match) => {
    const a = table.get(match.team_a_id);
    const b = table.get(match.team_b_id);
    if (!a || !b) return;

    const scoreA = Number(match.team_a_score || 0);
    const scoreB = Number(match.team_b_score || 0);

    a.games += 1;
    b.games += 1;
    a.goals_for += scoreA;
    a.goals_against += scoreB;
    b.goals_for += scoreB;
    b.goals_against += scoreA;

    if (scoreA > scoreB) {
      a.wins += 1;
      a.points += 3;
      b.losses += 1;
    } else if (scoreB > scoreA) {
      b.wins += 1;
      b.points += 3;
      a.losses += 1;
    } else {
      a.draws += 1;
      b.draws += 1;
      a.points += 1;
      b.points += 1;
    }
  });

  return [...table.values()]
    .map((row) => ({ ...row, goal_difference: row.goals_for - row.goals_against }))
    .sort((a, b) => b.points - a.points || b.goal_difference - a.goal_difference || b.goals_for - a.goals_for || a.name.localeCompare(b.name));
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'Copa Presídio' });
});

app.post('/api/player/register', async (req, res) => {
  try {
    const missing = requireFields(req.body, ['name', 'position', 'password']);
    if (missing) return res.status(400).json({ error: `Campo obrigatório: ${missing}` });

    const {
      name,
      nickname = '',
      photo = '',
      position,
      desired_shirt_number = null,
      password,
    } = req.body;

    if (String(password).length < 4) {
      return res.status(400).json({ error: 'A senha precisa ter pelo menos 4 caracteres.' });
    }

    const accessNumber = await generateAccessNumber();
    const hash = await bcrypt.hash(String(password), 10);

    const created = await run(
      `INSERT INTO players (access_number, name, nickname, photo, position, desired_shirt_number, shirt_number, password_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [accessNumber, name.trim(), nickname.trim(), photo, position, desired_shirt_number || null, desired_shirt_number || null, hash]
    );

    const player = await get('SELECT * FROM players WHERE id = ?', [created.id]);
    res.status(201).json({ player: removeSensitivePlayerFields(player), token: playerToken(player) });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar cadastro.', details: error.message });
  }
});

app.post('/api/player/login', async (req, res) => {
  try {
    const missing = requireFields(req.body, ['access_number', 'password']);
    if (missing) return res.status(400).json({ error: `Campo obrigatório: ${missing}` });

    const player = await get('SELECT * FROM players WHERE access_number = ?', [String(req.body.access_number).padStart(3, '0')]);
    if (!player) return res.status(401).json({ error: 'Número de acesso ou senha inválidos.' });
    if (player.is_blocked) return res.status(403).json({ error: 'Essa conta está bloqueada.' });

    const ok = await bcrypt.compare(String(req.body.password), player.password_hash);
    if (!ok) return res.status(401).json({ error: 'Número de acesso ou senha inválidos.' });

    res.json({ player: removeSensitivePlayerFields(player), token: playerToken(player) });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao entrar.', details: error.message });
  }
});

app.get('/api/player/me', requireAuth('player'), async (req, res) => {
  const team = req.player.team_id ? await get('SELECT * FROM teams WHERE id = ?', [req.player.team_id]) : null;
  res.json({ player: removeSensitivePlayerFields(req.player), team });
});

app.put('/api/player/me', requireAuth('player'), async (req, res) => {
  try {
    const { name, nickname, photo, position, desired_shirt_number } = req.body;
    await run(
      `UPDATE players SET
       name = COALESCE(?, name),
       nickname = COALESCE(?, nickname),
       photo = COALESCE(?, photo),
       position = COALESCE(?, position),
       desired_shirt_number = COALESCE(?, desired_shirt_number),
       updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name, nickname, photo, position, desired_shirt_number, req.player.id]
    );
    const player = await get('SELECT * FROM players WHERE id = ?', [req.player.id]);
    res.json({ player: removeSensitivePlayerFields(player) });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar perfil.', details: error.message });
  }
});

app.post('/api/teams', requireAuth('player'), async (req, res) => {
  try {
    if (req.player.team_id) return res.status(400).json({ error: 'Você já está em um time.' });
    const missing = requireFields(req.body, ['name']);
    if (missing) return res.status(400).json({ error: `Campo obrigatório: ${missing}` });

    const { name, logo = '', primary_color = '#B6FF00', description = '' } = req.body;
    const accessCode = await generateTeamCode('CP');
    const created = await run(
      'INSERT INTO teams (name, logo, primary_color, description, access_code, captain_player_id) VALUES (?, ?, ?, ?, ?, ?)',
      [name.trim(), logo, primary_color, description, accessCode, req.player.id]
    );
    await run('UPDATE players SET team_id = ?, role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [created.id, 'captain', req.player.id]);
    const team = await get('SELECT * FROM teams WHERE id = ?', [created.id]);
    res.status(201).json({ team });
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) return res.status(400).json({ error: 'Já existe um time com esse nome.' });
    res.status(500).json({ error: 'Erro ao criar time.', details: error.message });
  }
});

app.post('/api/teams/join-request', requireAuth('player'), async (req, res) => {
  try {
    const missing = requireFields(req.body, ['access_code']);
    if (missing) return res.status(400).json({ error: `Campo obrigatório: ${missing}` });
    if (req.player.team_id) return res.status(400).json({ error: 'Você já está em um time.' });

    const code = String(req.body.access_code).trim().toUpperCase();
    const team = await get('SELECT * FROM teams WHERE access_code = ?', [code]);
    if (!team) return res.status(404).json({ error: 'Código de time inválido.' });

    const existing = await get('SELECT * FROM team_join_requests WHERE team_id = ? AND player_id = ?', [team.id, req.player.id]);
    if (existing) {
      if (existing.status === 'pending') return res.status(400).json({ error: 'Você já enviou uma solicitação para esse time.' });
      await run('UPDATE team_join_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['pending', existing.id]);
      return res.json({ message: 'Solicitação reenviada para o capitão.', team });
    }

    await run('INSERT INTO team_join_requests (team_id, player_id) VALUES (?, ?)', [team.id, req.player.id]);
    res.status(201).json({ message: 'Solicitação enviada para o capitão.', team });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao solicitar entrada no time.', details: error.message });
  }
});

app.get('/api/my-team', requireAuth('player'), async (req, res) => {
  try {
    if (!req.player.team_id) return res.json({ team: null, members: [], requests: [], matches: [] });
    const team = await get('SELECT * FROM teams WHERE id = ?', [req.player.team_id]);
    const members = await all(
      `SELECT id, access_number, name, nickname, photo, position, desired_shirt_number, shirt_number, role, is_blocked
       FROM players WHERE team_id = ? ORDER BY role = 'captain' DESC, shirt_number ASC, name ASC`,
      [team.id]
    );
    const requests = req.player.role === 'captain'
      ? await all(
          `SELECT r.id, r.status, r.created_at, p.id as player_id, p.name, p.nickname, p.photo, p.position, p.desired_shirt_number
           FROM team_join_requests r
           JOIN players p ON p.id = r.player_id
           WHERE r.team_id = ? AND r.status = 'pending'
           ORDER BY r.created_at ASC`,
          [team.id]
        )
      : [];
    const matches = await all(
      `SELECT m.*, ta.name as team_a_name, tb.name as team_b_name
       FROM matches m
       JOIN teams ta ON ta.id = m.team_a_id
       JOIN teams tb ON tb.id = m.team_b_id
       WHERE m.team_a_id = ? OR m.team_b_id = ?
       ORDER BY m.match_date ASC`,
      [team.id, team.id]
    );
    res.json({ team, members, requests, matches });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao carregar time.', details: error.message });
  }
});

async function ensureCaptain(req, res) {
  if (req.player.role !== 'captain' || !req.player.team_id) {
    res.status(403).json({ error: 'Somente o capitão do time pode fazer isso.' });
    return false;
  }
  const team = await get('SELECT * FROM teams WHERE id = ? AND captain_player_id = ?', [req.player.team_id, req.player.id]);
  if (!team) {
    res.status(403).json({ error: 'Capitão não confirmado para este time.' });
    return false;
  }
  req.team = team;
  return true;
}

app.put('/api/my-team', requireAuth('player'), async (req, res) => {
  try {
    if (!(await ensureCaptain(req, res))) return;
    const { name, logo, primary_color, description } = req.body;
    await run(
      `UPDATE teams SET
       name = COALESCE(?, name),
       logo = COALESCE(?, logo),
       primary_color = COALESCE(?, primary_color),
       description = COALESCE(?, description),
       updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name, logo, primary_color, description, req.team.id]
    );
    const team = await get('SELECT * FROM teams WHERE id = ?', [req.team.id]);
    res.json({ team });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar time.', details: error.message });
  }
});

app.post('/api/my-team/regenerate-code', requireAuth('player'), async (req, res) => {
  try {
    if (!(await ensureCaptain(req, res))) return;
    const code = await generateTeamCode('CP');
    await run('UPDATE teams SET access_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [code, req.team.id]);
    res.json({ access_code: code });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao gerar novo código.', details: error.message });
  }
});

app.post('/api/my-team/requests/:id/accept', requireAuth('player'), async (req, res) => {
  try {
    if (!(await ensureCaptain(req, res))) return;
    const request = await get('SELECT * FROM team_join_requests WHERE id = ? AND team_id = ?', [req.params.id, req.team.id]);
    if (!request || request.status !== 'pending') return res.status(404).json({ error: 'Solicitação não encontrada.' });

    const player = await get('SELECT * FROM players WHERE id = ?', [request.player_id]);
    if (!player || player.team_id) return res.status(400).json({ error: 'Jogador já está em um time ou não existe.' });

    await run('UPDATE players SET team_id = ?, role = ?, shirt_number = COALESCE(shirt_number, desired_shirt_number), updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.team.id, 'player', player.id]);
    await run('UPDATE team_join_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['approved', request.id]);
    res.json({ message: 'Jogador aprovado no time.' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao aprovar jogador.', details: error.message });
  }
});

app.post('/api/my-team/requests/:id/reject', requireAuth('player'), async (req, res) => {
  try {
    if (!(await ensureCaptain(req, res))) return;
    const request = await get('SELECT * FROM team_join_requests WHERE id = ? AND team_id = ?', [req.params.id, req.team.id]);
    if (!request || request.status !== 'pending') return res.status(404).json({ error: 'Solicitação não encontrada.' });
    await run('UPDATE team_join_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['rejected', request.id]);
    res.json({ message: 'Solicitação recusada.' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao recusar solicitação.', details: error.message });
  }
});

app.put('/api/my-team/members/:playerId', requireAuth('player'), async (req, res) => {
  try {
    if (!(await ensureCaptain(req, res))) return;
    const member = await get('SELECT * FROM players WHERE id = ? AND team_id = ?', [req.params.playerId, req.team.id]);
    if (!member) return res.status(404).json({ error: 'Jogador não encontrado no seu time.' });

    const { shirt_number, position } = req.body;
    if (shirt_number) {
      const conflict = await get(
        'SELECT id, name FROM players WHERE team_id = ? AND shirt_number = ? AND id != ?',
        [req.team.id, shirt_number, member.id]
      );
      if (conflict) return res.status(400).json({ error: `A camisa ${shirt_number} já está com ${conflict.name}.` });
    }

    await run(
      'UPDATE players SET shirt_number = COALESCE(?, shirt_number), position = COALESCE(?, position), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [shirt_number || null, position || null, member.id]
    );
    res.json({ message: 'Jogador atualizado.' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar jogador.', details: error.message });
  }
});

app.post('/api/my-team/members/:playerId/remove', requireAuth('player'), async (req, res) => {
  try {
    if (!(await ensureCaptain(req, res))) return;
    const member = await get('SELECT * FROM players WHERE id = ? AND team_id = ?', [req.params.playerId, req.team.id]);
    if (!member) return res.status(404).json({ error: 'Jogador não encontrado no seu time.' });
    if (member.id === req.player.id) return res.status(400).json({ error: 'O capitão não pode remover a si mesmo.' });

    await run('UPDATE players SET team_id = NULL, role = ?, shirt_number = desired_shirt_number, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['player', member.id]);
    await run('DELETE FROM match_rosters WHERE player_id = ?', [member.id]);
    res.json({ message: 'Jogador removido do time.' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao remover jogador.', details: error.message });
  }
});

app.get('/api/my-team/matches/:matchId/roster', requireAuth('player'), async (req, res) => {
  try {
    if (!req.player.team_id) return res.status(400).json({ error: 'Você não está em um time.' });
    const match = await get(
      `SELECT m.*, ta.name as team_a_name, tb.name as team_b_name
       FROM matches m
       JOIN teams ta ON ta.id = m.team_a_id
       JOIN teams tb ON tb.id = m.team_b_id
       WHERE m.id = ? AND (m.team_a_id = ? OR m.team_b_id = ?)`,
      [req.params.matchId, req.player.team_id, req.player.team_id]
    );
    if (!match) return res.status(404).json({ error: 'Partida não encontrada para seu time.' });
    const members = await all(
      `SELECT p.id, p.access_number, p.name, p.nickname, p.photo, p.position, p.shirt_number,
              COALESCE(r.roster_status, 'fora') as roster_status
       FROM players p
       LEFT JOIN match_rosters r ON r.player_id = p.id AND r.match_id = ?
       WHERE p.team_id = ?
       ORDER BY p.shirt_number ASC, p.name ASC`,
      [match.id, req.player.team_id]
    );
    res.json({ match, members });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao carregar escalação.', details: error.message });
  }
});

app.put('/api/my-team/matches/:matchId/roster', requireAuth('player'), async (req, res) => {
  try {
    if (!(await ensureCaptain(req, res))) return;
    const match = await get('SELECT * FROM matches WHERE id = ? AND (team_a_id = ? OR team_b_id = ?)', [req.params.matchId, req.team.id, req.team.id]);
    if (!match) return res.status(404).json({ error: 'Partida não encontrada para seu time.' });

    const roster = Array.isArray(req.body.roster) ? req.body.roster : [];
    const allowed = new Set(['titular', 'reserva', 'fora']);

    for (const item of roster) {
      if (!allowed.has(item.roster_status)) continue;
      const member = await get('SELECT id FROM players WHERE id = ? AND team_id = ?', [item.player_id, req.team.id]);
      if (!member) continue;
      await run(
        `INSERT INTO match_rosters (match_id, team_id, player_id, roster_status, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(match_id, player_id)
         DO UPDATE SET roster_status = excluded.roster_status, updated_at = CURRENT_TIMESTAMP`,
        [match.id, req.team.id, item.player_id, item.roster_status]
      );
    }

    res.json({ message: 'Escalação salva.' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar escalação.', details: error.message });
  }
});

app.get('/api/public/teams', async (req, res) => {
  try {
    const teams = await all(
      `SELECT t.*, p.name as captain_name,
       (SELECT COUNT(*) FROM players WHERE team_id = t.id) as players_count
       FROM teams t
       JOIN players p ON p.id = t.captain_player_id
       ORDER BY t.name ASC`
    );
    res.json({ teams });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar times.', details: error.message });
  }
});

app.get('/api/public/teams/:id', async (req, res) => {
  try {
    const team = await get(
      `SELECT t.*, p.name as captain_name
       FROM teams t JOIN players p ON p.id = t.captain_player_id
       WHERE t.id = ?`,
      [req.params.id]
    );
    if (!team) return res.status(404).json({ error: 'Time não encontrado.' });
    const members = await all(
      `SELECT id, access_number, name, nickname, photo, position, shirt_number, role
       FROM players WHERE team_id = ? ORDER BY role = 'captain' DESC, shirt_number ASC, name ASC`,
      [team.id]
    );
    const matches = await all(
      `SELECT m.*, ta.name as team_a_name, tb.name as team_b_name
       FROM matches m
       JOIN teams ta ON ta.id = m.team_a_id
       JOIN teams tb ON tb.id = m.team_b_id
       WHERE m.team_a_id = ? OR m.team_b_id = ?
       ORDER BY m.match_date DESC`,
      [team.id, team.id]
    );
    res.json({ team, members, matches });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao abrir time.', details: error.message });
  }
});

app.get('/api/public/matches', async (req, res) => {
  try {
    const matches = await all(
      `SELECT m.*, ta.name as team_a_name, ta.logo as team_a_logo, tb.name as team_b_name, tb.logo as team_b_logo
       FROM matches m
       JOIN teams ta ON ta.id = m.team_a_id
       JOIN teams tb ON tb.id = m.team_b_id
       ORDER BY datetime(m.match_date) ASC`
    );
    res.json({ matches });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar partidas.', details: error.message });
  }
});

app.get('/api/public/matches/:id', async (req, res) => {
  try {
    const match = await get(
      `SELECT m.*, ta.name as team_a_name, tb.name as team_b_name
       FROM matches m
       JOIN teams ta ON ta.id = m.team_a_id
       JOIN teams tb ON tb.id = m.team_b_id
       WHERE m.id = ?`,
      [req.params.id]
    );
    if (!match) return res.status(404).json({ error: 'Partida não encontrada.' });
    const rosters = await all(
      `SELECT r.*, p.name, p.nickname, p.photo, p.position, p.shirt_number, t.name as team_name
       FROM match_rosters r
       JOIN players p ON p.id = r.player_id
       JOIN teams t ON t.id = r.team_id
       WHERE r.match_id = ?
       ORDER BY t.name ASC, r.roster_status ASC, p.shirt_number ASC`,
      [match.id]
    );
    const events = await all(
      `SELECT e.*, p.name as player_name, t.name as team_name
       FROM match_events e
       LEFT JOIN players p ON p.id = e.player_id
       LEFT JOIN teams t ON t.id = e.team_id
       WHERE e.match_id = ?
       ORDER BY COALESCE(e.minute, 999) ASC, e.created_at ASC`,
      [match.id]
    );
    res.json({ match, rosters, events });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao abrir partida.', details: error.message });
  }
});

app.get('/api/public/standings', async (req, res) => {
  try {
    const standings = await calculateStandings();
    res.json({ standings });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao calcular tabela.', details: error.message });
  }
});

app.post('/api/admin/login', async (req, res) => {
  try {
    const missing = requireFields(req.body, ['access_code', 'password']);
    if (missing) return res.status(400).json({ error: `Campo obrigatório: ${missing}` });

    const accessCode = String(req.body.access_code).trim();
    const admin = await get('SELECT * FROM admins WHERE access_code = ?', [accessCode]);
    if (!admin) return res.status(401).json({ error: 'Código administrativo ou senha inválidos.' });
    const ok = await bcrypt.compare(String(req.body.password), admin.password_hash);
    if (!ok) return res.status(401).json({ error: 'Código administrativo ou senha inválidos.' });

    const { password_hash, ...safeAdmin } = admin;
    res.json({ admin: safeAdmin, token: adminToken(admin) });
  } catch (error) {
    res.status(500).json({ error: 'Erro no login administrativo.', details: error.message });
  }
});

app.get('/api/admin/summary', requireAuth('admin'), async (req, res) => {
  try {
    const players = await get('SELECT COUNT(*) as count FROM players');
    const teams = await get('SELECT COUNT(*) as count FROM teams');
    const matches = await get('SELECT COUNT(*) as count FROM matches');
    const pending = await get("SELECT COUNT(*) as count FROM team_join_requests WHERE status = 'pending'");
    res.json({ players: players.count, teams: teams.count, matches: matches.count, pending_requests: pending.count });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao carregar resumo.', details: error.message });
  }
});

app.get('/api/admin/players', requireAuth('admin'), async (req, res) => {
  try {
    const players = await all(
      `SELECT p.id, p.access_number, p.name, p.nickname, p.photo, p.position, p.desired_shirt_number, p.shirt_number, p.role, p.is_blocked, p.created_at,
              t.name as team_name
       FROM players p
       LEFT JOIN teams t ON t.id = p.team_id
       ORDER BY p.created_at DESC`
    );
    res.json({ players });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar jogadores.', details: error.message });
  }
});

app.get('/api/admin/teams', requireAuth('admin'), async (req, res) => {
  try {
    const teams = await all(
      `SELECT t.*, p.name as captain_name,
       (SELECT COUNT(*) FROM players WHERE team_id = t.id) as players_count
       FROM teams t
       JOIN players p ON p.id = t.captain_player_id
       ORDER BY t.created_at DESC`
    );
    res.json({ teams });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar times.', details: error.message });
  }
});

app.get('/api/admin/matches', requireAuth('admin'), async (req, res) => {
  try {
    const matches = await all(
      `SELECT m.*, ta.name as team_a_name, tb.name as team_b_name
       FROM matches m
       JOIN teams ta ON ta.id = m.team_a_id
       JOIN teams tb ON tb.id = m.team_b_id
       ORDER BY datetime(m.match_date) DESC`
    );
    res.json({ matches });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar partidas.', details: error.message });
  }
});

app.post('/api/admin/matches', requireAuth('admin'), async (req, res) => {
  try {
    const missing = requireFields(req.body, ['team_a_id', 'team_b_id', 'match_date']);
    if (missing) return res.status(400).json({ error: `Campo obrigatório: ${missing}` });
    if (Number(req.body.team_a_id) === Number(req.body.team_b_id)) {
      return res.status(400).json({ error: 'Escolha dois times diferentes.' });
    }
    const created = await run(
      'INSERT INTO matches (team_a_id, team_b_id, match_date, location, status) VALUES (?, ?, ?, ?, ?)',
      [req.body.team_a_id, req.body.team_b_id, req.body.match_date, req.body.location || '', req.body.status || 'agendada']
    );
    const match = await get('SELECT * FROM matches WHERE id = ?', [created.id]);
    res.status(201).json({ match });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar partida.', details: error.message });
  }
});

app.put('/api/admin/matches/:id', requireAuth('admin'), async (req, res) => {
  try {
    const match = await get('SELECT * FROM matches WHERE id = ?', [req.params.id]);
    if (!match) return res.status(404).json({ error: 'Partida não encontrada.' });

    const {
      match_date,
      location,
      status,
      team_a_score,
      team_b_score,
      winner_team_id,
    } = req.body;

    let winner = winner_team_id || null;
    if (status === 'finalizada' && team_a_score !== undefined && team_b_score !== undefined) {
      const a = Number(team_a_score);
      const b = Number(team_b_score);
      if (a > b) winner = match.team_a_id;
      else if (b > a) winner = match.team_b_id;
      else winner = null;
    }

    await run(
      `UPDATE matches SET
       match_date = COALESCE(?, match_date),
       location = COALESCE(?, location),
       status = COALESCE(?, status),
       team_a_score = COALESCE(?, team_a_score),
       team_b_score = COALESCE(?, team_b_score),
       winner_team_id = ?,
       updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [match_date, location, status, team_a_score, team_b_score, winner, match.id]
    );
    const updated = await get('SELECT * FROM matches WHERE id = ?', [match.id]);
    res.json({ match: updated });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar partida.', details: error.message });
  }
});

app.post('/api/admin/matches/:id/events', requireAuth('admin'), async (req, res) => {
  try {
    const match = await get('SELECT * FROM matches WHERE id = ?', [req.params.id]);
    if (!match) return res.status(404).json({ error: 'Partida não encontrada.' });
    const missing = requireFields(req.body, ['event_type']);
    if (missing) return res.status(400).json({ error: `Campo obrigatório: ${missing}` });

    const { player_id = null, team_id = null, event_type, minute = null, description = '' } = req.body;
    await run(
      'INSERT INTO match_events (match_id, player_id, team_id, event_type, minute, description) VALUES (?, ?, ?, ?, ?, ?)',
      [match.id, player_id || null, team_id || null, event_type, minute || null, description]
    );
    res.status(201).json({ message: 'Evento registrado.' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao registrar evento.', details: error.message });
  }
});

app.put('/api/admin/players/:id/block', requireAuth('admin'), async (req, res) => {
  try {
    const blocked = req.body.is_blocked ? 1 : 0;
    await run('UPDATE players SET is_blocked = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [blocked, req.params.id]);
    res.json({ message: blocked ? 'Jogador bloqueado.' : 'Jogador desbloqueado.' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao bloquear/desbloquear jogador.', details: error.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Copa Presídio rodando em http://localhost:${PORT}`);
      console.log(`Admin padrão: código ${DEFAULT_ADMIN_ACCESS_CODE} / senha ${DEFAULT_ADMIN_PASSWORD}`);
    });
  })
  .catch((error) => {
    console.error('Erro ao iniciar banco de dados:', error);
    process.exit(1);
  });
