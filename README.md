# Copa Presidio

Sistema mobile-first para organizar a Copa Presidio da Etec Engenheiro Agronomo Narciso de Medeiros.

## Como rodar

```bash
npm install
npm start
```

Depois abra:

```txt
http://localhost:3000
```

## Configuracao segura

As credenciais e chaves ficam no arquivo `.env`. Use o `.env.example` como modelo no deploy.

Variaveis principais:

```txt
NODE_ENV=production
PORT=3000
JWT_SECRET=uma-chave-longa-e-aleatoria
DB_PATH=database/copa_presidio.sqlite
ADMIN_ACCESS_CODE=seu-codigo-admin
ADMIN_PASSWORD=sua-senha-admin
CORS_ORIGIN=https://seudominio.com.br
DATA_ENCRYPTION_KEY=chave-base64-de-32-bytes
```

Antes de publicar, troque `ADMIN_ACCESS_CODE`, `ADMIN_PASSWORD`, `JWT_SECRET` e `DATA_ENCRYPTION_KEY` por valores novos no painel da hospedagem.

## Banco de dados

O banco SQLite e criado automaticamente em:

```txt
database/copa_presidio.sqlite
```

O modelo do banco esta em:

```txt
database/schema.sql
```

O arquivo `.env` e o banco SQLite estao no `.gitignore` para evitar vazamento de segredos e dados.

## Login admin local

O `.env` local mantem o login antigo para teste:

```txt
Codigo administrativo: 132217
Senha: EtecADM2002
```

Nao use essa senha em producao.
