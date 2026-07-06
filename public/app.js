const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const themeToggle = document.querySelector('#themeToggle');

const POSITIONS = [
  'Goleiro',
  'Zagueiro',
  'Lateral direito',
  'Lateral esquerdo',
  'Volante',
  'Meio-campo',
  'Ponta direita',
  'Ponta esquerda',
  'Atacante',
];

const STATUS_LABELS = {
  agendada: 'Agendada',
  andamento: 'Em andamento',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
};

const EVENT_LABELS = {
  gol: 'Gol',
  cartao_amarelo: 'Cartão amarelo',
  cartao_vermelho: 'Cartão vermelho',
  expulsao: 'Expulsão',
  observacao: 'Observação',
};

const state = {
  view: 'home',
  params: {},
  playerToken: localStorage.getItem('cp_player_token') || '',
  adminToken: localStorage.getItem('cp_admin_token') || '',
  theme: localStorage.getItem('cp_theme') || 'dark',
  adminTab: 'summary',
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value) {
  if (!value) return 'Sem data';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function setLoading(message = 'Carregando...') {
  app.innerHTML = `
    <section class="empty">
      <div class="emoji">⚽</div>
      <h2>${escapeHtml(message)}</h2>
      <p>Preparando as informações da Copa Presídio.</p>
    </section>
  `;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';

  const token = options.admin ? state.adminToken : state.playerToken;
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Erro inesperado.');
  }
  return data;
}

function optionsHtml(items, selected = '') {
  return items
    .map((item) => `<option value="${escapeHtml(item)}" ${item === selected ? 'selected' : ''}>${escapeHtml(item)}</option>`)
    .join('');
}

function statusOptions(selected = 'agendada') {
  return Object.entries(STATUS_LABELS)
    .map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`)
    .join('');
}

function eventOptions(selected = 'gol') {
  return Object.entries(EVENT_LABELS)
    .map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`)
    .join('');
}

function imageOrPlaceholder(src, text, className = 'avatar') {
  if (src) return `<img class="${className}" src="${src}" alt="${escapeHtml(text)}" />`;
  const initials = String(text || 'CP')
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return `<div class="${className} avatar-placeholder">${escapeHtml(initials)}</div>`;
}

