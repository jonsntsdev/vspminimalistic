const COLUMNS = ['todo', 'doing', 'done'];
const LABELS = { todo: 'A fazer', doing: 'Em andamento', done: 'Concluído' };
const EMPTY = {
  todo: 'Seu próximo passo começa aqui.',
  doing: 'O que está em movimento aparece aqui.',
  done: 'Tarefas concluídas ficam por aqui.'
};
const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5"/></svg>';

const $ = (selector, root = document) => root.querySelector(selector);
const loginScreen = $('#loginScreen');
const loginForm = $('#loginForm');
const appHeader = $('#appHeader');
const workspace = $('#workspace');
const modal = $('#modal');
const form = $('#taskForm');
const passwordInput = $('#passwordInput');
const loginMessage = $('#loginMessage');
const syncStatus = $('#syncStatus');
const chatPanel = $('#projectChat');
const chatForm = $('#chatForm');
const chatInput = $('#chatInput');
const chatMessages = $('#chatMessages');
const chatSubmit = $('#chatSubmit');
const board = $('#board');
const shareModal = $('#shareModal');
const shareForm = $('#shareForm');
const shareEmail = $('#shareEmail');
const shareMessage = $('#shareMessage');
const shareMembers = $('#shareMembers');
const aiModal = $('#aiModal');
const aiSettingsForm = $('#aiSettingsForm');
const aiProvider = $('#aiProvider');
const aiModel = $('#aiModel');
const aiApiKey = $('#aiApiKey');
const aiBaseUrl = $('#aiBaseUrl');
const aiBaseUrlField = $('#aiBaseUrlField');
const aiSettingsMessage = $('#aiSettingsMessage');

let authMode = 'login';
let tasks = [];
let chatHistory = [];
let draggedId = null;
let writeQueue = Promise.resolve();
let currentUser = null;
let boardOwnerId = null;

if (board && window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  let boardFrame = null;
  board.addEventListener('pointermove', event => {
    if (boardFrame) cancelAnimationFrame(boardFrame);
    boardFrame = requestAnimationFrame(() => {
      const rect = board.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      board.classList.add('is-hovered');
      board.style.transform = `rotateX(${-y * 2.8}deg) rotateY(${x * 3.8}deg) translateY(-3px)`;
    });
  });
  board.addEventListener('pointerleave', () => {
    if (boardFrame) cancelAnimationFrame(boardFrame);
    board.classList.remove('is-hovered');
    board.style.transform = 'rotateX(0deg) rotateY(0deg) translateY(0)';
  });
}

function setLoginMessage(message, isError = true) {
  loginMessage.textContent = message;
  loginMessage.hidden = !message;
  loginMessage.classList.toggle('is-error', isError);
}

function setAuthMode(mode) {
  authMode = mode;
  const creating = mode === 'create';
  $('#loginTitle').textContent = creating ? 'Comece por aqui.' : 'Seu espaço de trabalho.';
  $('#authDescription').textContent = creating
    ? 'Crie sua conta para organizar suas tarefas.'
    : 'Entre para acessar seu quadro.';
  $('#authSubmit').textContent = creating ? 'Criar conta' : 'Entrar';
  $('#authModeToggle').textContent = creating ? 'Já tenho uma conta' : 'Criar uma conta';
  passwordInput.autocomplete = creating ? 'new-password' : 'current-password';
  setLoginMessage('');
}

function setSyncStatus(message, isError = false) {
  syncStatus.textContent = message;
  syncStatus.classList.toggle('is-error', isError);
}

function setAuthenticatedView(user) {
  loginScreen.hidden = Boolean(user);
  appHeader.hidden = !user;
  workspace.hidden = !user;
  if (!user) closeChat();
  if (user) $('#accountEmail').textContent = user.email || '';
}

function openChat() {
  chatPanel.hidden = false;
  $('#openChat').setAttribute('aria-expanded', 'true');
  chatInput.focus();
}

function closeChat() {
  chatPanel.hidden = true;
  $('#openChat').setAttribute('aria-expanded', 'false');
}

