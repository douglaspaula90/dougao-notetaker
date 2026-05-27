# DougãoCast — Extensão Chrome

Captura áudio da aba do Google Meet via `chrome.tabCapture` e envia para o backend Dougão Notetaker.

Resolve o problema da gravação via PulseAudio no bot headless (que vinha em silêncio) capturando direto na aba do Chrome em vez de no sistema operacional do container.

## Instalar (modo dev)

1. Abra `chrome://extensions/`
2. Ative **"Modo de desenvolvedor"** (canto superior direito)
3. Clique em **"Carregar sem compactação"**
4. Selecione a pasta `extension/` deste repo
5. Fixe a extensão na barra (alfinete)

## Uso

1. Entre em uma reunião no Google Meet
2. Clique no ícone da extensão
3. (Opcional) Edite o nome da reunião no campo
4. Clique em **"⏺ Iniciar Gravação"**
5. Ao fim da reunião, clique em **"⏹ Finalizar e Enviar"**
6. A extensão faz upload para `/api/audio/upload` do backend

Se você fechar a aba do Meet antes de parar manualmente, a extensão detecta e envia automaticamente.

## Configuração de URL

Os defaults apontam para a VPS de produção (ambos via frontend nginx, que faz proxy de `/api` pro backend interno):

- API: `http://187.77.56.193:3010/api`
- Dashboard: `http://187.77.56.193:3010`

Para sobrescrever (ex: rodar contra `localhost` em dev), abra o DevTools do service worker da extensão (`chrome://extensions/` → "Service worker") e rode:

```js
chrome.storage.local.set({
  apiBase: "http://localhost:8000/api",
  dashboardUrl: "http://localhost:3010"
});
```

## Pré-requisitos do backend

O backend NÃO precisa estar exposto externamente. A extensão chama `http://VPS:3010/api/...` e o nginx do frontend faz proxy interno para `http://backend:8000/api/...`. A porta 3010 já está exposta pelo Coolify.

CORS já está liberado no backend (`allow_origins=["*"]` em `backend/main.py`).

## Limitações conhecidas

- Sem ícones customizados ainda (Chrome mostra o padrão cinza)
- Sem auth — qualquer instalação da extensão consegue enviar áudio se conhecer a URL
- Streaming em tempo real ainda não implementado (issue SAL-94); por enquanto envia o blob completo no final
