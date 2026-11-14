# vspminimalist: configuração e publicação

O app usa o Web Service do Render para autenticação, API e interface. As contas e tarefas ficam em um PostgreSQL persistente do Render. O Firebase não é mais usado.

## Conectar o PostgreSQL do Render

1. No Render, crie um banco **PostgreSQL persistente** na mesma região do Web Service (`Oregon`). Bancos persistentes podem ter cobrança; confira o plano e o valor antes de confirmar.
2. No serviço `vspminimalist-web`, abra **Environment** e configure `DATABASE_URL` com a **Internal Database URL** do PostgreSQL.
3. Sincronize o Blueprint para gerar `SESSION_SECRET`; `SESSION_COOKIE_SECURE` e `GEMINI_MODEL` já têm valores no `render.yaml`.
4. Salve as variáveis e aguarde o deploy. O app cria as tabelas `app_users` e `boards` automaticamente na primeira chamada autenticada.

Não use armazenamento local do serviço para guardar tarefas: o disco do Web Service pode ser temporário. A conexão deve usar a URL interna do banco Render.

## Configurar a IA

Para ativar o chat e a criação de subtarefas, configure `GEMINI_API_KEY` como segredo em **Environment** no Web Service. A chave fica somente no servidor. Sem ela, login e quadro continuam disponíveis, mas as rotas de IA informam que falta configuração.

## Publicar

O Web Service `vspminimalist-web` já está conectado ao repositório. Depois de enviar os arquivos atualizados para a branch `main`, o Render fará o deploy. Use `https://vspminimalist-web.onrender.com`, não o Static Site antigo.

O health check é `/api/health`. Para uma criação manual, use runtime Python, Build Command `pip install -r requirements.txt` e Start Command `gunicorn server:app --workers 1 --threads 4 --timeout 40`.

## Testar localmente

Instale Python 3.10 ou superior, configure `DATABASE_URL` para um PostgreSQL de desenvolvimento e `SESSION_SECRET`, e execute:

```text
pip install -r requirements.txt
python server.py
```

O servidor não persiste usuários ou tarefas sem `DATABASE_URL`; não há fallback silencioso para armazenamento local.

## Contas e dados

Este app agora cria contas novas no PostgreSQL. Contas, senhas e tarefas do Firebase antigo não são copiadas. Cada usuário precisa se cadastrar novamente; a redefinição de senha por e-mail ainda não está configurada.

## Recursos do Kanban

- **Pergunte ao seu projeto**: consulta as tarefas da conta autenticada e responde sem inventar informações ausentes.
- **Quebrar em subtarefas**: gera um checklist que é salvo com a tarefa.
- **Compartilhar tarefa**: abre o menu nativo do dispositivo ou copia título e descrição. Isso não cria um link público nem concede acesso ao quadro.
- As rotas de autenticação limitam tentativas por IP; as rotas de IA limitam solicitações por usuário.

## Solução de problemas

- **`Configure DATABASE_URL`**: crie um PostgreSQL persistente no Render e use a Internal Database URL no Web Service.
- **Erro de conexão ao banco**: confirme que o PostgreSQL e o Web Service estão na mesma região e que `DATABASE_URL` é a URL interna correta.
- **Sessão inválida após deploy**: confirme que `SESSION_SECRET` está definido no Render e não foi alterado entre deploys.
- **IA informa que falta configuração**: adicione `GEMINI_API_KEY` em Environment no Render.
- **A tela ainda fala de Firestore ou Firebase**: abra `https://vspminimalist-web.onrender.com` após o deploy da versão migrada; o Static Site antigo ainda pode servir o código anterior.
