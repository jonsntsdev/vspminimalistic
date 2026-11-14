import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  doc,
  getFirestore,
  onSnapshot,
  runTransaction,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const COLUMNS = ['todo', 'doing', 'done'];
const LABELS = { todo: 'A fazer', doing: 'Em andamento', done: 'Concluído' };
const EMPTY = {
  todo: 'Seu próximo passo começa aqui.',
  doing: 'O que está em movimento aparece aqui.',
  done: 'Tarefas concluídas ficam por aqui.'
};
const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5"/></svg>';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
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
const assistantPanel = $('#assistantPanel');
const assistantLauncher = $('#assistantLauncher');
const assistantMessages = $('#assistantMessages');
const assistantInput = $('#assistantInput');
const assistantSend = $('#assistantSend');

let authMode = 'login';
let tasks = [];
let draggedId = null;
let breakingTaskId = null;
let assistantBusy = false;
let assistantGeneration = 0;
let assistantUserId = null;
const subtaskErrors = new Map();
let boardRef = null;
let unsubscribeBoard = null;
let pendingWrites = 0;
let writeQueue = Promise.resolve();
let boardGeneration = 0;

function authErrorMessage(error) {
  const messages = {
    'auth/email-already-in-use': 'Este e-mail já possui uma conta. Entre com sua senha.',
    'auth/invalid-email': 'Informe um endereço de e-mail válido.',
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/weak-password': 'Escolha uma senha com pelo menos 8 caracteres.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente novamente.',
    'auth/network-request-failed': 'Sem conexão com o Firebase. Verifique a internet e tente novamente.',
    'auth/operation-not-allowed': 'O login por e-mail e senha não está ativado no Firebase.'
  };
  return messages[error.code] || `Não foi possível concluir a solicitação: ${error.message}`;
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
  $('#resetPassword').hidden = creating;
  passwordInput.autocomplete = creating ? 'new-password' : 'current-password';
  setLoginMessage('');
}

function setSyncStatus(message, isError = false) {
  syncStatus.textContent = message;
  syncStatus.classList.toggle('is-error', isError);
}