function fileToDataUrl(file) {
  return new Promise((resolve) => {
    if (!file) return resolve('');
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

function serializeForm(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  Object.keys(data).forEach((key) => {
    if (typeof data[key] === 'string') data[key] = data[key].trim();
  });
  return data;
}

function setTokens(type, token) {
  if (type === 'player') {
    state.playerToken = token || '';
    if (token) localStorage.setItem('cp_player_token', token);
    else localStorage.removeItem('cp_player_token');
  }
  if (type === 'admin') {
    state.adminToken = token || '';
    if (token) localStorage.setItem('cp_admin_token', token);
    else localStorage.removeItem('cp_admin_token');
  }
}

function activateNav(view) {
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
}

async function setView(view, params = {}) {
  state.view = view;
  state.params = params;
  activateNav(['home', 'teams', 'matches', 'standings', 'profile'].includes(view) ? view : 'profile');
  setLoading();

  try {
    if (view === 'home') await renderHome();
    if (view === 'register') await renderRegister();
    if (view === 'login') await renderLogin();
    if (view === 'profile') await renderProfile();
    if (view === 'teams') await renderTeams();
    if (view === 'teamDetail') await renderTeamDetail(params.id);
    if (view === 'matches') await renderMatches();
    if (view === 'matchDetail') await renderMatchDetail(params.id);
    if (view === 'standings') await renderStandings();
    if (view === 'createTeam') await renderCreateTeam();
    if (view === 'joinTeam') await renderJoinTeam();
    if (view === 'captainTeam') await renderCaptainTeam();
    if (view === 'roster') await renderRoster(params.matchId || params.id);
    if (view === 'adminLogin') await renderAdminLogin();
    if (view === 'admin') await renderAdmin();
  } catch (error) {
    app.innerHTML = `
      <section class="empty">
        <div class="emoji">⚠️</div>
        <h2>Algo deu errado</h2>
        <p>${escapeHtml(error.message)}</p>
        <button class="primary-button" data-view="home">Voltar ao início</button>
      </section>
    `;
  }
}

async function renderHome() {
  const [teamsData, matchesData, standingsData] = await Promise.all([
    api('/api/public/teams'),
    api('/api/public/matches'),
    api('/api/public/standings'),
  ]);

  const nextMatch = matchesData.matches.find((match) => match.status !== 'finalizada') || matchesData.matches[0];
  const leader = standingsData.standings[0];
  const teamAName = nextMatch?.team_a_name || 'TITÃS FC';
  const teamBName = nextMatch?.team_b_name || 'LOBOS';
  const scoreA = nextMatch?.team_a_score ?? 0;
  const scoreB = nextMatch?.team_b_score ?? 0;
  const matchDate = nextMatch ? formatDate(nextMatch.match_date) : 'Aguardando agenda';

  app.innerHTML = `
    <section class="home-hero">
      <div class="hero-copy">
        <span class="kicker hero-kicker">⚽ Campeonato escolar</span>
        <h1><span>Copa</span><strong>Presídio</strong></h1>
        <p class="hero-subtitle">A maior competição escolar do ano. Gerencie seu time, acompanhe estatísticas e domine o campo.</p>
        <p class="school-line">📍 na <strong>Etec Engenheiro Agrônomo Narciso de Medeiros</strong></p>
        <div class="home-actions">
          ${state.playerToken ? '<button class="primary-button hero-btn" data-view="profile">Abrir minha conta <span>→</span></button>' : '<button class="primary-button hero-btn" data-view="register">Criar conta <span>→</span></button>'}
          <button class="ghost-button hero-btn" data-view="login">Entrar <span>→</span></button>
        </div>
      </div>

      <div class="hero-visual" aria-hidden="true">
        <div class="lime-orbit"></div>
        <div class="player-photo-frame">
          <img src="/assets/player-hero.png" alt="Jogador comemorando em campo" />
        </div>
      </div>

      <article class="featured-match-card">
        <div class="match-card-top">
          <span>● Próximo jogo</span>
          <strong>${escapeHtml(matchDate)}</strong>
        </div>
        <div class="score-layout">
          <div class="mini-team">
            <div class="team-shield">${escapeHtml(teamAName.slice(0, 1).toUpperCase())}</div>
            <strong>${escapeHtml(teamAName)}</strong>
          </div>
          <div class="score-center">
            <small>VS</small>
            <strong>${escapeHtml(scoreA)} - ${escapeHtml(scoreB)}</strong>
            <span>${nextMatch ? escapeHtml(STATUS_LABELS[nextMatch.status] || nextMatch.status) : 'Aguardando'}</span>
          </div>
          <div class="mini-team">
            <div class="team-shield wolf">${escapeHtml(teamBName.slice(0, 1).toUpperCase())}</div>
            <strong>${escapeHtml(teamBName)}</strong>
          </div>
        </div>
        <button class="ghost-button match-link" data-view="matches">▣ Ver todos os jogos</button>
      </article>
    </section>

    <section class="home-grid">
      <article class="school-card">
        <img src="/assets/escola-etec.jpg" alt="Etec Engenheiro Agrônomo Narciso de Medeiros" />
        <div class="school-caption">
          <span>🏫</span>
          <div>
            <strong>Etec Engenheiro Agrônomo<br />Narciso de Medeiros</strong>
            <small>Iguape • SP</small>
          </div>
        </div>
      </article>

      <button class="feature-card" data-view="standings">
        <span class="feature-icon">🏆</span>
        <strong>Classificação</strong>
        <p>Acompanhe a tabela atualizada e a disputa pelo topo.</p>
        <small>Ver tabela →</small>
      </button>

      <button class="feature-card" data-view="matches">
        <span class="feature-icon">⚽</span>
        <strong>Jogos</strong>
        <p>Resultados, próximos jogos e histórico completo.</p>
        <small>Ver jogos →</small>
      </button>

      <button class="feature-card" data-view="teams">
        <span class="feature-icon">👥</span>
        <strong>Times & jogadores</strong>
        <p>Cadastre jogadores, crie seu time por código e gerencie tudo.</p>
        <small>Gerenciar →</small>
      </button>
    </section>
  `;
}

async function renderRegister() {
  app.innerHTML = `
    <section class="form-card">
      <div class="section-header">
        <div>
          <h2>Criar conta</h2>
          <p class="muted">Seu número de acesso será gerado automaticamente.</p>
        </div>
        <span class="badge">jogador</span>
      </div>
      <form id="registerForm" class="form-card">
        <div class="field">
          <label>Nome completo</label>
          <input name="name" placeholder="Ex: João Silva" required />
        </div>
        <div class="field">
          <label>Apelido</label>
          <input name="nickname" placeholder="Ex: Joãozinho" />
        </div>
        <div class="grid two">
          <div class="field">
            <label>Posição</label>
            <select name="position" required>${optionsHtml(POSITIONS)}</select>
          </div>
          <div class="field">
            <label>Número desejado</label>
            <input name="desired_shirt_number" type="number" min="1" max="99" placeholder="10" />
          </div>
        </div>
        <div class="field">
          <label>Foto do jogador</label>
          <input name="photoFile" type="file" accept="image/*" />
        </div>
        <div class="grid two">
          <div class="field">
            <label>Senha</label>
            <input name="password" type="password" minlength="4" required />
          </div>
          <div class="field">
            <label>Confirmar senha</label>
            <input name="confirmPassword" type="password" minlength="4" required />
          </div>
        </div>
        <div class="form-actions">
          <button class="primary-button" type="submit">Criar minha conta</button>
          <button class="ghost-button" type="button" data-view="login">Já tenho conta</button>
        </div>
      </form>
    </section>
  `;

  document.querySelector('#registerForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = serializeForm(form);
    if (data.password !== data.confirmPassword) return showToast('As senhas não são iguais.');
    const photo = await fileToDataUrl(form.photoFile.files[0]);

    try {
      const result = await api('/api/player/register', {
        method: 'POST',
        body: JSON.stringify({
          name: data.name,
          nickname: data.nickname,
          position: data.position,
          desired_shirt_number: data.desired_shirt_number ? Number(data.desired_shirt_number) : null,
          photo,
          password: data.password,
        }),
      });
      setTokens('player', result.token);
      showToast(`Conta criada. Seu acesso é ${result.player.access_number}.`);
      setView('profile');
    } catch (error) {
      showToast(error.message);
    }
  });
}

async function renderLogin() {
  app.innerHTML = `
    <section class="form-card">
      <div class="section-header">
        <div>
          <h2>Entrar na conta</h2>
          <p class="muted">Use o número de acesso gerado no cadastro.</p>
        </div>
        <span class="badge">login</span>
      </div>
      <form id="loginForm" class="form-card">
        <div class="field">
          <label>Número de acesso</label>
          <input name="access_number" inputmode="numeric" placeholder="Ex: 012" required />
        </div>
        <div class="field">
          <label>Senha</label>
          <input name="password" type="password" required />
        </div>
        <div class="form-actions">
          <button class="primary-button" type="submit">Entrar</button>
          <button class="ghost-button" type="button" data-view="register">Criar conta</button>
        </div>
      </form>
    </section>
  `;

  document.querySelector('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = serializeForm(event.currentTarget);
    try {
      const result = await api('/api/player/login', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      setTokens('player', result.token);
      showToast('Entrada feita com sucesso.');
      setView('profile');
    } catch (error) {
      showToast(error.message);
    }
  });
}

async function renderProfile() {
  if (!state.playerToken) {
    app.innerHTML = `
      <section class="hero">
        <span class="kicker">👤 área do jogador</span>
        <h1>Sua conta</h1>
        <p>Entre para criar time, pedir entrada em um time, ver seu número de acesso e gerenciar sua participação.</p>
        <div class="hero-actions">
          <button class="primary-button" data-view="register">Criar conta</button>
          <button class="ghost-button" data-view="login">Entrar</button>
        </div>
      </section>
      <section class="card">
        <div class="card-header">
          <div>
            <h2>Organização</h2>
            <p>Área reservada para quem vai gerenciar a copa.</p>
          </div>
          <span class="badge dark">admin</span>
        </div>
        <button class="ghost-button" data-view="adminLogin">Entrar como administrador</button>
      </section>
    `;
    return;
  }

  const { player, team } = await api('/api/player/me');

  app.innerHTML = `
    <section class="card">
      <div class="entity-row">
        ${imageOrPlaceholder(player.photo, player.name)}
        <div>
          <h2>${escapeHtml(player.name)}</h2>
          <p class="muted">Acesso <strong>${escapeHtml(player.access_number)}</strong> • ${escapeHtml(player.position)}</p>
        </div>
      </div>
      <div class="stats-strip">
        <div class="stat"><strong>${player.shirt_number || '-'}</strong><span>Camisa</span></div>
        <div class="stat"><strong>${team ? 'Sim' : 'Não'}</strong><span>Time</span></div>
        <div class="stat"><strong>${player.role === 'captain' ? 'Cap.' : 'Jog.'}</strong><span>Função</span></div>
      </div>
      <div class="actions-row">
        ${team && player.role === 'captain' ? '<button class="primary-button" data-view="captainTeam">Gerenciar time</button>' : ''}
        ${!team ? '<button class="primary-button" data-view="createTeam">Criar time</button>' : ''}
        ${!team ? '<button class="ghost-button" data-view="joinTeam">Entrar em time</button>' : ''}
        <button class="danger-button" id="logoutPlayer">Sair da conta</button>
      </div>
    </section>

    ${team ? `
      <section class="team-card">
        <div class="entity-row">
          ${imageOrPlaceholder(team.logo, team.name, 'logo-img')}
          <div>
            <h2>${escapeHtml(team.name)}</h2>
            <p class="muted">${player.role === 'captain' ? `Código: ${escapeHtml(team.access_code)}` : 'Você faz parte deste time.'}</p>
          </div>
        </div>
        <button class="ghost-button" data-view="teamDetail" data-id="${team.id}">Ver página do time</button>
      </section>
    ` : `
      <section class="empty">
        <div class="emoji">🛡️</div>
        <h2>Você ainda está sem time</h2>
        <p>Crie seu próprio time ou use o código de outro capitão para pedir entrada.</p>
      </section>
    `}

    <section class="card">
      <div class="card-header">
        <div>
          <h2>Painel administrativo</h2>
          <p>Área para registrar resultados, cartões, expulsões e partidas.</p>
        </div>
        <span class="badge dark">admin</span>
      </div>
      <button class="ghost-button" data-view="adminLogin">Entrar como administrador</button>
    </section>
  `;

  document.querySelector('#logoutPlayer')?.addEventListener('click', () => {
    setTokens('player', '');
    showToast('Você saiu da conta.');
    setView('home');
  });
}

async function renderCreateTeam() {
  if (!state.playerToken) return setView('login');
  app.innerHTML = `
    <section class="form-card">
      <div class="section-header">
        <div>
          <h2>Criar time</h2>
          <p class="muted">Você será o capitão e receberá um código de entrada.</p>
        </div>
        <span class="badge">capitão</span>
      </div>
      <form id="createTeamForm" class="form-card">
        <div class="field">
          <label>Nome do time</label>
          <input name="name" placeholder="Ex: Os Invencíveis" required />
        </div>
        <div class="field">
          <label>Escudo ou foto do time</label>
          <input name="logoFile" type="file" accept="image/*" />
        </div>
        <div class="grid two">
          <div class="field">
            <label>Cor principal</label>
            <input name="primary_color" type="color" value="#B6FF00" />
          </div>
          <div class="field">
            <label>Descrição</label>
            <input name="description" placeholder="Ex: time do 2º ano" />
          </div>
        </div>
        <div class="form-actions">
          <button class="primary-button" type="submit">Criar time</button>
          <button class="ghost-button" type="button" data-view="profile">Cancelar</button>
        </div>
      </form>
    </section>
  `;

  document.querySelector('#createTeamForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = serializeForm(form);
    const logo = await fileToDataUrl(form.logoFile.files[0]);
    try {
      const result = await api('/api/teams', {
        method: 'POST',
        body: JSON.stringify({ ...data, logo }),
      });
      showToast(`Time criado. Código: ${result.team.access_code}`);
      setView('captainTeam');
    } catch (error) {
      showToast(error.message);
    }
  });
}

async function renderJoinTeam() {
  if (!state.playerToken) return setView('login');
  app.innerHTML = `
    <section class="form-card">
      <div class="section-header">
        <div>
          <h2>Entrar em time</h2>
          <p class="muted">Digite o código que o capitão do time te passou.</p>
        </div>
        <span class="badge">código</span>
      </div>
      <form id="joinTeamForm" class="form-card">
        <div class="field">
          <label>Código do time</label>
          <input name="access_code" placeholder="Ex: CP-AX12" required />
        </div>
        <button class="primary-button" type="submit">Enviar solicitação</button>
      </form>
      <p class="muted">Por segurança, o capitão precisa aceitar sua entrada antes de você virar jogador do time.</p>
    </section>
  `;

  document.querySelector('#joinTeamForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = serializeForm(event.currentTarget);
    try {
      const result = await api('/api/teams/join-request', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      showToast(result.message);
      setView('profile');
    } catch (error) {
      showToast(error.message);
    }
  });
}

function teamCard(team) {
  return `
    <article class="team-card">
      <div class="entity-row">
        ${imageOrPlaceholder(team.logo, team.name, 'logo-img')}
        <div>
          <h3>${escapeHtml(team.name)}</h3>
          <small>Capitão: ${escapeHtml(team.captain_name || 'Sem capitão')} • ${team.players_count || 0} jogadores</small>
        </div>
      </div>
      <button class="ghost-button" data-view="teamDetail" data-id="${team.id}">Abrir time</button>
    </article>
  `;
}

async function renderTeams() {
  const { teams } = await api('/api/public/teams');
  app.innerHTML = `
    <section class="section-header">
      <div>
        <h2>Times</h2>
        <p class="muted">Todos os times cadastrados na Copa Presídio.</p>
      </div>
      <span class="badge">${teams.length}</span>
    </section>
    <section class="grid cards-2">
      ${teams.length ? teams.map(teamCard).join('') : '<div class="empty"><div class="emoji">🛡️</div><h2>Nenhum time ainda</h2><p>O primeiro capitão ainda precisa criar um time.</p></div>'}
    </section>
  `;
}

async function renderTeamDetail(id) {
  const { team, members, matches } = await api(`/api/public/teams/${id}`);
  app.innerHTML = `
    <section class="team-card">
      <div class="entity-row">
        ${imageOrPlaceholder(team.logo, team.name, 'logo-img')}
        <div>
          <h2>${escapeHtml(team.name)}</h2>
          <p class="muted">Capitão: ${escapeHtml(team.captain_name)}</p>
        </div>
      </div>
      ${team.description ? `<p>${escapeHtml(team.description)}</p>` : ''}
    </section>

    <section class="section-header">
      <h2>Jogadores</h2>
      <span class="badge">${members.length}</span>
    </section>
    <section class="grid">
      ${members.length ? members.map(playerCard).join('') : '<div class="empty"><p>Nenhum jogador nesse time.</p></div>'}
    </section>

    <section class="section-header">
      <h2>Partidas do time</h2>
      <span class="badge dark">${matches.length}</span>
    </section>
    <section class="grid">
      ${matches.length ? matches.map((match) => matchCard(match)).join('') : '<div class="empty"><p>Este time ainda não tem partidas cadastradas.</p></div>'}
    </section>
  `;
}

function playerCard(player) {
  return `
    <article class="player-card">
      <div class="entity-row">
        ${imageOrPlaceholder(player.photo, player.name)}
        <div>
          <h3>${escapeHtml(player.name)} ${player.role === 'captain' ? '<span class="badge">capitão</span>' : ''}</h3>
          <small>#${escapeHtml(player.access_number || '')} • ${escapeHtml(player.position || '')} • Camisa ${player.shirt_number || '-'}</small>
        </div>
      </div>
    </article>
  `;
}

function matchCard(match, compact = false) {
  return `
    <article class="match-card">
      <div class="inline-between">
        <span class="badge ${match.status === 'finalizada' ? 'dark' : ''}">${STATUS_LABELS[match.status] || match.status}</span>
        <span class="muted">${formatDate(match.match_date)}</span>
      </div>
      <div class="match-score">
        <span class="team-name">${escapeHtml(match.team_a_name || 'Time A')}</span>
        <strong>${match.team_a_score ?? 0} x ${match.team_b_score ?? 0}</strong>
        <span class="team-name">${escapeHtml(match.team_b_name || 'Time B')}</span>
      </div>
      ${match.location ? `<p class="muted">📍 ${escapeHtml(match.location)}</p>` : ''}
      ${compact ? '<button class="ghost-button" data-view="matches">Ver jogos</button>' : `<button class="ghost-button" data-view="matchDetail" data-id="${match.id}">Detalhes</button>`}
    </article>
  `;
}

async function renderMatches() {
  const { matches } = await api('/api/public/matches');
  app.innerHTML = `
    <section class="section-header">
      <div>
        <h2>Partidas</h2>
        <p class="muted">Calendário, placar e status dos jogos.</p>
      </div>
      <span class="badge">${matches.length}</span>
    </section>
    <section class="grid">
      ${matches.length ? matches.map((match) => matchCard(match)).join('') : '<div class="empty"><div class="emoji">⚽</div><h2>Nenhum jogo</h2><p>O administrador ainda não cadastrou partidas.</p></div>'}
    </section>
  `;
}

async function renderMatchDetail(id) {
  const { match, rosters, events } = await api(`/api/public/matches/${id}`);
  const byTeam = rosters.reduce((acc, item) => {
    acc[item.team_name] ||= [];
    acc[item.team_name].push(item);
    return acc;
  }, {});

  app.innerHTML = `
    <section class="match-card">
      <div class="inline-between">
        <span class="badge">${STATUS_LABELS[match.status] || match.status}</span>
        <span class="muted">${formatDate(match.match_date)}</span>
      </div>
      <div class="match-score">
        <span class="team-name">${escapeHtml(match.team_a_name)}</span>
        <strong>${match.team_a_score ?? 0} x ${match.team_b_score ?? 0}</strong>
        <span class="team-name">${escapeHtml(match.team_b_name)}</span>
      </div>
      ${match.location ? `<p class="muted">📍 ${escapeHtml(match.location)}</p>` : ''}
    </section>

    <section class="section-header">
      <h2>Escalações</h2>
      <span class="badge dark">titulares/reservas</span>
    </section>
    <section class="grid cards-2">
      ${Object.entries(byTeam).length ? Object.entries(byTeam).map(([teamName, players]) => `
        <article class="card">
          <h2>${escapeHtml(teamName)}</h2>
          <div class="small-list">
            ${players.map((player) => `
              <div class="small-row">
                <div>
                  <strong>${escapeHtml(player.name)}</strong>
                  <span>${escapeHtml(player.roster_status)} • camisa ${player.shirt_number || '-'}</span>
                </div>
                <span>${escapeHtml(player.position || '')}</span>
              </div>
            `).join('')}
          </div>
        </article>
      `).join('') : '<div class="empty"><p>Ainda não existe escalação para esta partida.</p></div>'}
    </section>

    <section class="section-header">
      <h2>Eventos</h2>
      <span class="badge dark">${events.length}</span>
    </section>
    <section class="grid">
      ${events.length ? events.map((event) => `
        <article class="card">
          <div class="inline-between">
            <strong>${EVENT_LABELS[event.event_type] || event.event_type}</strong>
            <span class="badge dark">${event.minute ? `${event.minute}'` : 'sem minuto'}</span>
          </div>
          <p>${escapeHtml(event.player_name || 'Sem jogador')} • ${escapeHtml(event.team_name || 'Sem time')}</p>
          ${event.description ? `<p class="muted">${escapeHtml(event.description)}</p>` : ''}
        </article>
      `).join('') : '<div class="empty"><p>Nenhum cartão, gol ou observação registrado.</p></div>'}
    </section>
  `;
}

async function renderStandings() {
  const { standings } = await api('/api/public/standings');
  app.innerHTML = `
    <section class="section-header">
      <div>
        <h2>Tabela</h2>
        <p class="muted">Vitória 3 pontos, empate 1 ponto, derrota 0.</p>
      </div>
      <span class="badge">classificação</span>
    </section>
    <section class="table-card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Time</th><th>Pts</th><th>J</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th>
            </tr>
          </thead>
          <tbody>
            ${standings.map((row, index) => `
              <tr>
                <td>${index + 1}</td>
                <td><strong>${escapeHtml(row.name)}</strong></td>
                <td><strong>${row.points}</strong></td>
                <td>${row.games}</td>
                <td>${row.wins}</td>
                <td>${row.draws}</td>
                <td>${row.losses}</td>
                <td>${row.goals_for}</td>
                <td>${row.goals_against}</td>
                <td>${row.goal_difference}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${!standings.length ? '<p class="muted">A tabela aparecerá quando os times forem criados.</p>' : ''}
    </section>
  `;
}

async function renderCaptainTeam() {
  if (!state.playerToken) return setView('login');
  const { team, members, requests, matches } = await api('/api/my-team');
  if (!team) return setView('createTeam');

  app.innerHTML = `
    <section class="team-card">
      <div class="entity-row">
        ${imageOrPlaceholder(team.logo, team.name, 'logo-img')}
        <div>
          <h2>${escapeHtml(team.name)}</h2>
          <p class="muted">Painel do capitão</p>
        </div>
      </div>
      <div class="code-box">
        <div>
          <span class="muted">Código de entrada</span>
          <strong>${escapeHtml(team.access_code)}</strong>
        </div>
        <button class="tiny-button" id="copyTeamCode">Copiar</button>
      </div>
      <button class="ghost-button" id="regenerateCode">Gerar novo código</button>
    </section>

    <section class="form-card">
      <h2>Editar time</h2>
      <form id="editTeamForm" class="form-card">
        <div class="field">
          <label>Nome</label>
          <input name="name" value="${escapeHtml(team.name)}" />
        </div>
        <div class="field">
          <label>Descrição</label>
          <input name="description" value="${escapeHtml(team.description || '')}" />
        </div>
        <div class="field">
          <label>Cor principal</label>
          <input name="primary_color" type="color" value="${escapeHtml(team.primary_color || '#B6FF00')}" />
        </div>
        <button class="primary-button" type="submit">Salvar time</button>
      </form>
    </section>

    <section class="section-header">
      <h2>Solicitações</h2>
      <span class="badge">${requests.length}</span>
    </section>
    <section class="grid">
      ${requests.length ? requests.map((request) => `
        <article class="player-card">
          <div class="entity-row">
            ${imageOrPlaceholder(request.photo, request.name)}
            <div>
              <h3>${escapeHtml(request.name)}</h3>
              <small>${escapeHtml(request.position)} • quer camisa ${request.desired_shirt_number || '-'}</small>
            </div>
          </div>
          <div class="grid two">
            <button class="primary-button accept-request" data-id="${request.id}">Aceitar</button>
            <button class="danger-button reject-request" data-id="${request.id}">Recusar</button>
          </div>
        </article>
      `).join('') : '<div class="empty"><p>Nenhuma solicitação pendente.</p></div>'}
    </section>

    <section class="section-header">
      <h2>Jogadores</h2>
      <span class="badge dark">${members.length}</span>
    </section>
    <section class="grid">
      ${members.map((member) => `
        <article class="player-card">
          <div class="entity-row">
            ${imageOrPlaceholder(member.photo, member.name)}
            <div>
              <h3>${escapeHtml(member.name)} ${member.role === 'captain' ? '<span class="badge">capitão</span>' : ''}</h3>
              <small>#${member.access_number} • ${escapeHtml(member.position)} • camisa ${member.shirt_number || '-'}</small>
            </div>
          </div>
          <form class="member-form grid two" data-id="${member.id}">
            <input name="shirt_number" type="number" min="1" max="99" placeholder="Camisa" value="${member.shirt_number || ''}" />
            <select name="position">${optionsHtml(POSITIONS, member.position)}</select>
            <button class="primary-button" type="submit">Salvar</button>
            ${member.role !== 'captain' ? `<button class="danger-button remove-member" type="button" data-id="${member.id}">Remover</button>` : '<span></span>'}
          </form>
        </article>
      `).join('')}
    </section>

    <section class="section-header">
      <h2>Escalações</h2>
      <span class="badge dark">por partida</span>
    </section>
    <section class="grid">
      ${matches.length ? matches.map((match) => `
        <article class="match-card">
          <div class="match-score">
            <span class="team-name">${escapeHtml(match.team_a_name)}</span>
            <strong>${match.team_a_score ?? 0} x ${match.team_b_score ?? 0}</strong>
            <span class="team-name">${escapeHtml(match.team_b_name)}</span>
          </div>
          <p class="muted">${formatDate(match.match_date)} • ${STATUS_LABELS[match.status] || match.status}</p>
          <button class="ghost-button" data-view="roster" data-id="${match.id}">Organizar titulares e reservas</button>
        </article>
      `).join('') : '<div class="empty"><p>O administrador ainda não criou partidas para seu time.</p></div>'}
    </section>
  `;

  document.querySelector('#copyTeamCode')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(team.access_code).catch(() => null);
    showToast('Código copiado.');
  });

  document.querySelector('#regenerateCode')?.addEventListener('click', async () => {
    if (!confirm('Gerar um novo código? O código antigo deixará de funcionar.')) return;
    try {
      const result = await api('/api/my-team/regenerate-code', { method: 'POST', body: '{}' });
      showToast(`Novo código: ${result.access_code}`);
      setView('captainTeam');
    } catch (error) {
      showToast(error.message);
    }
  });

  document.querySelector('#editTeamForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = serializeForm(event.currentTarget);
    try {
      await api('/api/my-team', { method: 'PUT', body: JSON.stringify(data) });
      showToast('Time atualizado.');
      setView('captainTeam');
    } catch (error) {
      showToast(error.message);
    }
  });

  document.querySelectorAll('.accept-request').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api(`/api/my-team/requests/${button.dataset.id}/accept`, { method: 'POST', body: '{}' });
        showToast('Jogador aceito no time.');
        setView('captainTeam');
      } catch (error) {
        showToast(error.message);
      }
    });
  });

  document.querySelectorAll('.reject-request').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api(`/api/my-team/requests/${button.dataset.id}/reject`, { method: 'POST', body: '{}' });
        showToast('Solicitação recusada.');
        setView('captainTeam');
      } catch (error) {
        showToast(error.message);
      }
    });
  });

  document.querySelectorAll('.member-form').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = serializeForm(form);
      try {
        await api(`/api/my-team/members/${form.dataset.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            shirt_number: data.shirt_number ? Number(data.shirt_number) : null,
            position: data.position,
          }),
        });
        showToast('Jogador atualizado.');
        setView('captainTeam');
      } catch (error) {
        showToast(error.message);
      }
    });
  });

  document.querySelectorAll('.remove-member').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Remover este jogador do time?')) return;
      try {
        await api(`/api/my-team/members/${button.dataset.id}/remove`, { method: 'POST', body: '{}' });
        showToast('Jogador removido.');
        setView('captainTeam');
      } catch (error) {
        showToast(error.message);
      }
    });
  });
}

