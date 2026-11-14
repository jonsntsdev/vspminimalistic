# vspminimalist: configuração e publicação

O app usa Firebase Authentication para contas e Cloud Firestore para salvar as tarefas. Não há conta de demonstração nem dados de exemplo: cada pessoa cria a própria conta e recebe um quadro vazio.

## Preparar o Firebase

1. No [Firebase Console](https://console.firebase.google.com/), crie um projeto ou use um projeto existente.
2. Em **Authentication > Método de login**, ative **E-mail/senha**.
3. Em **Firestore Database**, crie o banco em **modo de produção**.
4. Registre um app Web e confira se `firebase-config.js` contém os dados do app. A configuração Web identifica o projeto; nunca coloque chaves privadas ou senhas nesse arquivo.
5. Em **Firestore Database > Regras**, publique o conteúdo de `firestore.rules`.
6. Em **Authentication > Configurações > Domínios autorizados**, adicione o domínio em que o app será publicado.

O app cria um documento em `boards/{uid}` no primeiro acesso autenticado. As regras permitem ao usuário acessar somente o próprio quadro. Não é necessário criar coleções manualmente.

## Testar localmente

Abra a pasta no VS Code e inicie um servidor estático, por exemplo com a extensão Live Server. O app usa módulos JavaScript e não funciona ao abrir `index.html` diretamente como arquivo.

1. Crie uma conta com e-mail e senha de pelo menos 8 caracteres.
2. Adicione tarefas, mova-as entre as colunas e recarregue a página para confirmar que foram salvas.
3. Saia e entre novamente para confirmar que o quadro está associado à conta.

## Publicar no Render

1. Envie os arquivos do projeto para um repositório Git.
2. No Render, crie um **Static Site** conectado ao repositório.
3. Defina o diretório de publicação como `.` (raiz do projeto); não é necessário comando de build.
4. Depois da publicação, adicione o domínio `onrender.com` do site à lista de domínios autorizados do Firebase Authentication.

Se usar um domínio personalizado, autorize esse domínio no Firebase também.

## Solução de problemas

- **`auth/operation-not-allowed`**: ative o provedor E-mail/senha no Firebase Authentication.
- **`auth/unauthorized-domain`**: adicione o domínio publicado à lista de domínios autorizados do Firebase.
- **Falha ao carregar ou salvar o quadro**: confira se as regras de `firestore.rules` foram publicadas e se o Firestore foi criado no projeto indicado em `firebase-config.js`.
- **Módulos não carregam**: acesse o app por um servidor HTTP/HTTPS, não por `file://`.