function appendChatMessage(content, role, isError = false) {
  const message = document.createElement('p');
  message.className = `chat-message is-${role}${isError ? ' is-error' : ''}`;
  message.textContent = content;
  chatMessages.append(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function resetChat() {
  chatHistory = [];
  chatMessages.replaceChildren();
  const welcome = document.createElement('p');
  welcome.className = 'chat-welcome';
  welcome.textContent = 'Pergunte sobre suas tarefas, o que está atrasado ou o que falta fazer.';
  chatMessages.append(welcome);
}

function stopBoardListener() {
  tasks = [];
  boardOwnerId = null;
  writeQueue = Promise.resolve();
}

function isTask(task) {
  return task &&
    typeof task.id === 'string' &&
    typeof task.title === 'string' &&
    typeof task.desc === 'string' &&
    COLUMNS.includes(task.status) &&
    Number.isFinite(task.createdAt);
}

async function openBoard(user) {
  setSyncStatus('Conectando ao quadro…');
  const response = await fetch('/api/board', { credentials: 'same-origin' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível abrir o quadro.');
  if (!Array.isArray(result.tasks) || !result.tasks.every(isTask)) {
    throw new Error('Os dados do quadro estão em um formato inválido.');
  }
  tasks = result.tasks;
  boardOwnerId = result.ownerId;
  render();
  setSyncStatus('Sincronizado');
}

function persistTasks() {
  if (!currentUser) {
    setSyncStatus('Não há uma conta conectada para salvar as tarefas.', true);
    return;
  }
  const savedTasks = tasks.map(task => ({ ...task }));
  setSyncStatus('Salvando…');
  writeQueue = writeQueue
    .then(async () => {
      const response = await fetch('/api/board', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: savedTasks })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível salvar.');
      setSyncStatus('Sincronizado');
    })
    .catch(error => {
      setSyncStatus(`Não foi possível salvar: ${error.message}`, true);
    });
}

loginForm.addEventListener('input', () => setLoginMessage(''));
loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!loginForm.reportValidity()) return;
  const email = $('#emailInput').value.trim().toLowerCase();
  const password = passwordInput.value;
  try {
    const response = await fetch(authMode === 'create' ? '/api/auth/signup' : '/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a solicitação.');
    currentUser = result.user;
    setLoginMessage('');
    resetChat();
    setAuthenticatedView(currentUser);
    await openBoard(currentUser);
  } catch (error) {
    setLoginMessage(error.message);
  }
});

$('#authModeToggle').addEventListener('click', () => {
  setAuthMode(authMode === 'login' ? 'create' : 'login');
});

$('#logoutBtn').addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    currentUser = null;
    stopBoardListener();
    resetChat();
    setAuthenticatedView(null);
  } catch (error) {
    setSyncStatus(`Não foi possível sair: ${error.message}`, true);
  }
});

function setShareMessage(message, isError = true) {
  shareMessage.textContent = message;
  shareMessage.hidden = !message;
  shareMessage.classList.toggle('is-error', isError);
}

async function loadShareMembers() {
  shareMembers.replaceChildren();
  if (boardOwnerId !== currentUser?.id) {
    setShareMessage('Somente o proprietário pode alterar o compartilhamento.', true);
    return;
  }
  setShareMessage('');
  const response = await fetch('/api/board/members', { credentials: 'same-origin' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível carregar os participantes.');
  if (!result.members.length) {
    const empty = document.createElement('p');
    empty.className = 'share-empty';
    empty.textContent = 'Nenhuma pessoa adicionada ainda.';
    shareMembers.append(empty);
    return;
  }
  result.members.forEach(member => {
    const row = document.createElement('div');
    row.className = 'share-member';
    const email = document.createElement('span');
    email.textContent = member.email;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn-ghost';
    remove.textContent = 'Remover';
    remove.addEventListener('click', async () => {
      const removeResponse = await fetch(`/api/board/members/${encodeURIComponent(member.id)}`, {
        method: 'DELETE',
        credentials: 'same-origin'
      });
      if (removeResponse.ok) loadShareMembers();
      else {
        const removeResult = await removeResponse.json();
        setShareMessage(removeResult.error || 'Não foi possível remover a pessoa.', true);
      }
    });
    row.append(email, remove);
    shareMembers.append(row);
  });
}

$('#openShare').addEventListener('click', async () => {
  shareModal.showModal();
  shareEmail.value = '';
  setShareMessage('');
  try {
    await loadShareMembers();
  } catch (error) {
    setShareMessage(error.message, true);
  }
  shareEmail.focus();
});

$('#closeShare').addEventListener('click', () => shareModal.close());
shareModal.addEventListener('click', event => {
  if (event.target === shareModal) shareModal.close();
});

shareForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!shareForm.reportValidity()) return;
  if (boardOwnerId !== currentUser?.id) {
    setShareMessage('Somente o proprietário pode compartilhar este quadro.', true);
    return;
  }
  try {
    const response = await fetch('/api/board/members', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: shareEmail.value.trim().toLowerCase() })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível compartilhar o quadro.');
    shareEmail.value = '';
    setShareMessage(`${result.member.email} agora pode acessar o quadro.`, false);
    await loadShareMembers();
  } catch (error) {
    setShareMessage(error.message, true);
  }
});

$('#openChat').addEventListener('click', openChat);
$('#closeChat').addEventListener('click', closeChat);

function setAISettingsMessage(message, isError = true) {
  aiSettingsMessage.textContent = message;
  aiSettingsMessage.hidden = !message;
  aiSettingsMessage.classList.toggle('is-error', isError);
}