async function renderRoster(matchId) {
  if (!state.playerToken) return setView('login');
  const { match, members } = await api(`/api/my-team/matches/${matchId}/roster`);
  app.innerHTML = `
    <section class="match-card">
      <h2>Escalação da partida</h2>
      <div class="match-score">
        <span class="team-name">${escapeHtml(match.team_a_name || 'Time A')}</span>
        <strong>${match.team_a_score ?? 0} x ${match.team_b_score ?? 0}</strong>
        <span class="team-name">${escapeHtml(match.team_b_name || 'Time B')}</span>
      </div>
      <p class="muted">${formatDate(match.match_date)}</p>
    </section>

    <section class="form-card">
      <div class="section-header">
        <h2>Titulares e reservas</h2>
        <span class="badge">${members.length}</span>
      </div>
      <form id="rosterForm" class="roster-grid">
        ${members.map((member) => `
          <div class="roster-item" data-player-id="${member.id}">
            <div class="entity-row">
              ${imageOrPlaceholder(member.photo, member.name)}
              <div>
                <h3>${escapeHtml(member.name)}</h3>
                <small>${escapeHtml(member.position)} • camisa ${member.shirt_number || '-'}</small>
              </div>
            </div>
            <div class="segmented">
              ${['titular', 'reserva', 'fora'].map((status) => `
                <button type="button" class="roster-choice ${member.roster_status === status ? 'active' : ''}" data-status="${status}">${status}</button>
              `).join('')}
            </div>
            <input type="hidden" name="status_${member.id}" value="${member.roster_status}" />
          </div>
        `).join('')}
        <button class="primary-button" type="submit">Salvar escalação</button>
      </form>
    </section>
  `;

  document.querySelectorAll('.roster-choice').forEach((button) => {
    button.addEventListener('click', () => {
      const item = button.closest('.roster-item');
      item.querySelectorAll('.roster-choice').forEach((choice) => choice.classList.remove('active'));
      button.classList.add('active');
      item.querySelector('input[type="hidden"]').value = button.dataset.status;
    });
  });

  document.querySelector('#rosterForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const roster = [...document.querySelectorAll('.roster-item')].map((item) => ({
      player_id: Number(item.dataset.playerId),
      roster_status: item.querySelector('input[type="hidden"]').value,
    }));
    try {
      await api(`/api/my-team/matches/${matchId}/roster`, {
        method: 'PUT',
        body: JSON.stringify({ roster }),
      });
      showToast('Escalação salva.');
      setView('captainTeam');
    } catch (error) {
      showToast(error.message);
    }
  });
}

