# edgekanbann: configuração com Neon

O aplicativo usa PostgreSQL/Neon para contas, sessões e quadros. As senhas são armazenadas com bcrypt e as sessões usam cookie HTTP-only.

## Variáveis de ambiente

- `DATABASE_URL`: string de conexão do projeto Neon.
- `SESSION_SECRET`: texto aleatório longo usado para proteger os IDs das sessões.
- `AI_PROVIDER`: `gemini` (padrão) ou `openai`.
- `AI_API_KEY`: chave do provedor de IA.
- `AI_MODEL`: opcional.

As tabelas `users`, `sessions` e `boards` são criadas automaticamente na inicialização.

## Testar localmente

```powershell
npm install
$env:DATABASE_URL = "postgresql://..."
$env:SESSION_SECRET = "gere-um-segredo-aleatorio-longo"
$env:AI_PROVIDER = "gemini"
$env:AI_API_KEY = "sua-chave"
npm start
```

Acesse `http://localhost:3000` e `/healthz`.

## Publicar no Render

1. Conecte o repositório e use o Blueprint `render.yaml`.
2. Informe `DATABASE_URL` com a conexão do projeto Neon `vspminimalist-render`.
3. Informe `SESSION_SECRET` e `AI_API_KEY`.
4. A implantação executará `npm install` e `npm start`.
