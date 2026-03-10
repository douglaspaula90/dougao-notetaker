# 🎙️ Dougao Notetaker

**Meeting Intelligence para Google Meet** — o bot entra automaticamente nas reuniões da sua agenda, transcreve com identificação de speakers, gera resumo e acionáveis.

## Como funciona

```
Google Calendar (douglas.paula@medway.com.br)
        ↓  detecta reunião 2 min antes
   Bot abre Chrome headless na VPS
        ↓  entra no Meet como "Dougao Notetaker 🎙️"
   Grava áudio via PulseAudio virtual
        ↓
   Whisper API → transcrição | pyannote → speakers | GPT-4o mini → resumo
        ↓
   Dashboard web
```

## Pré-requisitos

- VPS com Coolify (já configurado)
- Conta `dougaonotetaker@gmail.com` criada
- Créditos OpenAI (platform.openai.com)
- Conta HuggingFace gratuita (huggingface.co)

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
Abre o browser → login com douglas.paula@medway.com.br → autoriza → gera token.json

**c.** Copie para a VPS:
```bash
scp credentials.json token.json usuario@SUA_VPS:/var/lib/docker/volumes/dougao_dougao-data/_data/
```

### 3. Variáveis de ambiente
```bash
cp .env.example .env
# Preencha OPENAI_API_KEY, HUGGINGFACE_TOKEN, BOT_GOOGLE_EMAIL, BOT_GOOGLE_PASSWORD
```

### 4. Deploy no Coolify
1. Projeto "dougao-notetaker" → Docker Compose
2. Adicione as variáveis do .env
3. Domínio → porta 3010
4. Deploy 🚀

## Custo estimado
| Reunião | Total |
|---|---|
| 30 min | ~$0,19 |
| 1 hora | ~$0,38 |
| 2 horas | ~$0,76 |

## Nota LGPD
Informe os participantes que a reunião está sendo gravada. A conta dougaonotetaker@gmail.com aparece visivelmente como participante — assim como Fireflies/tl;dv fazem.