async function renderAdminLogin() {
  if (state.adminToken) return setView('admin');
  app.innerHTML = `
    <section class="form-card">
      <div class="section-header">
        <div>
          <h2>Login administrativo</h2>
          <p class="muted">Use esta área para controlar partidas, resultados e cartões.</p>
        </div>
        <span class="badge dark">admin</span>
      </div>
      <form id="adminLoginForm" class="form-card" autocomplete="off">
        <div class="field">
          <label>Código administrativo</label>
          <input name="access_code" inputmode="numeric" pattern="[0-9]*" placeholder="Digite o código administrativo" required />
        </div>
        <div class="field">
          <label>Senha</label>
          <input name="password" type="password" placeholder="Digite a senha do administrador" required />
        </div>
        <button class="primary-button" type="submit">Entrar no admin</button>
      </form>
    </section>
  `;

  document.querySelector('#adminLoginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = serializeForm(event.currentTarget);
    try {
      const result = await api('/api/admin/login', {
        method: 'POST',
        admin: true,
        body: JSON.stringify(data),
      });
      setTokens('admin', result.token);
      showToast('Admin conectado.');
      setView('admin');
    } catch (error) {
      showToast(error.message);
    }
  });
}

function adminTabs() {
  const tabs = [
    ['summary', 'Resumo'],
    ['players', 'Jogadores'],
    ['teams', 'Times'],
    ['matches', 'Partidas'],
  ];
  return `
    <div class="tabs">
      ${tabs.map(([key, label]) => `<button class="admin-tab ${state.adminTab === key ? 'active' : ''}" data-tab="${key}">${label}</button>`).join('')}
    </div>
  `;
}