function applyProviderModelDefaults() {
  const defaults = {
    openai: 'gpt-4o-mini',
    gemini: 'gemini-2.5-flash',
    anthropic: 'claude-sonnet-4-5',
    'openai-compatible': 'gpt-4o-mini'
  };
  aiBaseUrlField.hidden = aiProvider.value !== 'openai-compatible';
  aiBaseUrl.required = aiProvider.value === 'openai-compatible';
  if (!aiModel.dataset.userEdited) aiModel.value = defaults[aiProvider.value];
}

async function loadAISettings() {
  setAISettingsMessage('Carregando configurações…', false);
  const response = await fetch('/api/ai/config', { credentials: 'same-origin' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível carregar a configuração de IA.');
  aiProvider.value = result.provider;
  aiModel.value = result.model;
  aiModel.dataset.userEdited = 'true';
  aiBaseUrl.value = result.baseUrl || '';
  aiApiKey.value = '';
  applyProviderModelDefaults();
  setAISettingsMessage(
    result.configuredProviders?.filter(item => item.configured).map(item => item.label).join(', ')
      ? 'Chaves já configuradas: ' + result.configuredProviders.filter(item => item.configured).map(item => item.label).join(', ')
      : 'Nenhum provedor está configurado.',
    true
  );
}

$('#openAISettings').addEventListener('click', async () => {
  aiModal.showModal();
  aiModel.dataset.userEdited = '';
  aiApiKey.value = '';
  try {
    await loadAISettings();
  } catch (error) {
    setAISettingsMessage(error.message, true);
  }
});

$('#closeAISettings').addEventListener('click', () => aiModal.close());
aiModal.addEventListener('click', event => {
  if (event.target === aiModal) aiModal.close();
});
aiProvider.addEventListener('change', () => {
  aiModel.dataset.userEdited = '';
  applyProviderModelDefaults();
});
aiModel.addEventListener('input', () => {
  aiModel.dataset.userEdited = 'true';
});

aiSettingsForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!aiSettingsForm.reportValidity()) return;
  setAISettingsMessage('Salvando…', false);
  try {
    const response = await fetch('/api/ai/config', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: aiProvider.value,
        model: aiModel.value.trim(),
        apiKey: aiApiKey.value,
        baseUrl: aiBaseUrl.value.trim()
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível salvar.');
    aiApiKey.value = '';
    setAISettingsMessage('Configuração salva com segurança.', false);
  } catch (error) {
    setAISettingsMessage(error.message, true);
  }
});

$('#testAIConnection').addEventListener('click', async () => {
  setAISettingsMessage('Testando conexão…', false);
  try {
    const response = await fetch('/api/ai/test', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Falha ao testar a conexão.');
    setAISettingsMessage(`Conexão ativa: ${result.provider} / ${result.model}.`, false);
  } catch (error) {
    setAISettingsMessage(error.message, true);
  }
});

chatForm.addEventListener('submit', async event => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message || !currentUser || chatSubmit.disabled) return;

  chatInput.value = '';
  appendChatMessage(message, 'user');
  const conversation = [...chatHistory, { role: 'user', content: message }].slice(-9);
  chatSubmit.disabled = true;
  chatSubmit.textContent = '...';

  try {
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: conversation })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível consultar o projeto.');
    if (typeof result.answer !== 'string' || !result.answer.trim()) {
      throw new Error('A IA retornou uma resposta vazia. Tente novamente.');
    }
    chatHistory = [...conversation, { role: 'assistant', content: result.answer }].slice(-10);
    appendChatMessage(result.answer, 'assistant');
  } catch (error) {
    appendChatMessage(error.message || 'Não foi possível consultar o projeto.', 'assistant', true);
  } finally {
    chatSubmit.disabled = false;
    chatSubmit.textContent = 'Enviar';
    chatInput.focus();
  }
});

async function restoreSession() {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!response.ok) {
      setAuthenticatedView(null);
      return;
    }
    const result = await response.json();
    currentUser = result.user;
    resetChat();
    setAuthenticatedView(currentUser);
    await openBoard(currentUser);
  } catch (error) {
    setLoginMessage(`Não foi possível verificar sua sessão: ${error.message}`);
  }
}

restoreSession();

function render() {
  COLUMNS.forEach(status => {
    const list = $(`[data-list="${status}"]`);
    const items = tasks.filter(task => task.status === status);
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = EMPTY[status];
      list.append(empty);
    }
    items.forEach(task => list.append(cardEl(task)));
    $(`[data-count="${status}"]`).textContent = items.length;
  });
}

