# 🚀 Guia de Deploy - Viabilidade Alares

## Opção Recomendada: Railway (Full-Stack)

### Por que Railway?
- ✅ Suporta sistema de arquivos persistente (necessário para Excel)
- ✅ Deploy simples de frontend e backend juntos
- ✅ Plano gratuito generoso
- ✅ Servidor sempre ativo (não serverless)

---

## 📋 Pré-requisitos

1. Conta no [Railway](https://railway.app) (gratuita)
2. Conta no [Google Cloud](https://console.cloud.google.com) para API Key do Maps
3. Git configurado

---

## 🔧 Passo a Passo - Deploy no Railway

### 1. Preparar o Repositório Git

```bash
# Inicializar git (se ainda não tiver)
git init
git add .
git commit -m "Preparar para deploy"
```

### 2. Criar Projeto no Railway

1. Acesse [railway.app](https://railway.app)
2. Faça login com GitHub
3. Clique em "New Project"
4. Selecione "Deploy from GitHub repo"
5. Conecte seu repositório

### 3. Configurar Backend

1. No Railway, adicione um novo serviço: "Empty Service"
2. Renomeie para "backend"
3. Configure:
   - **Root Directory**: `backend`
   - **Start Command**: `npm start`
   - **Build Command**: (deixe vazio, Railway detecta automaticamente)

4. **Variáveis de Ambiente** (Settings → Variables):
   ```
   PORT=3001
   GOOGLE_MAPS_API_KEY=sua_chave_do_google_maps
   NODE_ENV=production
   ```

5. **Volumes Persistentes** (Settings → Volumes):
   - Adicione um volume em `/app/data`
   - Isso garante que os arquivos Excel sejam persistidos

### 4. Configurar Frontend

1. Adicione outro serviço: "Empty Service"
2. Renomeie para "frontend"
3. Configure:
   - **Root Directory**: `frontend`
   - **Start Command**: `npm start` (já configurado no package.json)
   - **Build Command**: (deixe vazio, Railway detecta automaticamente)

4. **Variáveis de Ambiente**:
   ```
   VITE_GOOGLE_MAPS_API_KEY=sua_chave_do_google_maps
   VITE_API_URL=https://seu-backend.railway.app
   PORT=3000
   ```
   
   **IMPORTANTE**: Substitua `https://seu-backend.railway.app` pela URL real do seu backend (encontrada em Settings → Domains do serviço backend)

5. **Dependências**:
   - O `serve` já está configurado no package.json

### 5. Configurar Domínio

1. No serviço do frontend, vá em Settings → Domains
2. Adicione um domínio customizado ou use o domínio Railway fornecido
3. No serviço do backend, anote a URL (ex: `https://backend-production-xxxx.up.railway.app`)

### 6. Configurar CORS no Backend

1. O backend já está configurado para aceitar requisições de qualquer origem em desenvolvimento
2. Em produção, configure a variável de ambiente no backend:
   ```
   FRONTEND_URL=https://seu-frontend.railway.app
   ```
   Isso restringirá o CORS apenas ao domínio do frontend (mais seguro)

---

## 🔄 Alternativa: Vercel (Frontend) + Railway (Backend)

### Por que separar?
- ✅ Vercel oferece CDN global para o frontend (mais rápido)
- ✅ Railway mantém o backend com sistema de arquivos
- ✅ Deploy independente de cada parte

### Frontend no Vercel:

1. Acesse [vercel.com](https://vercel.com)
2. Faça login com GitHub
3. Clique em "Add New Project"
4. Importe seu repositório
5. Configure:
   - **Framework Preset**: Vite
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`

6. **Variáveis de Ambiente**:
   ```
   VITE_GOOGLE_MAPS_API_KEY=sua_chave_do_google_maps
   VITE_API_URL=https://seu-backend.railway.app
   ```
   
   **IMPORTANTE**: Substitua pela URL real do backend no Railway

7. Deploy automático a cada push no GitHub

### Backend no Railway:

Siga os passos 3 e 5 da seção Railway acima.

---

## 🛠️ Arquivos de Configuração Criados

- `railway.json` - Configuração do Railway
- `backend/railway.json` - Configuração específica do backend
- `backend/.env.example` - Exemplo de variáveis de ambiente
- `frontend/.env.example` - Exemplo de variáveis de ambiente

---

## ⚠️ Importante

1. **Google Maps API**: Configure restrições de domínio na Google Cloud Console
2. **CORS**: O backend já tem CORS habilitado, mas verifique se aceita o domínio do frontend
3. **Arquivos Excel**: Os arquivos na pasta `backend/data/` serão criados automaticamente no primeiro uso
4. **Backup**: Configure backup automático dos arquivos Excel no Railway

---

## 📝 Checklist Final

- [ ] Backend rodando no Railway
- [ ] Frontend rodando no Railway/Vercel
- [ ] Variáveis de ambiente configuradas
- [ ] Volume persistente configurado no backend
- [ ] Domínio configurado
- [ ] Google Maps API Key configurada
- [ ] CORS configurado corretamente
- [ ] Teste de login funcionando
- [ ] Teste de upload de base funcionando

---

## 🆘 Troubleshooting

### Backend não inicia:
- Verifique se `PORT` está configurado
- Verifique logs no Railway

### Frontend não conecta ao backend:
- Verifique `VITE_API_URL`
- Verifique CORS no backend
- Verifique se o backend está rodando

### Arquivos Excel não persistem:
- Verifique se o volume está montado em `/app/data`
- Verifique permissões de escrita

---

## 💰 Custos

- **Railway**: Plano gratuito inclui $5/mês de créditos (suficiente para desenvolvimento)
- **Vercel**: Plano gratuito generoso para frontend
- **Google Maps API**: Pay-as-you-go (primeiros $200/mês gratuitos)