async function renderAdmin() {
  if (!state.adminToken) return setView('adminLogin');

  let content = '';
  if (state.adminTab === 'summary') content = await adminSummary();
  if (state.adminTab === 'players') content = await adminPlayers();
  if (state.adminTab === 'teams') content = await adminTeams();
  if (state.adminTab === 'matches') content = await adminMatches();

  app.innerHTML = `
    <section class="hero">
      <span class="kicker">🛠️ painel admin</span>
      <h1>Gestão da copa</h1>
      <p>Atualize partidas, placares, cartões, expulsões, jogadores e times.</p>
      <div class="hero-actions">
        <button class="primary-button" data-view="home">Ver site público</button>
        <button class="danger-button" id="logoutAdmin">Sair do admin</button>
      </div>
    </section>
    ${adminTabs()}
    ${content}
  `;

  document.querySelector('#logoutAdmin')?.addEventListener('click', () => {
    setTokens('admin', '');
    showToast('Você saiu do admin.');
    setView('profile');
  });

  document.querySelectorAll('.admin-tab').forEach((button) => {
    button.addEventListener('click', () => {
      state.adminTab = button.dataset.tab;
      setView('admin');
    });
  });

  attachAdminHandlers();
}

async function adminSummary() {
  const summary = await api('/api/admin/summary', { admin: true });
  return `
    <section class="stats-strip">
      <div class="stat"><strong>${summary.players}</strong><span>Jogadores</span></div>
      <div class="stat"><strong>${summary.teams}</strong><span>Times</span></div>
      <div class="stat"><strong>${summary.matches}</strong><span>Partidas</span></div>
    </section>
    <section class="card">
      <h2>Solicitações pendentes</h2>
      <p class="muted">Existem ${summary.pending_requests} pedidos de entrada esperando capitães.</p>
    </section>
  `;
}

