# 🏗️ Viabilidade Alares - Engenharia

Sistema de análise de viabilidade técnica para identificação de CTOs (Centros de Telecomunicações Ópticas) próximas a endereços de clientes.

## 🚀 Tecnologias

- **Frontend**: Svelte + Vite
- **Backend**: Node.js + Express
- **Maps**: Google Maps API
- **Dados**: Excel (XLSX)

## 📋 Funcionalidades

- ✅ Busca de CTOs por endereço ou coordenadas
- ✅ Visualização em mapa com rotas reais
- ✅ Geração de relatórios em PDF
- ✅ Gerenciamento de projetistas
- ✅ Sistema de autenticação
- ✅ Suporte a múltiplos usuários simultâneos
- ✅ Upload e gerenciamento de base de dados

## 🛠️ Instalação Local

### Pré-requisitos
- Node.js 18+
- NPM ou Yarn

### Backend

```bash
cd backend
npm install
npm start
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## 🌐 Deploy

Veja o arquivo [DEPLOY.md](./DEPLOY.md) para instruções detalhadas de deploy.

**Recomendação**: Railway para full-stack ou Vercel (frontend) + Railway (backend)

## 📝 Variáveis de Ambiente

### Backend
- `PORT`: Porta do servidor (padrão: 3001)
- `GOOGLE_MAPS_API_KEY`: Chave da API do Google Maps

### Frontend
- `VITE_GOOGLE_MAPS_API_KEY`: Chave da API do Google Maps
- `VITE_API_URL`: URL do backend (em produção)

## 📁 Estrutura

```
projeto/
├── backend/
│   ├── data/          # Arquivos Excel (projetistas, CTOs, VI ALAs)
│   ├── server.js      # Servidor Express
│   └── package.json
├── frontend/
│   ├── src/           # Componentes Svelte
│   ├── public/        # Arquivos estáticos
│   └── package.json
└── DEPLOY.md          # Guia de deploy
```

## 🔒 Segurança

- Senhas são armazenadas com hash (bcrypt)
- Sistema de locks para prevenir race conditions
- CORS configurado para produção

## 📄 Licença

Proprietário - Alares Engenharia


