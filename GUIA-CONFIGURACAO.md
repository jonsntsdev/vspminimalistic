# vspminimalist: configuração e publicação

O app usa Firebase Authentication e Cloud Firestore. O chat e a criação de checklists com IA passam pelo backend deste projeto; a chave do Gemini fica somente no ambiente do servidor, nunca no navegador.

## Preparar o Firebase

1. No [Firebase Console](https://console.firebase.google.com/), crie um projeto ou use um projeto existente.
2. Em **Authentication > Método de login**, ative **E-mail/senha**.
3. Em **Firestore Database**, crie o banco em **modo de produção**.
4. Confira se `firebase-config.js` contém os dados do app Web. Essa configuração identifica o projeto; não coloque nela chaves privadas ou senhas.
5. Em **Firestore Database > Regras**, publique o conteúdo de `firestore.rules`.
6. Em **Authentication > Configurações > Domínios autorizados**, adicione o domínio em que o app será publicado.

O app cria um documento em `boards/{uid}` no primeiro acesso autenticado. O backend valida o token do Firebase e consulta somente o quadro associado ao usuário autenticado.

## Configurar a IA

Crie uma chave do Gemini no Google AI Studio. No ambiente do servidor, configure:

- `GEMINI_API_KEY`: chave do Gemini, mantida como segredo.
- `FIREBASE_SERVICE_ACCOUNT`: conteúdo JSON de uma conta de serviço do projeto Firebase, mantido como segredo.
- `GEMINI_MODEL`: opcional; o padrão é `gemini-2.5-flash`.

O chat envia ao Gemini apenas título, descrição, status e checklist das tarefas do quadro autenticado. Não envie essas chaves pelo chat, não as coloque em `firebase-config.js` e não as versione no Git.

## Testar localmente

Instale Python 3.10 ou superior e execute:

```text
pip install -r requirements.txt
python server.py
```

Abra `http://localhost:5000`. Para testar o chat localmente, configure as mesmas variáveis de ambiente do servidor antes de iniciar o app. Sem as credenciais de backend, a interface e o quadro continuam disponíveis, mas as rotas de IA informam que falta configuração.

## Publicar no Render

Publique como **Web Service**, não como Static Site:

O repositório inclui `render.yaml`. No painel Render, use **New > Blueprint**, conecte o mesmo repositório e aplique o Blueprint. Ele cria um novo Web Service chamado `vspminimalist-web`. Mantenha o Static Site atual até confirmar que o novo serviço está funcionando; não tente executar o backend como Static Site.

Se criar o serviço manualmente, selecione runtime **Python**, Build Command `pip install -r requirements.txt` e Start Command `gunicorn server:app --workers 1 --threads 4 --timeout 40`.

Depois do deploy:

1. Em **Environment**, adicione `FIREBASE_SERVICE_ACCOUNT` como segredo. Adicione `GEMINI_API_KEY` quando tiver uma chave do Gemini. `GEMINI_MODEL` é opcional.
2. Adicione o novo domínio `onrender.com` aos domínios autorizados no Firebase Authentication.
3. Use `/api/health` como health check, se desejar.

Para criar `FIREBASE_SERVICE_ACCOUNT`, gere uma chave de conta de serviço no projeto Firebase/Google Cloud e cole o JSON diretamente no campo secreto do Render. Não salve esse arquivo no repositório. Restrinja a conta às permissões de Firestore necessárias para ler os quadros.

## Recursos do Kanban com IA

- **Pergunte ao seu projeto**: consulta as tarefas reais do quadro e responde sem inventar informações ausentes.
- **Quebrar em subtarefas**: o botão em cada card gera um checklist editável, salvo junto com a tarefa no Firestore.
- As rotas de IA exigem um token válido do Firebase e limitam o volume de perguntas por usuário.

## Solução de problemas

- **`auth/operation-not-allowed`**: ative o provedor E-mail/senha no Firebase Authentication.
- **`auth/unauthorized-domain`**: adicione o domínio publicado à lista de domínios autorizados.
- **`Cloud Firestore API has not been used` ou API desativada**: abra [a página da API Firestore do projeto](https://console.cloud.google.com/apis/api/firestore.googleapis.com/overview?project=meu-quadro-kanban-c340c) e clique em **Ativar**. Confirme também que o banco foi criado em **Firestore Database** no Firebase Console; aguarde alguns minutos e recarregue o app. A hospedagem no Render não ativa APIs do projeto Google Cloud.
- **Erro de `FIREBASE_SERVICE_ACCOUNT`**: confira se o JSON completo está configurado como segredo e corresponde ao mesmo projeto do app.
- **IA informa que falta configuração**: adicione `GEMINI_API_KEY` e `FIREBASE_SERVICE_ACCOUNT` nas variáveis do serviço Render e faça um novo deploy.
- **Falha ao carregar ou salvar tarefas**: confira as regras de `firestore.rules` e se o Firestore está ativo no projeto indicado em `firebase-config.js`.