async function adminPlayers() {
  const { players } = await api('/api/admin/players', { admin: true });
  return `
    <section class="grid">
      ${players.map((player) => `
        <article class="player-card">
          <div class="entity-row">
            ${imageOrPlaceholder(player.photo, player.name)}
            <div>
              <h3>${escapeHtml(player.name)}</h3>
              <small>#${player.access_number} • ${escapeHtml(player.position)} • ${escapeHtml(player.team_name || 'sem time')}</small>
            </div>
          </div>
          <button class="${player.is_blocked ? 'ghost-button' : 'danger-button'} block-player" data-id="${player.id}" data-blocked="${player.is_blocked ? '0' : '1'}">
            ${player.is_blocked ? 'Desbloquear jogador' : 'Bloquear jogador'}
          </button>
        </article>
      `).join('')}
    </section>
  `;
}

async function adminTeams() {
  const { teams } = await api('/api/admin/teams', { admin: true });
  return `
    <section class="grid cards-2">
      ${teams.map((team) => `
        <article class="team-card">
          <div class="entity-row">
            ${imageOrPlaceholder(team.logo, team.name, 'logo-img')}
            <div>
              <h3>${escapeHtml(team.name)}</h3>
              <small>Capitão: ${escapeHtml(team.captain_name)} • ${team.players_count} jogadores</small>
            </div>
          </div>
          <div class="code-box"><span>Código</span><strong>${escapeHtml(team.access_code)}</strong></div>
        </article>
      `).join('')}
    </section>
  `;
}

