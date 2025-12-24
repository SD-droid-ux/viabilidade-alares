# 🚀 Guia para Rodar no Replit

## Instalação Inicial

### 1. Instalar dependências do Backend
```bash
cd backend
npm install
cd ..
```

### 2. Instalar dependências do Frontend
```bash
cd frontend
npm install
cd ..
```

## Como Rodar

### Opção 1: Rodar tudo junto (recomendado)
```bash
cd frontend
npm run dev
```

Isso vai iniciar tanto o frontend quanto o backend automaticamente.

### Opção 2: Rodar separadamente (se a opção 1 não funcionar)

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev:frontend
```

## Configuração no Replit

### Variáveis de Ambiente

No Replit, configure as seguintes variáveis de ambiente (Secrets):

**Backend:**
- `PORT`: `3000` (ou a porta que o Replit atribuir)
- `FRONTEND_URL`: URL do seu frontend no Replit

**Frontend:**
- `VITE_API_URL`: URL completa do backend (ex: `https://seu-backend.replit.dev:3000`)
- `VITE_GOOGLE_MAPS_API_KEY`: Sua chave da API do Google Maps

## Estrutura de Pastas no Replit

```
workspace/
├── backend/
│   ├── data/          # Arquivos Excel serão salvos aqui
│   ├── server.js
│   └── package.json
└── frontend/
    ├── src/
    ├── package.json
    └── vite.config.js
```

## Troubleshooting

### Erro: "concurrently: not found"
```bash
cd frontend
npm install
```

### Erro: "Cannot find module"
Certifique-se de que instalou as dependências em ambas as pastas:
```bash
cd backend && npm install && cd ../frontend && npm install
```

### Backend não inicia
Verifique se a porta está disponível e se as variáveis de ambiente estão configuradas.

### Frontend não conecta ao backend
Verifique se o `VITE_API_URL` está configurado corretamente com a URL completa do backend.

