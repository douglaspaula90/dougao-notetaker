# 🎙️ Dougao Notetaker

**Meeting Intelligence para Google Meet** — o bot entra automaticamente nas reuniões da sua agenda, transcreve com identificação de speakers, gera resumo e acionáveis, e envia tudo por email.

## Como funciona

```
Google Calendar
        ↓  detecta reunião 2 min antes
   Bot abre Chrome headless na VPS
        ↓  entra no Meet como "Dougao Notetaker 🎙️"
   Grava áudio via PulseAudio virtual
        ↓
   Whisper API → transcrição | pyannote → speakers | GPT-4o mini → resumo
        ↓
   Dashboard web + Email com resumo e acionáveis
```

## Funcionalidades

- **Gravação automática** — bot monitora Google Calendar e entra nas reuniões
- **Gravação manual** — extensão Chrome para gravar diretamente no Meet
- **Transcrição** — Whisper API com identificação de speakers (pyannote)
- **Resumo inteligente** — GPT-4o mini gera resumo executivo, tópicos, decisões e acionáveis
- **Email pós-reunião** — resumo e acionáveis enviados automaticamente por email (SMTP)
- **Busca** — pesquise reuniões por nome, palavra-chave ou participante
- **Autenticação** — acesso protegido por API key
- **Dashboard** — interface web completa com tema dark

## Pré-requisitos

- VPS com Docker (Coolify recomendado)
- Conta Google para o bot (ex: dougaonotetaker@gmail.com)
- Créditos OpenAI (platform.openai.com)
- Conta HuggingFace gratuita (huggingface.co)
- (Opcional) Conta Gmail com App Password para envio de emails

## Setup — Passo a Passo

### 1. Aceitar modelo pyannote (gratuito, 1 vez)
- https://huggingface.co/pyannote/speaker-diarization-3.1 → "Agree and access"
- https://huggingface.co/pyannote/segmentation-3.0 → "Agree and access"
- https://huggingface.co/settings/tokens → Create token (Read)

### 2. Autorizar Google Calendar (na sua máquina local)

**a.** Google Cloud Console (console.cloud.google.com):
- Novo projeto "Dougao Notetaker"
- Enable APIs → Google Calendar API
- Credentials → OAuth 2.0 Client ID → Desktop app → Download JSON → salve como credentials.json

**b.** Rode localmente:
```bash
cd bot/
pip install google-auth-oauthlib google-api-python-client
python google_auth.py
```
Abre o browser → login com sua conta → autoriza → gera token.json

**c.** Copie para a VPS:
```bash
scp credentials.json token.json usuario@SUA_VPS:/var/lib/docker/volumes/dougao_dougao-data/_data/
```

### 3. Variáveis de ambiente
```bash
cp .env.example .env
```
Preencha todas as variáveis. Veja o `.env.example` para detalhes.

**Variáveis obrigatórias:**
- `OPENAI_API_KEY` — chave da API OpenAI
- `HUGGINGFACE_TOKEN` — token do HuggingFace (gratuito)
- `BOT_GOOGLE_EMAIL` / `BOT_GOOGLE_PASSWORD` — conta do bot

**Variáveis opcionais:**
- `APP_API_KEY` — chave de acesso à plataforma (se vazio, acesso livre)
- `SMTP_*` — configurações SMTP para envio de emails pós-reunião
- `NOTIFICATION_EMAIL` — email(s) destino dos resumos

### 4. Deploy
```bash
docker compose up -d
```
Ou via Coolify: adicione docker-compose.yml, variáveis de ambiente, domínio → porta 3010.

## Custo estimado
| Reunião | Total |
|---|---|
| 30 min | ~$0,19 |
| 1 hora | ~$0,38 |
| 2 horas | ~$0,76 |

## Stack

| Componente | Tecnologia |
|---|---|
| Backend | Python, FastAPI, SQLite |
| Frontend | React, Vite, Nginx |
| Bot | pyppeteer (Chromium), PulseAudio, ffmpeg |
| Transcrição | OpenAI Whisper API |
| Diarização | pyannote.audio |
| Resumo | GPT-4o mini |
| Email | SMTP (Gmail App Password) |
| Deploy | Docker Compose |

## Nota LGPD
Informe os participantes que a reunião está sendo gravada. A conta do bot aparece visivelmente como participante — assim como Fireflies/tl;dv fazem.