async function adminMatches() {
  const [{ matches }, { teams }, { players }] = await Promise.all([
    api('/api/admin/matches', { admin: true }),
    api('/api/admin/teams', { admin: true }),
    api('/api/admin/players', { admin: true }),
  ]);

  const teamOptions = teams.map((team) => `<option value="${team.id}">${escapeHtml(team.name)}</option>`).join('');
  const playerOptions = players.map((player) => `<option value="${player.id}">${escapeHtml(player.name)} #${player.access_number}</option>`).join('');

  return `
    <section class="form-card">
      <h2>Criar partida</h2>
      <form id="createMatchForm" class="form-card">
        <div class="grid two">
          <div class="field">
            <label>Time A</label>
            <select name="team_a_id" required>${teamOptions}</select>
          </div>
          <div class="field">
            <label>Time B</label>
            <select name="team_b_id" required>${teamOptions}</select>
          </div>
        </div>
        <div class="grid two">
          <div class="field">
            <label>Data e horário</label>
            <input name="match_date" type="datetime-local" required />
          </div>
          <div class="field">
            <label>Local</label>
            <input name="location" placeholder="Ex: Quadra da escola" />
          </div>
        </div>
        <button class="primary-button" type="submit">Criar partida</button>
      </form>
    </section>

    <section class="grid">
      ${matches.map((match) => `
        <article class="match-card">
          <div class="match-score">
            <span class="team-name">${escapeHtml(match.team_a_name)}</span>
            <strong>${match.team_a_score ?? 0} x ${match.team_b_score ?? 0}</strong>
            <span class="team-name">${escapeHtml(match.team_b_name)}</span>
          </div>
          <p class="muted">${formatDate(match.match_date)} • ${STATUS_LABELS[match.status] || match.status}</p>
          <form class="update-match-form form-card" data-id="${match.id}">
            <div class="grid two">
              <input name="team_a_score" type="number" min="0" value="${match.team_a_score ?? 0}" />
              <input name="team_b_score" type="number" min="0" value="${match.team_b_score ?? 0}" />
            </div>
            <select name="status">${statusOptions(match.status)}</select>
            <button class="primary-button" type="submit">Salvar resultado</button>
          </form>
          <form class="event-form form-card" data-id="${match.id}">
            <h3>Registrar evento</h3>
            <div class="grid two">
              <select name="event_type">${eventOptions()}</select>
              <input name="minute" type="number" min="0" placeholder="Minuto" />
            </div>
            <div class="grid two">
              <select name="team_id">
                <option value="">Sem time</option>
                <option value="${match.team_a_id}">${escapeHtml(match.team_a_name)}</option>
                <option value="${match.team_b_id}">${escapeHtml(match.team_b_name)}</option>
              </select>
              <select name="player_id">
                <option value="">Sem jogador</option>
                ${playerOptions}
              </select>
            </div>
            <input name="description" placeholder="Observação opcional" />
            <button class="ghost-button" type="submit">Adicionar evento</button>
          </form>
        </article>
      `).join('')}
    </section>
  `;
}