function cardEl(task) {
  const element = document.createElement('article');
  element.className = 'card';
  element.draggable = true;
  element.dataset.id = task.id;

  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let cardFrame = null;
    element.addEventListener('pointerenter', () => {
      document.querySelectorAll('.card').forEach(card => {
        card.classList.toggle('is-lifted', card === element);
        card.classList.toggle('is-recessed', card !== element);
      });
    });
    element.addEventListener('pointermove', event => {
      if (cardFrame) cancelAnimationFrame(cardFrame);
      cardFrame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        element.style.setProperty('--mouse-x', `${((event.clientX - rect.left) / rect.width) * 100}%`);
        element.style.setProperty('--mouse-y', `${((event.clientY - rect.top) / rect.height) * 100}%`);
        element.style.transform =
          `translateY(-9px) translateZ(12px) rotateX(${-y * 4}deg) rotateY(${x * 5}deg) scale(1.014)`;
      });
    });
    element.addEventListener('pointerleave', () => {
      if (cardFrame) cancelAnimationFrame(cardFrame);
      element.style.transform = '';
      element.style.setProperty('--mouse-x', '50%');
      element.style.setProperty('--mouse-y', '50%');
      document.querySelectorAll('.card').forEach(card => {
        card.classList.remove('is-lifted', 'is-recessed');
      });
    });
  }

  const heading = document.createElement('h3');
  heading.textContent = task.title;
  element.append(heading);

  if (task.desc) {
    const description = document.createElement('p');
    description.textContent = task.desc;
    element.append(description);
  }

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'btn-del';
  deleteButton.innerHTML = TRASH;
  deleteButton.setAttribute('aria-label', `Excluir tarefa: ${task.title}`);
  deleteButton.addEventListener('click', () => removeTask(task.id));
  element.append(deleteButton);

  const footer = document.createElement('div');
  footer.className = 'card-foot';
  const date = document.createElement('span');
  date.textContent = new Date(task.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  const move = document.createElement('div');
  move.className = 'move';
  const index = COLUMNS.indexOf(task.status);
  [[-1, '←'], [1, '→']].forEach(([direction, symbol]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = symbol;
    const target = COLUMNS[index + direction];
    button.disabled = !target;
    if (target) button.setAttribute('aria-label', `Mover para ${LABELS[target]}`);
    button.addEventListener('click', () => moveTask(task.id, target));
    move.append(button);
  });
  footer.append(date, move);
  element.append(footer);

  element.addEventListener('dragstart', event => {
    draggedId = task.id;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', task.id);
    requestAnimationFrame(() => element.classList.add('dragging'));
  });
  element.addEventListener('dragend', () => {
    draggedId = null;
    element.classList.remove('dragging');
    document.querySelectorAll('.drag-over').forEach(column => column.classList.remove('drag-over'));
  });
  return element;
}

function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function addTask(title, desc) {
  tasks.push({ id: uid(), title, desc, status: 'todo', createdAt: Date.now() });
  render();
  persistTasks();
}

function removeTask(id) {
  tasks = tasks.filter(task => task.id !== id);
  render();
  persistTasks();
}

function moveTask(id, status, beforeId = null) {
  if (!COLUMNS.includes(status)) return;
  const task = tasks.find(item => item.id === id);
  if (!task) return;
  tasks = tasks.filter(item => item.id !== id);
  task.status = status;
  const index = beforeId ? tasks.findIndex(item => item.id === beforeId) : -1;
  if (index >= 0) tasks.splice(index, 0, task);
  else tasks.push(task);
  render();
  persistTasks();
}

function cardAfterCursor(list, y) {
  const cards = [...list.querySelectorAll('.card:not(.dragging)')];
  return cards.find(card => {
    const box = card.getBoundingClientRect();
    return y < box.top + box.height / 2;
  });
}

document.querySelectorAll('.column').forEach(column => {
  const list = $('.cards', column);
  column.addEventListener('dragover', event => {
    if (!draggedId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    column.classList.add('drag-over');
  });
  column.addEventListener('dragleave', event => {
    if (!column.contains(event.relatedTarget)) column.classList.remove('drag-over');
  });
  column.addEventListener('drop', event => {
    event.preventDefault();
    column.classList.remove('drag-over');
    if (!draggedId) return;
    const next = cardAfterCursor(list, event.clientY);
    moveTask(draggedId, column.dataset.status, next ? next.dataset.id : null);
  });
});

$('#openModal').addEventListener('click', () => {
  form.reset();
  modal.showModal();
  $('#titleInput').focus();
});
$('#cancelBtn').addEventListener('click', () => modal.close());
modal.addEventListener('click', event => {
  if (event.target === modal) modal.close();
});
form.addEventListener('submit', event => {
  event.preventDefault();
  const title = $('#titleInput').value.trim();
  if (!title) return;
  addTask(title, $('#descInput').value.trim());
  modal.close();
});