function showBoardError(error) {
  const message = String(error.message || '');
  const normalized = message.toLowerCase();
  const firestoreApiDisabled = normalized.includes('firestore.googleapis.com') &&
    (normalized.includes('not been used') || normalized.includes('disabled'));

  if (firestoreApiDisabled) {
    const disabledMessage =
      `A API do Cloud Firestore está desativada no projeto ${firebaseConfig.projectId}. ` +
      'Ative-a no Google Cloud Console e aguarde alguns minutos.';
    setSyncStatus(disabledMessage, true);
    const link = document.createElement('a');
    link.href = `https://console.cloud.google.com/apis/api/firestore.googleapis.com/overview?project=${encodeURIComponent(firebaseConfig.projectId)}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Abrir configuração da API';
    syncStatus.append(document.createElement('br'), link);
    return;
  }
  if (error.code === 'permission-denied') {
    setSyncStatus('Sem permissão para acessar o quadro. Confira se as regras do Firestore foram publicadas.', true);
    return;
  }
  setSyncStatus(`Não foi possível abrir o quadro: ${message}`, true);
}

function setAuthenticatedView(user) {
  loginScreen.hidden = Boolean(user);
  appHeader.hidden = !user;
  workspace.hidden = !user;
  if (user) $('#accountEmail').textContent = user.email || '';
}

function stopBoardListener() {
  boardGeneration += 1;
  if (unsubscribeBoard) unsubscribeBoard();
  unsubscribeBoard = null;
  boardRef = null;
  tasks = [];
  breakingTaskId = null;
  subtaskErrors.clear();
  pendingWrites = 0;
  writeQueue = Promise.resolve();
}

function isTask(task) {
  return task &&
    typeof task.id === 'string' &&
    typeof task.title === 'string' &&
    typeof task.desc === 'string' &&
    COLUMNS.includes(task.status) &&
    Number.isFinite(task.createdAt) &&
    (task.subtasks === undefined || (
      Array.isArray(task.subtasks) &&
      task.subtasks.every(item =>
        item &&
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        typeof item.done === 'boolean'
      )
    ));
}

async function openBoard(user) {
  stopBoardListener();
  const generation = boardGeneration;
  boardRef = doc(db, 'boards', user.uid);
  setSyncStatus('Conectando ao quadro…');

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(boardRef);
    if (!snapshot.exists()) {
      transaction.set(boardRef, {
        name: 'Meu quadro',
        ownerId: user.uid,
        tasks: [],
        columns: COLUMNS.map(id => ({ id, name: LABELS[id] })),
        wipLimits: {}
      });
    }
  });

  if (generation !== boardGeneration) return;
  unsubscribeBoard = onSnapshot(boardRef, snapshot => {
    if (generation !== boardGeneration) return;
    if (!snapshot.exists()) {
      setSyncStatus('O quadro não foi encontrado. Saia e entre novamente.', true);
      return;
    }
    const remoteTasks = snapshot.data().tasks;
    if (!Array.isArray(remoteTasks) || !remoteTasks.every(isTask)) {
      setSyncStatus('Os dados do quadro estão em um formato inválido.', true);
      return;
    }
    if (pendingWrites > 0) return;
    tasks = remoteTasks;
    render();
    setSyncStatus('Sincronizado');
  }, error => {
    if (generation !== boardGeneration) return;
    showBoardError(error);
  });
}

function persistTasks() {
  if (!boardRef) {
    setSyncStatus('Não há uma conta conectada para salvar as tarefas.', true);
    return;
  }
  const targetRef = boardRef;
  const generation = boardGeneration;
  const savedTasks = tasks.map(task => ({ ...task }));
  pendingWrites += 1;
  setSyncStatus('Salvando…');
  writeQueue = writeQueue
    .then(() => updateDoc(targetRef, { tasks: savedTasks }))
    .then(() => {
      if (generation !== boardGeneration) return;
      pendingWrites -= 1;
      if (pendingWrites === 0) setSyncStatus('Sincronizado');
    })
    .catch(error => {
      if (generation !== boardGeneration) return;
      pendingWrites -= 1;
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
    if (authMode === 'create') {
      await createUserWithEmailAndPassword(auth, email, password);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    setLoginMessage('');
  } catch (error) {
    setLoginMessage(authErrorMessage(error));
  }
});

$('#authModeToggle').addEventListener('click', () => {
  setAuthMode(authMode === 'login' ? 'create' : 'login');
});

$('#resetPassword').addEventListener('click', async () => {
  const email = $('#emailInput').value.trim().toLowerCase();
  if (!email) {
    setLoginMessage('Informe seu e-mail para receber o link de redefinição.');
    $('#emailInput').focus();
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    setLoginMessage('Se esse e-mail tiver uma conta, você receberá um link para redefinir a senha.', false);
  } catch (error) {
    setLoginMessage(authErrorMessage(error));
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  try {
    await signOut(auth);
  } catch (error) {
    setSyncStatus(`Não foi possível sair: ${error.message}`, true);
  }
});

onAuthStateChanged(auth, user => {
  if (!user) {
    assistantUserId = null;
    resetAssistant();
    stopBoardListener();
    setAuthenticatedView(null);
    return;
  }
  if (assistantUserId !== user.uid) {
    assistantUserId = user.uid;
    resetAssistant();
  }
  setAuthenticatedView(user);
  openBoard(user).catch(error => {
    showBoardError(error);
  });
}, error => {
  setLoginMessage(`Não foi possível verificar sua sessão: ${error.message}`);
});

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

  const heading = document.createElement('h3');
  heading.textContent = task.title;
  element.append(heading);

  if (task.desc) {
    const description = document.createElement('p');
    description.textContent = task.desc;
    element.append(description);
  }

  const taskTools = document.createElement('div');
  taskTools.className = 'task-tools';
  if (task.subtasks && task.subtasks.length) {
    const checklist = document.createElement('ul');
    checklist.className = 'subtask-list';
    task.subtasks.forEach((subtask, index) => {
      const item = document.createElement('li');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = subtask.done;
      checkbox.setAttribute('aria-label', `Concluir subtarefa: ${subtask.title}`);
      checkbox.addEventListener('change', () => {
        task.subtasks[index].done = checkbox.checked;
        render();
        persistTasks();
      });
      const label = document.createElement('span');
      label.textContent = subtask.title;
      if (subtask.done) label.className = 'is-complete';
      item.append(checkbox, label);
      checklist.append(item);
    });
    taskTools.append(checklist);
  }
  const splitButton = document.createElement('button');
  splitButton.type = 'button';
  splitButton.className = 'btn-breakdown';
  splitButton.disabled = Boolean(breakingTaskId);
  splitButton.textContent = breakingTaskId === task.id
    ? 'Criando checklist…'
    : task.subtasks && task.subtasks.length
      ? 'Refazer checklist com IA'
      : 'Quebrar em subtarefas';
  splitButton.setAttribute('aria-label', `Gerar checklist para a tarefa: ${task.title}`);
  splitButton.addEventListener('click', () => breakTaskIntoSubtasks(task.id));
  taskTools.append(splitButton);
  if (subtaskErrors.has(task.id)) {
    const error = document.createElement('p');
    error.className = 'task-ai-error';
    error.textContent = subtaskErrors.get(task.id);
    taskTools.append(error);
  }
  element.append(taskTools);

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

  element.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    const bounds = element.getBoundingClientRect();
    element.style.setProperty('--pointer-x', `${event.clientX - bounds.left}px`);
    element.style.setProperty('--pointer-y', `${event.clientY - bounds.top}px`);
  });
  element.addEventListener('pointerleave', () => {
    element.style.removeProperty('--pointer-x');
    element.style.removeProperty('--pointer-y');
  });

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

async function postAIRequest(path, payload) {
  const user = auth.currentUser;
  if (!user) throw new Error('Entre na sua conta para usar o assistente.');
  const token = await user.getIdToken();
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('O servidor do assistente retornou uma resposta inválida.');
  }
  if (!response.ok) throw new Error(data.error || `Falha no assistente (HTTP ${response.status}).`);
  return data;
}

function appendChatMessage(text, role) {
  const message = document.createElement('div');
  message.className = `chat-bubble ${role}-bubble`;
  message.textContent = text;
  assistantMessages.append(message);
  assistantMessages.scrollTop = assistantMessages.scrollHeight;
  return message;
}

async function sendAssistantQuestion(question) {
  const cleanQuestion = question.trim();
  if (!cleanQuestion || assistantBusy) return;
  const generation = assistantGeneration;
  assistantBusy = true;
  assistantSend.disabled = true;
  $('#assistantSuggestions').hidden = true;
  assistantInput.value = '';
  appendChatMessage(cleanQuestion, 'user');
  const pendingMessage = appendChatMessage('Consultando as tarefas do seu quadro…', 'assistant');
  pendingMessage.classList.add('is-pending');
  try {
    const result = await postAIRequest('/api/ai/chat', { question: cleanQuestion });
    if (typeof result.answer !== 'string' || !result.answer.trim()) {
      throw new Error('O assistente não retornou uma resposta válida. Tente novamente.');
    }
    pendingMessage.textContent = result.answer;
    pendingMessage.classList.remove('is-pending');
  } catch (error) {
    pendingMessage.classList.remove('is-pending');
    pendingMessage.classList.add('is-error');
    pendingMessage.textContent = error instanceof TypeError
      ? 'Não foi possível acessar o servidor do assistente. Verifique a publicação no Render.'
      : error.message;
  } finally {
    if (generation === assistantGeneration) {
      assistantBusy = false;
      assistantSend.disabled = false;
      assistantInput.focus();
      assistantMessages.scrollTop = assistantMessages.scrollHeight;
    }
  }
}

async function breakTaskIntoSubtasks(taskId) {
  const task = tasks.find(item => item.id === taskId);
  if (!task || breakingTaskId) return;
  const generation = boardGeneration;
  breakingTaskId = taskId;
  subtaskErrors.delete(taskId);
  render();
  try {
    const result = await postAIRequest('/api/ai/subtasks', { taskId });
    if (generation !== boardGeneration) return;
    if (!Array.isArray(result.subtasks) || result.subtasks.length < 3 || result.subtasks.length > 8 ||
        !result.subtasks.every(title => typeof title === 'string' && title.trim())) {
      throw new Error('O assistente retornou um checklist inválido. Tente novamente.');
    }
    const latestTask = tasks.find(item => item.id === taskId);
    if (!latestTask) throw new Error('Esta tarefa não está mais no quadro.');
    latestTask.subtasks = result.subtasks.map(title => ({
      id: uid(),
      title: title.trim(),
      done: false
    }));
    render();
    persistTasks();
  } catch (error) {
    if (generation !== boardGeneration) return;
    subtaskErrors.set(taskId, error instanceof TypeError
      ? 'Não foi possível acessar o servidor do assistente.'
      : error.message);
  } finally {
    if (generation === boardGeneration) {
      breakingTaskId = null;
      render();
    }
  }
}

function resetAssistant() {
  assistantGeneration += 1;
  assistantBusy = false;
  assistantPanel.hidden = true;
  assistantLauncher.hidden = false;
  assistantLauncher.setAttribute('aria-expanded', 'false');
  assistantSend.disabled = false;
  assistantInput.value = '';
  assistantMessages.replaceChildren();
  appendChatMessage(
    'Oi! Posso ajudar a entender o que está acontecendo no seu quadro. Minhas respostas usam apenas as tarefas salvas nele.',
    'assistant'
  );
  const suggestions = document.createElement('div');
  suggestions.className = 'assistant-suggestions';
  suggestions.id = 'assistantSuggestions';
  [
    ['O que está travado?', 'O que está em andamento e parece travado?'],
    ['O que falta lançar?', 'O que falta lançar no quadro?'],
    ['Quem tem mais tarefas?', 'Quem tem mais tarefas?']
  ].forEach(([label, prompt]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.prompt = prompt;
    button.textContent = label;
    suggestions.append(button);
  });
  assistantMessages.append(suggestions);
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
assistantLauncher.addEventListener('click', () => {
  assistantPanel.hidden = false;
  assistantLauncher.hidden = true;
  assistantLauncher.setAttribute('aria-expanded', 'true');
  assistantInput.focus();
});
$('#assistantClose').addEventListener('click', () => {
  assistantPanel.hidden = true;
  assistantLauncher.hidden = false;
  assistantLauncher.setAttribute('aria-expanded', 'false');
  assistantLauncher.focus();
});
$('#assistantForm').addEventListener('submit', event => {
  event.preventDefault();
  sendAssistantQuestion(assistantInput.value);
});
assistantMessages.addEventListener('click', event => {
  const suggestion = event.target.closest('[data-prompt]');
  if (suggestion) sendAssistantQuestion(suggestion.dataset.prompt);
});
form.addEventListener('submit', event => {
  event.preventDefault();
  const title = $('#titleInput').value.trim();
  if (!title) return;
  addTask(title, $('#descInput').value.trim());
  modal.close();
});