function attachAdminHandlers() {
  document.querySelector('#createMatchForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = serializeForm(event.currentTarget);
    try {
      await api('/api/admin/matches', {
        method: 'POST',
        admin: true,
        body: JSON.stringify({
          ...data,
          team_a_id: Number(data.team_a_id),
          team_b_id: Number(data.team_b_id),
        }),
      });
      showToast('Partida criada.');
      setView('admin');
    } catch (error) {
      showToast(error.message);
    }
  });

  document.querySelectorAll('.update-match-form').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = serializeForm(form);
      try {
        await api(`/api/admin/matches/${form.dataset.id}`, {
          method: 'PUT',
          admin: true,
          body: JSON.stringify({
            status: data.status,
            team_a_score: Number(data.team_a_score),
            team_b_score: Number(data.team_b_score),
          }),
        });
        showToast('Resultado atualizado.');
        setView('admin');
      } catch (error) {
        showToast(error.message);
      }
    });
  });

  document.querySelectorAll('.event-form').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = serializeForm(form);
      try {
        await api(`/api/admin/matches/${form.dataset.id}/events`, {
          method: 'POST',
          admin: true,
          body: JSON.stringify({
            event_type: data.event_type,
            minute: data.minute ? Number(data.minute) : null,
            team_id: data.team_id ? Number(data.team_id) : null,
            player_id: data.player_id ? Number(data.player_id) : null,
            description: data.description,
          }),
        });
        showToast('Evento registrado.');
        setView('admin');
      } catch (error) {
        showToast(error.message);
      }
    });
  });

  document.querySelectorAll('.block-player').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api(`/api/admin/players/${button.dataset.id}/block`, {
          method: 'PUT',
          admin: true,
          body: JSON.stringify({ is_blocked: button.dataset.blocked === '1' }),
        });
        showToast('Jogador atualizado.');
        setView('admin');
      } catch (error) {
        showToast(error.message);
      }
    });
  });
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (!button) return;
  const view = button.dataset.view;
  const id = button.dataset.id;
  setView(view, id ? { id } : {});
});

themeToggle.addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('cp_theme', state.theme);
  applyTheme();
});

function applyTheme() {
  document.body.classList.toggle('light', state.theme === 'light');
  themeToggle.textContent = state.theme === 'light' ? '🌙' : '☀';
}

applyTheme();
setView('home');
