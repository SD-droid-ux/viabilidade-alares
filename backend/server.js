import express from 'express';
import cors from 'cors';
import XLSX from 'xlsx';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Log de configuração para debug
console.log('🔧 [Config] PORT:', PORT);
console.log('🔧 [Config] FRONTEND_URL:', process.env.FRONTEND_URL || 'Não configurado (permitindo todas as origens)');
console.log('🔧 [Config] DATA_DIR:', process.env.DATA_DIR || './data');

// Middleware CORS - Configuração robusta para produção
// Permitir todas as origens por padrão - DEVE SER O PRIMEIRO MIDDLEWARE
app.use((req, res, next) => {
  try {
    // Log para debug
    const origin = req.headers.origin;
    console.log('🌐 [CORS] Requisição recebida de origem:', origin || 'Sem origem (Postman/curl)');
    console.log('🌐 [CORS] Método:', req.method);
    console.log('🌐 [CORS] Path:', req.path);
    
    // Permitir todas as origens - SEMPRE definir headers CORS
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Content-Length');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 horas
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Type');
    
    // Responder a requisições OPTIONS (preflight) imediatamente
    if (req.method === 'OPTIONS') {
      console.log('✅ [CORS] Preflight OPTIONS respondido para:', req.path);
      return res.status(200).end();
    }
    
    next();
  } catch (err) {
    console.error('❌ [CORS] Erro no middleware CORS:', err);
    // Mesmo com erro, tentar continuar
    next();
  }
});

// Usar também o middleware cors como backup
app.use(cors({
  origin: true, // Permitir todas as origens
  credentials: true
}));

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Middleware para logar requisições (debug)
app.use((req, res, next) => {
  console.log(`📥 [${new Date().toISOString()}] ${req.method} ${req.path}`);
  console.log(`📥 [Request] Origin: ${req.headers.origin || 'N/A'}`);
  console.log(`📥 [Request] Host: ${req.headers.host || 'N/A'}`);
  next();
});

// Configurar multer para upload de arquivos
let upload;
try {
  upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { 
      fileSize: 100 * 1024 * 1024, // 100MB limite
      files: 1,
      fields: 0
    }
  });
} catch (err) {
  console.error('❌ Erro ao configurar multer:', err);
  console.error('Certifique-se de que o multer está instalado: npm install multer');
  process.exit(1);
}

// Criar pasta data se não existir
// Permite configurar via variável de ambiente (útil para Railway volumes)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Caminhos para os arquivos Excel na pasta backend/data
const PROJETISTAS_FILE = path.join(DATA_DIR, 'projetistas.xlsx');
const BASE_CTOS_FILE = path.join(DATA_DIR, 'base.xlsx'); // Mantido para compatibilidade, mas não será mais usado
const TABULACOES_FILE = path.join(DATA_DIR, 'tabulacoes.xlsx');
const BASE_VI_ALA_FILE = path.join(DATA_DIR, 'base_VI ALA.xlsx');

// Função para formatar data no formato DD/MM/YYYY
function formatDateForFilename(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

// Função para encontrar o arquivo base_atual mais recente (assíncrona)
async function findCurrentBaseFile() {
  try {
    const files = await fsPromises.readdir(DATA_DIR);
    const baseAtualFiles = files.filter(file => 
      file.startsWith('base_atual_') && file.endsWith('.xlsx')
    );
    
    if (baseAtualFiles.length === 0) {
      return null;
    }
    
    // Ordenar por data de modificação (mais recente primeiro)
    const filesWithStats = await Promise.all(
      baseAtualFiles.map(async (file) => {
        const filePath = path.join(DATA_DIR, file);
        const stats = await fsPromises.stat(filePath);
        return {
          name: file,
          path: filePath,
          mtime: stats.mtime
        };
      })
    );
    
    filesWithStats.sort((a, b) => b.mtime - a.mtime);
    return filesWithStats[0].path;
  } catch (err) {
    console.error('Erro ao buscar arquivo base_atual:', err);
    return null;
  }
}

// Função para encontrar o arquivo backup mais recente (assíncrona)
async function findBackupBaseFile() {
  try {
    const files = await fsPromises.readdir(DATA_DIR);
    const backupFiles = files.filter(file => 
      file.startsWith('backup_') && file.endsWith('.xlsx')
    );
    
    if (backupFiles.length === 0) {
      return null;
    }
    
    // Ordenar por data de modificação (mais recente primeiro)
    const filesWithStats = await Promise.all(
      backupFiles.map(async (file) => {
        const filePath = path.join(DATA_DIR, file);
        const stats = await fsPromises.stat(filePath);
        return {
          name: file,
          path: filePath,
          mtime: stats.mtime
        };
      })
    );
    
    filesWithStats.sort((a, b) => b.mtime - a.mtime);
    return filesWithStats[0].path;
  } catch (err) {
    console.error('Erro ao buscar arquivo backup:', err);
    return null;
  }
}

// Função para obter o caminho do arquivo base atual (usa base_atual ou fallback para base.xlsx)
// Versão síncrona para uso em rotas síncronas
function getCurrentBaseFilePathSync() {
  try {
    const files = fs.readdirSync(DATA_DIR);
    const baseAtualFiles = files.filter(file => 
      file.startsWith('base_atual_') && file.endsWith('.xlsx')
    );
    
    if (baseAtualFiles.length > 0) {
      // Ordenar por data de modificação (mais recente primeiro)
      const filesWithStats = baseAtualFiles.map(file => ({
        name: file,
        path: path.join(DATA_DIR, file),
        mtime: fs.statSync(path.join(DATA_DIR, file)).mtime
      }));
      
      filesWithStats.sort((a, b) => b.mtime - a.mtime);
      return filesWithStats[0].path;
    }
  } catch (err) {
    // Ignorar erro e tentar fallback
  }
  
  // Fallback para compatibilidade com arquivo antigo
  if (fs.existsSync(BASE_CTOS_FILE)) {
    return BASE_CTOS_FILE;
  }
  return null;
}

// Função assíncrona para obter o caminho do arquivo base atual
async function getCurrentBaseFilePath() {
  const currentBase = await findCurrentBaseFile();
  if (currentBase) {
    return currentBase;
  }
  // Fallback para compatibilidade com arquivo antigo
  try {
    await fsPromises.access(BASE_CTOS_FILE);
    return BASE_CTOS_FILE;
  } catch {
    return null;
  }
}

// Armazenar sessões de usuários online (em memória)
// Formato: { 'nomeUsuario': { lastActivity: timestamp, loginTime: timestamp } }
const activeSessions = {};
// Armazenar histórico de logout (para mostrar quando ficou inativo)
// Formato: { 'nomeUsuario': { logoutTime: timestamp } }
const logoutHistory = {};
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutos de inatividade = offline

// Sistema de locks para operações críticas (prevenir race conditions)
const fileLocks = {
  projetistas: null,
  tabulacoes: null,
  vi_ala: null
};

// Função para executar operação com lock (garante execução sequencial)
async function withLock(lockName, operation) {
  const startTime = Date.now();
  const MAX_WAIT_TIME = 5000; // 5 segundos máximo de espera
  
  // Aguardar lock anterior ser liberado (com timeout)
  while (fileLocks[lockName]) {
    if (Date.now() - startTime > MAX_WAIT_TIME) {
      console.error(`❌ Timeout ao aguardar lock ${lockName} (${MAX_WAIT_TIME}ms)`);
      throw new Error(`Timeout ao aguardar lock ${lockName}`);
    }
    await fileLocks[lockName];
  }
  
  // Criar nova Promise para este lock
  let resolveLock;
  fileLocks[lockName] = new Promise(resolve => {
    resolveLock = resolve;
  });
  
  try {
    // Executar operação
    const result = await operation();
    return result;
  } catch (err) {
    console.error(`❌ Erro na operação com lock ${lockName}:`, err);
    throw err;
  } finally {
    // Liberar lock
    fileLocks[lockName] = null;
    if (resolveLock) {
      resolveLock();
    }
  }
}

// Limpar sessões inativas periodicamente
setInterval(() => {
  const now = Date.now();
  Object.keys(activeSessions).forEach(usuario => {
    if (now - activeSessions[usuario].lastActivity > SESSION_TIMEOUT) {
      // Salvar timestamp de logout antes de remover
      logoutHistory[usuario] = { logoutTime: activeSessions[usuario].lastActivity };
      delete activeSessions[usuario];
      console.log(`🔴 Usuário ${usuario} marcado como offline (timeout)`);
    }
  });
}, 60000); // Verificar a cada minuto

// Migrar arquivos da localização antiga se necessário
const OLD_PROJETISTAS = path.join(__dirname, '../frontend/public/projetistas.xlsx');
const OLD_BASE = path.join(__dirname, '../frontend/public/base.xlsx');
if (fs.existsSync(OLD_PROJETISTAS) && !fs.existsSync(PROJETISTAS_FILE)) {
  fs.copyFileSync(OLD_PROJETISTAS, PROJETISTAS_FILE);
  console.log('✅ projetistas.xlsx migrado para backend/data/');
}
if (fs.existsSync(OLD_BASE) && !fs.existsSync(BASE_CTOS_FILE)) {
  fs.copyFileSync(OLD_BASE, BASE_CTOS_FILE);
  console.log('✅ base.xlsx migrado para backend/data/');
}

// Migrar base.xlsx antigo para o novo formato base_atual_DD-MM-YYYY.xlsx se necessário
// Isso deve ser feito após as funções estarem definidas (versão assíncrona para não bloquear)
(async () => {
  try {
    if (fs.existsSync(BASE_CTOS_FILE)) {
      const currentBase = getCurrentBaseFilePathSync();
      if (!currentBase) {
        const now = new Date();
        const dateStr = formatDateForFilename(now);
        const newBaseFileName = `base_atual_${dateStr}.xlsx`;
        const newBasePath = path.join(DATA_DIR, newBaseFileName);
        await fsPromises.copyFile(BASE_CTOS_FILE, newBasePath);
        console.log(`✅ base.xlsx migrado para novo formato: ${newBaseFileName}`);
      }
    }
  } catch (err) {
    console.error('Erro ao migrar base.xlsx para novo formato:', err);
  }
})();

// Rota para servir o arquivo base.xlsx (sempre usa base_atual mais recente)
app.get('/api/base.xlsx', (req, res) => {
  try {
    const currentBasePath = getCurrentBaseFilePathSync();
    if (!currentBasePath || !fs.existsSync(currentBasePath)) {
      return res.status(404).json({ error: 'Arquivo base de dados não encontrado. Carregue uma base de dados em Configurações.' });
    }
    res.sendFile(path.resolve(currentBasePath));
  } catch (err) {
    console.error('Erro ao servir base.xlsx:', err);
    res.status(500).json({ error: 'Erro ao servir arquivo base.xlsx' });
  }
});

// Rota para obter data da última atualização da base de dados
app.get('/api/base-last-modified', async (req, res) => {
  try {
    const currentBasePath = await getCurrentBaseFilePath();
    if (!currentBasePath) {
      return res.json({
        success: false,
        error: 'Arquivo base de dados não encontrado'
      });
    }
    
    const stats = await fsPromises.stat(currentBasePath);
    const lastModified = stats.mtime;
    
    res.json({
      success: true,
      lastModified: lastModified.toISOString()
    });
  } catch (err) {
    console.error('Erro ao obter data de modificação:', err);
    res.status(500).json({
      success: false,
      error: 'Erro ao obter data de modificação'
    });
  }
});

// Função para ler projetistas do Excel
function readProjetistas() {
  try {
    if (!fs.existsSync(PROJETISTAS_FILE)) {
      console.log(`⚠️ Arquivo de projetistas não encontrado: ${PROJETISTAS_FILE}`);
      return [];
    }
    
    console.log(`📂 Carregando projetistas de: ${PROJETISTAS_FILE}`);
    
    const workbook = XLSX.readFile(PROJETISTAS_FILE);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`📊 Colunas encontradas no Excel: ${Object.keys(data[0] || {})}`);
    
    // Procurar colunas 'nome' e 'senha' (case insensitive)
    const nomeCol = data.length > 0 ? Object.keys(data[0]).find(col => col.toLowerCase().trim() === 'nome') : 'nome';
    const senhaCol = data.length > 0 ? Object.keys(data[0]).find(col => col.toLowerCase().trim() === 'senha') : 'senha';
    
    const projetistas = data
      .map(row => {
        const nome = row.nome || row.Nome || row[nomeCol] || '';
        const senha = row.senha || row.Senha || row[senhaCol] || '';
        if (nome && nome.trim() !== '') {
          return {
            nome: nome.trim(),
            senha: senha ? senha.trim() : ''
          };
        }
        return null;
      })
      .filter(p => p !== null);
    
    console.log(`✅ ${projetistas.length} projetistas carregados da base de dados`);
    if (projetistas.length > 0) {
      console.log(`📋 Projetistas: ${projetistas.map(p => p.nome).join(', ')}`);
    }
    
    return projetistas;
  } catch (err) {
    console.error('❌ Erro ao ler projetistas:', err);
    return [];
  }
}

// Função para salvar projetistas no Excel (com lock para prevenir perda de dados)
async function saveProjetistas(projetistas) {
  return await withLock('projetistas', async () => {
    try {
      // Criar dados para o Excel (com nome e senha)
      const data = projetistas.map(p => {
        if (typeof p === 'string') {
          // Compatibilidade: se for string antiga, converter para objeto
          return { nome: p, senha: '' };
        }
        return { nome: p.nome || '', senha: p.senha || '' };
      });
      
      // Criar workbook
      const worksheet = XLSX.utils.json_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Projetistas');
      
      // Salvar arquivo (atualiza a base de dados)
      XLSX.writeFile(workbook, PROJETISTAS_FILE);
      console.log(`✅ Base de dados atualizada! Projetistas salvos no Excel: ${projetistas.length} projetistas`);
      console.log(`📁 Arquivo: ${PROJETISTAS_FILE}`);
      if (projetistas.length > 0) {
        const nomes = projetistas.map(p => typeof p === 'string' ? p : p.nome).join(', ');
        console.log(`📋 Projetistas na base: ${nomes}`);
      }
    } catch (err) {
      console.error('❌ Erro ao salvar projetistas:', err);
      throw err;
    }
  });
}

// Função para ler tabulações do Excel
async function readTabulacoes() {
  try {
    if (!fs.existsSync(TABULACOES_FILE)) {
      // Valores padrão se o arquivo não existir
      const defaultTabulacoes = [
        'Aprovado Com Portas',
        'Aprovado Com Alívio de Rede/Cleanup',
        'Aprovado Prédio Não Cabeado',
        'Aprovado - Endereço não Localizado',
        'Fora da Área de Cobertura'
      ];
      await saveTabulacoes(defaultTabulacoes);
      return defaultTabulacoes;
    }
    
    console.log(`📂 Carregando tabulações de: ${TABULACOES_FILE}`);
    
    const workbook = XLSX.readFile(TABULACOES_FILE);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`📊 Colunas encontradas no Excel: ${Object.keys(data[0] || {})}`);
    
    const nomeCol = data.length > 0 ? Object.keys(data[0]).find(col => col.toLowerCase().trim() === 'nome') : 'nome';
    
    const tabulacoes = data
      .map(row => row.nome || row.Nome || row[nomeCol] || '')
      .filter(nome => nome && nome.trim() !== '')
      .map(nome => nome.trim());
    
    console.log(`✅ ${tabulacoes.length} tabulações carregadas da base de dados`);
    if (tabulacoes.length > 0) {
      console.log(`📋 Tabulações: ${tabulacoes.join(', ')}`);
    }
    
    return tabulacoes;
  } catch (err) {
    console.error('❌ Erro ao ler tabulações:', err);
    // Retornar valores padrão em caso de erro
    return [
      'Aprovado Com Portas',
      'Aprovado Com Alívio de Rede/Cleanup',
      'Aprovado Prédio Não Cabeado',
      'Aprovado - Endereço não Localizado',
      'Fora da Área de Cobertura'
    ];
  }
}

// Função para salvar tabulações no Excel
// Função para salvar tabulações no Excel (com lock para prevenir perda de dados)
async function saveTabulacoes(tabulacoes) {
  return await withLock('tabulacoes', async () => {
    try {
      // Criar dados para o Excel
      const data = tabulacoes.map(nome => ({ nome }));
      
      // Criar workbook
      const worksheet = XLSX.utils.json_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Tabulações');
      
      // Salvar arquivo (atualiza a base de dados)
      XLSX.writeFile(workbook, TABULACOES_FILE);
      console.log(`✅ Base de dados atualizada! Tabulações salvas no Excel: ${tabulacoes.length} tabulações`);
      console.log(`📁 Arquivo: ${TABULACOES_FILE}`);
      if (tabulacoes.length > 0) {
        console.log(`📋 Tabulações na base: ${tabulacoes.join(', ')}`);
      }
    } catch (err) {
      console.error('❌ Erro ao salvar tabulações:', err);
      throw err;
    }
  });
}

// Função para formatar data para DD/MM/YYYY
function formatDateForExcel(dateString) {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString; // Retornar original se não for data válida
    
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  } catch (err) {
    return dateString; // Retornar original em caso de erro
  }
}

// Função interna para verificar e criar base_VI_ALA.xlsx (sem lock, para uso interno)
async function _ensureVIALABaseInternal() {
  try {
    // Usar fsPromises para verificação assíncrona
    try {
      await fsPromises.access(BASE_VI_ALA_FILE);
      // Arquivo existe, retornar
      return true;
    } catch (accessErr) {
      // Arquivo não existe, criar
      console.log('📝 Arquivo base_VI ALA.xlsx não existe, criando...');
      
      // Criar base com colunas padrão
      const headers = [
        'VI ALA',
        'ALA',
        'DATA',
        'PROJETISTA',
        'CIDADE',
        'ENDEREÇO',
        'LATITUDE',
        'LONGITUDE'
      ];
      
      const worksheet = XLSX.utils.aoa_to_sheet([headers]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'VI ALA');
      
      // Usar writeFile síncrono (XLSX não tem versão assíncrona, mas é rápido)
      XLSX.writeFile(workbook, BASE_VI_ALA_FILE);
      console.log('✅ Base VI ALA criada com sucesso');
      return true;
    }
  } catch (err) {
    console.error('❌ Erro ao verificar/criar base VI ALA:', err);
    throw err;
  }
}

// Função para verificar e criar base_VI_ALA.xlsx se não existir (com lock para uso externo)
async function ensureVIALABase() {
  return await withLock('vi_ala', async () => {
    return await _ensureVIALABaseInternal();
  });
}

// Função interna para ler base_VI_ALA.xlsx (sem lock, para uso interno)
async function _readVIALABaseInternal() {
  try {
    if (!fs.existsSync(BASE_VI_ALA_FILE)) {
      await _ensureVIALABaseInternal();
      return [];
    }
    
    // Usar fsPromises para operações assíncronas
    const fileBuffer = await fsPromises.readFile(BASE_VI_ALA_FILE);
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    return data || [];
  } catch (err) {
    console.error('❌ Erro ao ler base VI ALA:', err);
    throw err;
  }
}

// Função para ler base_VI_ALA.xlsx (com lock para uso externo)
async function readVIALABase() {
  return await withLock('vi_ala', async () => {
    return await _readVIALABaseInternal();
  });
}

// Função para obter o próximo VI ALA (versão simplificada e rápida, sem lock para evitar travamento)
async function getNextVIALA() {
  const startTime = Date.now();
  try {
    console.log('🔍 [VI ALA] Iniciando obtenção do próximo VI ALA...');
    
    // Verificar/criar base (rápido, sem lock para evitar travamento)
    try {
      await fsPromises.access(BASE_VI_ALA_FILE);
      console.log('✅ [VI ALA] Arquivo existe');
    } catch {
      console.log('📝 [VI ALA] Arquivo não existe, criando...');
      const headers = ['VI ALA', 'ALA', 'DATA', 'PROJETISTA', 'CIDADE', 'ENDEREÇO', 'LATITUDE', 'LONGITUDE'];
      const worksheet = XLSX.utils.aoa_to_sheet([headers]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'VI ALA');
      XLSX.writeFile(workbook, BASE_VI_ALA_FILE);
      console.log('✅ [VI ALA] Arquivo criado');
    }
    
    // Ler dados (rápido)
    console.log('📖 [VI ALA] Lendo dados...');
    const fileBuffer = await fsPromises.readFile(BASE_VI_ALA_FILE);
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet) || [];
    
    console.log(`📊 [VI ALA] Total de registros: ${data.length}`);
    
    // Encontrar maior número
    let maxNumber = 0;
    if (data.length > 0) {
      for (const row of data) {
        const viAla = row['VI ALA'] || '';
        if (viAla && typeof viAla === 'string') {
          const match = viAla.match(/VI\s*ALA[-\s]*(\d+)/i);
          if (match) {
            const number = parseInt(match[1], 10);
            if (!isNaN(number) && number > maxNumber) {
              maxNumber = number;
            }
          }
        }
      }
    }
    
    // Gerar próximo
    const nextNumber = maxNumber + 1;
    const nextVIALA = `VI ALA-${String(nextNumber).padStart(7, '0')}`;
    
    const elapsed = Date.now() - startTime;
    console.log(`✅ [VI ALA] Próximo gerado: ${nextVIALA} (max: ${maxNumber}, próximo: ${nextNumber}) em ${elapsed}ms`);
    
    return nextVIALA;
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`❌ [VI ALA] Erro após ${elapsed}ms:`, err);
    throw err;
  }
}

// Função para salvar registro na base_VI_ALA.xlsx
async function saveVIALARecord(record) {
  return await withLock('vi_ala', async () => {
    try {
      await _ensureVIALABaseInternal();
      const data = await _readVIALABaseInternal();
      
      // Adicionar novo registro
      data.push(record);
      
      // Criar worksheet com os dados
      const worksheet = XLSX.utils.json_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'VI ALA');
      
      // Salvar arquivo
      XLSX.writeFile(workbook, BASE_VI_ALA_FILE);
      console.log('✅ Registro VI ALA salvo com sucesso:', record['VI ALA']);
      
      return true;
    } catch (err) {
      console.error('❌ Erro ao salvar registro VI ALA:', err);
      throw err;
    }
  });
}

// Rota para listar projetistas
app.get('/api/projetistas', (req, res) => {
  try {
    const projetistas = readProjetistas();
    // Retornar apenas os nomes para compatibilidade com frontend (sem senhas)
    const nomesProjetistas = projetistas.map(p => typeof p === 'string' ? p : p.nome);
    res.json({ success: true, projetistas: nomesProjetistas });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rota para adicionar projetista
app.post('/api/projetistas', async (req, res) => {
  try {
    const { nome, senha } = req.body;
    
    if (!nome || !nome.trim()) {
      return res.status(400).json({ success: false, error: 'Nome do projetista é obrigatório' });
    }
    
    if (!senha || !senha.trim()) {
      return res.status(400).json({ success: false, error: 'Senha é obrigatória' });
    }
    
    const nomeLimpo = nome.trim();
    const senhaLimpa = senha.trim();
    let projetistas = readProjetistas();
    
    // Verificar se já existe (comparar por nome)
    const existe = projetistas.some(p => {
      const nomeProj = typeof p === 'string' ? p : p.nome;
      return nomeProj.toLowerCase() === nomeLimpo.toLowerCase();
    });
    
    if (existe) {
      return res.json({ success: false, error: 'Projetista já existe' });
    }
    
    // Adicionar novo projetista com senha
    projetistas.push({ nome: nomeLimpo, senha: senhaLimpa });
    
    // Ordenar alfabeticamente por nome
    projetistas.sort((a, b) => {
      const nomeA = typeof a === 'string' ? a : a.nome;
      const nomeB = typeof b === 'string' ? b : b.nome;
      return nomeA.localeCompare(nomeB);
    });
    
    // Salvar no Excel
    await saveProjetistas(projetistas);
    
    // Retornar apenas os nomes para compatibilidade com frontend
    const nomesProjetistas = projetistas.map(p => typeof p === 'string' ? p : p.nome);
    
    res.json({ success: true, projetistas: nomesProjetistas, message: 'Projetista adicionado com sucesso' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rota para deletar projetista
app.delete('/api/projetistas/:nome', async (req, res) => {
  try {
    const nomeEncoded = req.params.nome;
    const nomeDecoded = decodeURIComponent(nomeEncoded).trim();
    
    if (!nomeDecoded) {
      return res.status(400).json({ success: false, error: 'Nome do projetista não pode estar vazio' });
    }
    
    console.log(`🔍 Tentando deletar projetista: '${nomeDecoded}'`);
    
    let projetistas = readProjetistas();
    
    const nomesAntes = projetistas.map(p => typeof p === 'string' ? p : p.nome);
    console.log(`📋 Projetistas antes da exclusão: ${nomesAntes.join(', ')}`);
    
    // Verificar se existe (comparar por nome)
    const existe = projetistas.some(p => {
      const nomeProj = typeof p === 'string' ? p : p.nome;
      return nomeProj === nomeDecoded;
    });
    
    if (!existe) {
      console.log(`⚠️ Projetista '${nomeDecoded}' não encontrado na base de dados`);
      return res.json({ 
        success: false, 
        projetistas: nomesAntes, 
        message: 'Projetista não encontrado' 
      });
    }
    
    // Remover da lista
    const projetistasAntes = projetistas.length;
    projetistas = projetistas.filter(p => {
      const nomeProj = typeof p === 'string' ? p : p.nome;
      return nomeProj !== nomeDecoded;
    });
    const projetistasDepois = projetistas.length;
    
    console.log(`📊 Projetistas antes: ${projetistasAntes}, depois: ${projetistasDepois}`);
    
    // Salvar na planilha Excel (atualiza a base de dados)
    await saveProjetistas(projetistas);
    
    console.log(`✅ Projetista '${nomeDecoded}' deletado e base de dados atualizada!`);
    
    // Retornar apenas os nomes para compatibilidade
    const nomesProjetistas = projetistas.map(p => typeof p === 'string' ? p : p.nome);
    
    res.json({ 
      success: true, 
      projetistas: nomesProjetistas, 
      message: `Projetista '${nomeDecoded}' deletado com sucesso da base de dados` 
    });
  } catch (err) {
    console.error('❌ Erro ao deletar projetista:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rota para autenticar usuário (validar login)
app.post('/api/auth/login', (req, res) => {
  try {
    const { usuario, senha } = req.body;
    
    if (!usuario || !usuario.trim()) {
      return res.status(400).json({ success: false, error: 'Usuário é obrigatório' });
    }
    
    if (!senha || !senha.trim()) {
      return res.status(400).json({ success: false, error: 'Senha é obrigatória' });
    }
    
    const projetistas = readProjetistas();
    const usuarioLimpo = usuario.trim();
    const senhaLimpa = senha.trim();
    
    // Buscar projetista pelo nome (case insensitive)
    const projetista = projetistas.find(p => {
      const nomeProj = typeof p === 'string' ? p : p.nome;
      return nomeProj.toLowerCase() === usuarioLimpo.toLowerCase();
    });
    
    if (!projetista) {
      return res.json({ success: false, error: 'Usuário ou senha incorretos' });
    }
    
    // Verificar senha
    const senhaProj = typeof projetista === 'string' ? '' : projetista.senha;
    if (senhaProj !== senhaLimpa) {
      return res.json({ success: false, error: 'Usuário ou senha incorretos' });
    }
    
    // Registrar usuário como online
    const now = Date.now();
    activeSessions[usuarioLimpo] = {
      lastActivity: now,
      loginTime: now
    };
    // Remover do histórico de logout se existir
    if (logoutHistory[usuarioLimpo]) {
      delete logoutHistory[usuarioLimpo];
    }
    console.log(`🟢 Usuário ${usuarioLimpo} fez login`);
    
    res.json({ success: true, message: 'Login realizado com sucesso' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rota para atualizar senha do projetista
app.put('/api/projetistas/:nome/password', async (req, res) => {
  try {
    const nomeEncoded = req.params.nome;
    const nomeDecoded = decodeURIComponent(nomeEncoded).trim();
    const { senha } = req.body;
    
    if (!nomeDecoded) {
      return res.status(400).json({ success: false, error: 'Nome do projetista não pode estar vazio' });
    }
    
    if (!senha || !senha.trim()) {
      return res.status(400).json({ success: false, error: 'Senha é obrigatória' });
    }
    
    if (senha.trim().length < 4) {
      return res.status(400).json({ success: false, error: 'A senha deve ter pelo menos 4 caracteres' });
    }
    
    let projetistas = readProjetistas();
    
    // Buscar projetista pelo nome (case insensitive)
    const projetistaIndex = projetistas.findIndex(p => {
      const nomeProj = typeof p === 'string' ? p : p.nome;
      return nomeProj.toLowerCase() === nomeDecoded.toLowerCase();
    });
    
    if (projetistaIndex === -1) {
      return res.status(404).json({ success: false, error: 'Projetista não encontrado' });
    }
    
    // Atualizar senha
    const projetista = projetistas[projetistaIndex];
    if (typeof projetista === 'string') {
      projetistas[projetistaIndex] = { nome: projetista, senha: senha.trim() };
    } else {
      projetistas[projetistaIndex] = { ...projetista, senha: senha.trim() };
    }
    
    // Salvar no Excel
    await saveProjetistas(projetistas);
    
    console.log(`✅ Senha do projetista '${nomeDecoded}' atualizada com sucesso`);
    
    res.json({ success: true, message: 'Senha atualizada com sucesso' });
  } catch (err) {
    console.error('❌ Erro ao atualizar senha:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rota para atualizar nome do projetista
app.put('/api/projetistas/:nome/name', (req, res) => {
  try {
    const nomeEncoded = req.params.nome;
    const nomeDecoded = decodeURIComponent(nomeEncoded).trim();
    const { novoNome } = req.body;
    
    if (!nomeDecoded) {
      return res.status(400).json({ success: false, error: 'Nome do projetista não pode estar vazio' });
    }
    
    if (!novoNome || !novoNome.trim()) {
      return res.status(400).json({ success: false, error: 'Novo nome é obrigatório' });
    }
    
    const novoNomeLimpo = novoNome.trim();
    
    if (novoNomeLimpo.length < 2) {
      return res.status(400).json({ success: false, error: 'O novo nome deve ter pelo menos 2 caracteres' });
    }
    
    let projetistas = readProjetistas();
    
    // Verificar se o novo nome já existe (case insensitive)
    const nomeJaExiste = projetistas.some(p => {
      const nomeProj = typeof p === 'string' ? p : p.nome;
      return nomeProj.toLowerCase() === novoNomeLimpo.toLowerCase() && 
             nomeProj.toLowerCase() !== nomeDecoded.toLowerCase();
    });
    
    if (nomeJaExiste) {
      return res.status(400).json({ success: false, error: 'Este nome já está em uso por outro usuário' });
    }
    
    // Buscar projetista pelo nome (case insensitive)
    const projetistaIndex = projetistas.findIndex(p => {
      const nomeProj = typeof p === 'string' ? p : p.nome;
      return nomeProj.toLowerCase() === nomeDecoded.toLowerCase();
    });
    
    if (projetistaIndex === -1) {
      return res.status(404).json({ success: false, error: 'Projetista não encontrado' });
    }
    
    // Atualizar nome
    const projetista = projetistas[projetistaIndex];
    if (typeof projetista === 'string') {
      projetistas[projetistaIndex] = { nome: novoNomeLimpo, senha: '' };
    } else {
      projetistas[projetistaIndex] = { ...projetista, nome: novoNomeLimpo };
    }
    
    // Ordenar alfabeticamente por nome
    projetistas.sort((a, b) => {
      const nomeA = typeof a === 'string' ? a : a.nome;
      const nomeB = typeof b === 'string' ? b : b.nome;
      return nomeA.localeCompare(nomeB);
    });
    
    // Salvar no Excel
    saveProjetistas(projetistas);
    
    // Atualizar sessões ativas se o usuário estiver logado
    if (activeSessions[nomeDecoded]) {
      const sessionData = activeSessions[nomeDecoded];
      // Remover sessão antiga
      delete activeSessions[nomeDecoded];
      // Criar sessão com novo nome
      activeSessions[novoNomeLimpo] = sessionData;
      console.log(`🔄 Sessão ativa atualizada: '${nomeDecoded}' → '${novoNomeLimpo}'`);
    }
    
    // Atualizar histórico de logout se existir
    if (logoutHistory[nomeDecoded]) {
      logoutHistory[novoNomeLimpo] = logoutHistory[nomeDecoded];
      delete logoutHistory[nomeDecoded];
    }
    
    console.log(`✅ Nome do projetista '${nomeDecoded}' atualizado para '${novoNomeLimpo}' com sucesso`);
    
    res.json({ success: true, message: 'Nome atualizado com sucesso', novoNome: novoNomeLimpo });
  } catch (err) {
    console.error('❌ Erro ao atualizar nome:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Função para validar estrutura do arquivo Excel (ultra-otimizada para não travar)
function validateExcelStructure(fileBuffer) {
  try {
    // Ler apenas metadados primeiro (muito rápido)
    const workbook = XLSX.read(fileBuffer, { 
      type: 'buffer',
      cellDates: false,
      cellNF: false,
      cellStyles: false,
      sheetStubs: false,
      dense: false // Não criar array denso (mais rápido)
    });
    
    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return { valid: false, error: 'O arquivo Excel não contém planilhas' };
    }
    
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Verificar se a planilha existe e tem dados
    if (!worksheet || !worksheet['!ref']) {
      return { valid: false, error: 'A planilha está vazia ou não contém dados' };
    }
    
    // Obter range sem processar dados
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    const totalRows = range.e.r + 1;
    const totalCols = range.e.c + 1;
    
    if (totalRows === 0 || totalCols === 0) {
      return { valid: false, error: 'O arquivo Excel está vazio ou não contém dados' };
    }
    
    // Ler apenas primeira linha (cabeçalho) - muito rápido
    const headerRange = XLSX.utils.encode_range({
      s: { c: 0, r: 0 },
      e: { c: range.e.c, r: 0 }
    });
    
    const headerData = XLSX.utils.sheet_to_json(worksheet, { 
      range: headerRange,
      defval: '',
      header: 1 // Retornar como array de arrays (mais rápido)
    });

    if (!headerData || headerData.length === 0 || !headerData[0]) {
      return { valid: false, error: 'O arquivo Excel não contém cabeçalho válido' };
    }

    // Normalizar nomes das colunas (case insensitive) - apenas cabeçalho
    const headerRow = Array.isArray(headerData[0]) ? headerData[0] : Object.keys(headerData[0]);
    const columns = headerRow.map(col => String(col).toLowerCase().trim()).filter(col => col);

    // Colunas esperadas na base de dados (estrutura específica)
    const expectedColumns = [
      'cid_rede',
      'estado',
      'pop',
      'olt',
      'slot',
      'pon',
      'id_cto',
      'cto',
      'latitude',
      'longitude',
      'status_cto',
      'data_cadastro',
      'portas',
      'ocupado',
      'livre',
      'pct_ocup'
    ];

    // Verificar quais colunas esperadas estão presentes (case insensitive e com variações)
    const foundColumns = [];
    const missingColumns = [];
    
    for (const expectedCol of expectedColumns) {
      const colLower = expectedCol.toLowerCase();
      // Buscar coluna exata ou similar
      const found = columns.some(col => {
        const normalizedCol = col.toLowerCase().trim();
        // Verificar correspondência exata ou parcial
        return normalizedCol === colLower || 
               normalizedCol === colLower.replace('_', ' ') ||
               normalizedCol.includes(colLower) ||
               colLower.includes(normalizedCol);
      });
      
      if (found) {
        foundColumns.push(expectedCol);
      } else {
        missingColumns.push(expectedCol);
      }
    }

    // Colunas críticas (latitude e longitude são essenciais para o funcionamento)
    const criticalColumns = ['latitude', 'longitude'];
    const missingCritical = criticalColumns.filter(col => 
      !foundColumns.some(found => found.toLowerCase() === col.toLowerCase())
    );

    // Se faltar colunas críticas, bloquear
    if (missingCritical.length > 0) {
      return {
        valid: false,
        error: `Colunas críticas não encontradas: ${missingCritical.join(', ')}\n\nColunas encontradas: ${columns.join(', ')}\n\nColunas esperadas: ${expectedColumns.join(', ')}`
      };
    }

    // Log das colunas encontradas para debug
    console.log(`📋 Colunas encontradas: ${columns.join(', ')}`);
    console.log(`✅ Colunas esperadas encontradas: ${foundColumns.length}/${expectedColumns.length}`);
    if (missingColumns.length > 0) {
      console.log(`⚠️ Colunas não encontradas (opcionais): ${missingColumns.join(', ')}`);
    }

    // Validação simplificada: apenas verificar se tem colunas corretas no cabeçalho
    // Não validar dados das linhas - aceitar qualquer arquivo com estrutura correta
    console.log(`✅ Validação de estrutura concluída: ${foundColumns.length}/${expectedColumns.length} colunas encontradas`);
    console.log(`ℹ️ Arquivo aceito - validação apenas de colunas do cabeçalho`);
    
    return {
      valid: true,
      totalRows: totalRows,
      validRows: totalRows - 1, // Assumir todas menos cabeçalho são válidas
      invalidRows: 0
    };
  } catch (err) {
    return {
      valid: false,
      error: `Erro ao validar arquivo: ${err.message}`
    };
  }
}

// Rota para upload e atualização da base de dados
app.post('/api/upload-base', (req, res, next) => {
  console.log('📥 [Upload] Requisição recebida para upload de base de dados');
  console.log('📥 [Upload] Origin:', req.headers.origin);
  console.log('📥 [Upload] Content-Type:', req.headers['content-type']);
  
  // Garantir headers CORS antes de processar
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('❌ Erro no multer:', err);
      console.error('❌ Código do erro:', err.code);
      console.error('❌ Mensagem do erro:', err.message);
      
      let errorMessage = err.message;
      
      // Melhorar mensagem de erro para arquivo muito grande
      if (err.code === 'LIMIT_FILE_SIZE') {
        const maxSizeMB = 100;
        errorMessage = `Arquivo muito grande. O tamanho máximo permitido é ${maxSizeMB}MB. Seu arquivo excede esse limite.`;
      } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        errorMessage = 'Nome do campo do arquivo incorreto. Use "file" como nome do campo.';
      }
      
      // Garantir headers CORS na resposta de erro
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
      
      return res.status(400).json({
        success: false,
        error: errorMessage,
        errorCode: err.code
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'Nenhum arquivo foi enviado' 
      });
    }

    // Verificar se é um arquivo Excel
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/octet-stream'
    ];
    
    if (!allowedMimes.includes(req.file.mimetype) && !req.file.originalname.match(/\.(xlsx|xls)$/i)) {
      return res.status(400).json({
        success: false,
        error: 'Formato de arquivo inválido. Apenas arquivos Excel (.xlsx ou .xls) são aceitos.'
      });
    }

    console.log(`📤 Arquivo recebido: ${req.file.originalname} (${req.file.size} bytes)`);
    console.log(`📋 Tipo MIME: ${req.file.mimetype}`);

    // Validar estrutura do arquivo de forma não bloqueante
    // Usar process.nextTick para permitir que outras operações sejam executadas
    const validation = await new Promise((resolve) => {
      process.nextTick(() => {
        try {
          console.log('🔍 Iniciando validação do arquivo...');
          const result = validateExcelStructure(req.file.buffer);
          console.log(`📊 Resultado da validação:`, result);
          resolve(result);
        } catch (err) {
          console.error('❌ Erro durante validação:', err);
          resolve({
            valid: false,
            error: `Erro ao validar arquivo: ${err.message}`
          });
        }
      });
    });
    
    if (!validation.valid) {
      console.error(`❌ Validação falhou: ${validation.error}`);
      return res.status(400).json({
        success: false,
        error: validation.error
      });
    }

    console.log(`✅ Validação bem-sucedida: ${validation.validRows} linhas válidas de ${validation.totalRows} total`);

    // Obter data atual para nomear arquivos
    const now = new Date();
    const dateStr = formatDateForFilename(now);
    
    // Processar operações de arquivo em paralelo e de forma assíncrona
    // Encontrar arquivos existentes (assíncrono)
    const [currentBasePath, backupBasePath] = await Promise.all([
      findCurrentBaseFile(),
      findBackupBaseFile()
    ]);
    
    // Preparar operações de arquivo para executar em paralelo quando possível
    const fileOperations = [];
    
    // Se existe base_atual e backup, apagar o backup antigo (assíncrono)
    if (currentBasePath && backupBasePath) {
      fileOperations.push(
        fsPromises.unlink(backupBasePath).then(() => {
          console.log(`🗑️ Backup antigo removido: ${path.basename(backupBasePath)}`);
        }).catch(err => {
          console.error('Erro ao remover backup antigo:', err);
        })
      );
    }
    
    // Se existe base_atual, renomear para backup (assíncrono)
    if (currentBasePath) {
      const backupFileName = `backup_${dateStr}.xlsx`;
      const newBackupPath = path.join(DATA_DIR, backupFileName);
      fileOperations.push(
        fsPromises.rename(currentBasePath, newBackupPath).then(() => {
          console.log(`💾 Base atual movida para backup: ${backupFileName}`);
        }).catch(err => {
          console.error('Erro ao criar backup da base atual:', err);
          // Tentar copiar ao invés de renomear
          return fsPromises.copyFile(currentBasePath, newBackupPath).then(() => {
            console.log(`💾 Backup criado por cópia: ${backupFileName}`);
          }).catch(copyErr => {
            console.error('Erro ao copiar para backup:', copyErr);
          });
        })
      );
    }
    
    // Salvar novo arquivo como base_atual_DD-MM-YYYY.xlsx (assíncrono)
    const newBaseFileName = `base_atual_${dateStr}.xlsx`;
    const newBasePath = path.join(DATA_DIR, newBaseFileName);
    
    // Executar todas as operações de arquivo em paralelo
    await Promise.all([
      ...fileOperations,
      fsPromises.writeFile(newBasePath, req.file.buffer)
    ]);
    
    console.log(`✅ Base de dados salva como: ${newBaseFileName}`);

    // Obter data de modificação do arquivo (assíncrono)
    const stats = await fsPromises.stat(newBasePath);
    const lastModified = stats.mtime;

    // Garantir headers CORS na resposta de sucesso
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    // Retornar resposta imediatamente
    res.json({
      success: true,
      message: `Base de dados atualizada com sucesso!\n${validation.validRows} linhas válidas de ${validation.totalRows} total`,
      stats: {
        totalRows: validation.totalRows,
        validRows: validation.validRows,
        invalidRows: validation.invalidRows
      },
      lastModified: lastModified.toISOString()
    });
  } catch (err) {
    console.error('❌ Erro ao fazer upload da base de dados:', err);
    console.error('❌ Stack trace:', err.stack);
    
    // Garantir headers CORS mesmo em caso de erro
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    // Garantir que sempre retorna JSON
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: `Erro ao processar arquivo: ${err.message || 'Erro desconhecido'}`
      });
    }
  }
});

// Rota para listar tabulações
app.get('/api/tabulacoes', async (req, res) => {
  try {
    const tabulacoes = await readTabulacoes();
    res.json({ success: true, tabulacoes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rota para adicionar tabulação
app.post('/api/tabulacoes', async (req, res) => {
  try {
    const { nome } = req.body;
    
    if (!nome || !nome.trim()) {
      return res.status(400).json({ success: false, error: 'Nome da tabulação é obrigatório' });
    }
    
    const nomeLimpo = nome.trim();
    let tabulacoes = await readTabulacoes();
    
    // Verificar se já existe
    if (tabulacoes.includes(nomeLimpo)) {
      return res.json({ success: true, tabulacoes, message: 'Tabulação já existe' });
    }
    
    // Adicionar nova tabulação
    tabulacoes.push(nomeLimpo);
    tabulacoes.sort(); // Ordenar alfabeticamente
    
    // Salvar no Excel
    await saveTabulacoes(tabulacoes);
    
    res.json({ success: true, tabulacoes, message: 'Tabulação adicionada com sucesso' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rota para deletar tabulação
app.delete('/api/tabulacoes/:nome', async (req, res) => {
  try {
    const nome = decodeURIComponent(req.params.nome);
    
    if (!nome || !nome.trim()) {
      return res.status(400).json({ success: false, error: 'Nome da tabulação é obrigatório' });
    }
    
    let tabulacoes = await readTabulacoes();
    const nomeLimpo = nome.trim();
    
    // Verificar se existe
    const index = tabulacoes.indexOf(nomeLimpo);
    if (index === -1) {
      return res.status(404).json({ success: false, error: 'Tabulação não encontrada' });
    }
    
    // Remover tabulação
    tabulacoes.splice(index, 1);
    
    // Salvar no Excel
    await saveTabulacoes(tabulacoes);
    
    res.json({ success: true, tabulacoes, message: 'Tabulação deletada com sucesso' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// Rota para logout
app.post('/api/auth/logout', (req, res) => {
  try {
    const { usuario } = req.body;
    
    if (usuario && usuario.trim()) {
      const usuarioLimpo = usuario.trim();
      if (activeSessions[usuarioLimpo]) {
        // Salvar timestamp de logout antes de remover
        logoutHistory[usuarioLimpo] = { logoutTime: Date.now() };
        delete activeSessions[usuarioLimpo];
        console.log(`🔴 Usuário ${usuarioLimpo} fez logout`);
      }
    }
    
    res.json({ success: true, message: 'Logout realizado com sucesso' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rota para obter lista de usuários online com informações de timestamp
app.get('/api/users/online', (req, res) => {
  try {
    const now = Date.now();
    const onlineUsers = [];
    const usersInfo = {};
    
    // Filtrar apenas usuários ativos (não expirados)
    Object.keys(activeSessions).forEach(usuario => {
      if (now - activeSessions[usuario].lastActivity <= SESSION_TIMEOUT) {
        onlineUsers.push(usuario);
        usersInfo[usuario] = {
          status: 'online',
          loginTime: activeSessions[usuario].loginTime
        };
      } else {
        // Salvar timestamp de logout antes de remover
        logoutHistory[usuario] = { logoutTime: activeSessions[usuario].lastActivity };
        delete activeSessions[usuario];
      }
    });
    
    // Adicionar informações de usuários offline (que já fizeram logout ou nunca fizeram login)
    // Primeiro, adicionar todos do histórico de logout
    Object.keys(logoutHistory).forEach(usuario => {
      if (!usersInfo[usuario]) {
        usersInfo[usuario] = {
          status: 'offline',
          logoutTime: logoutHistory[usuario].logoutTime
        };
      }
    });
    
    // Garantir que todos os projetistas tenham informação de status
    // Se um projetista não está online nem no histórico, significa que nunca fez login
    // Nesse caso, não adicionamos informação (será tratado no frontend)
    
    res.json({ success: true, onlineUsers, usersInfo });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rota para atualizar atividade do usuário (heartbeat)
app.post('/api/users/heartbeat', (req, res) => {
  try {
    // Garantir headers CORS
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    const { usuario } = req.body;
    
    if (usuario && usuario.trim()) {
      const usuarioLimpo = usuario.trim();
      if (activeSessions[usuarioLimpo]) {
        activeSessions[usuarioLimpo].lastActivity = Date.now();
      }
    }
    
    res.json({ success: true });
  } catch (err) {
    // Garantir headers CORS mesmo em erro
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

// Rota para verificar/criar base_VI_ALA.xlsx
app.get('/api/vi-ala/ensure-base', async (req, res) => {
  try {
    await ensureVIALABase();
    res.json({ success: true, message: 'Base VI ALA verificada/criada com sucesso' });
  } catch (err) {
    console.error('Erro ao verificar/criar base VI ALA:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rota de teste para verificar se o servidor está respondendo
app.get('/api/vi-ala/test', (req, res) => {
  console.log('📥 [API] Teste recebido');
  res.json({ success: true, message: 'Servidor está respondendo', timestamp: new Date().toISOString() });
});

// Rota de teste simples para verificar CORS e conectividade
app.get('/api/test', (req, res) => {
  console.log('📥 [API] Teste de conectividade recebido');
  console.log('📥 [API] Origin:', req.headers.origin);
  
  // Garantir headers CORS
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  res.json({ 
    success: true, 
    message: 'Backend está funcionando!', 
    timestamp: new Date().toISOString(),
    origin: req.headers.origin || 'N/A'
  });
});

// Rota de health check
app.get('/health', (req, res) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Rota para obter próximo VI ALA
app.get('/api/vi-ala/next', async (req, res) => {
  const requestStartTime = Date.now();
  console.log('📥 [API] ===== REQUISIÇÃO RECEBIDA /api/vi-ala/next =====');
  console.log('📥 [API] Timestamp:', new Date().toISOString());
  
  // Responder imediatamente com headers para evitar timeout
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  try {
    console.log('⏱️ [API] Iniciando processamento...');
    
    const nextVIALA = await getNextVIALA();
    
    const elapsedTime = Date.now() - requestStartTime;
    console.log(`✅ [API] Resposta enviada: ${nextVIALA} (${elapsedTime}ms)`);
    
    if (!res.headersSent) {
      res.json({ success: true, viAla: nextVIALA });
    }
  } catch (err) {
    const elapsedTime = Date.now() - requestStartTime;
    console.error(`❌ [API] Erro (${elapsedTime}ms):`, err.message);
    console.error('❌ [API] Stack:', err.stack);
    
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

// Rota para salvar registro na base_VI_ALA.xlsx
app.post('/api/vi-ala/save', async (req, res) => {
  try {
    console.log('📥 Requisição recebida para salvar VI ALA');
    console.log('📦 Body recebido:', req.body);
    
    const { viAla, ala, data, projetista, cidade, endereco, latitude, longitude } = req.body;
    
    if (!viAla || viAla.trim() === '') {
      console.warn('⚠️ VI ALA não fornecido ou vazio');
      return res.status(400).json({ success: false, error: 'VI ALA é obrigatório' });
    }
    
    const record = {
      'VI ALA': viAla.trim(),
      'ALA': ala || '',
      'DATA': data || '',
      'PROJETISTA': projetista || '',
      'CIDADE': cidade || '',
      'ENDEREÇO': endereco || '',
      'LATITUDE': latitude || '',
      'LONGITUDE': longitude || ''
    };
    
    console.log('💾 Salvando registro:', record);
    await saveVIALARecord(record);
    console.log('✅ Registro salvo com sucesso');
    res.json({ success: true, message: 'Registro salvo com sucesso' });
  } catch (err) {
    console.error('❌ Erro ao salvar registro VI ALA:', err);
    console.error('❌ Stack trace:', err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rota para listar VI ALAs (os 10 mais recentes)
app.get('/api/vi-ala/list', async (req, res) => {
  try {
    console.log('📥 [API] Requisição recebida para listar VI ALAs');
    
    // Garantir que a base existe
    await _ensureVIALABaseInternal();
    
    // Ler dados da base
    const data = await _readVIALABaseInternal();
    console.log(`📊 [API] Total de registros na base: ${data.length}`);
    
    // Converter para formato esperado pelo frontend
    const viAlas = data.map((row, index) => {
      const viAla = row['VI ALA'] || '';
      // Extrair número do VI ALA
      let numero = 0;
      if (viAla && typeof viAla === 'string') {
        const match = viAla.match(/VI\s*ALA[-\s]*(\d+)/i);
        if (match) {
          numero = parseInt(match[1], 10);
        }
      }
      
      return {
        id: viAla,
        numero: numero,
        numero_ala: row['ALA'] || '',
        projetista: row['PROJETISTA'] || '',
        cidade: row['CIDADE'] || '',
        endereco: row['ENDEREÇO'] || '',
        data_geracao: row['DATA'] || '',
        latitude: row['LATITUDE'] || '',
        longitude: row['LONGITUDE'] || ''
      };
    });
    
    // Ordenar por número (mais recente primeiro)
    viAlas.sort((a, b) => b.numero - a.numero);
    
    // Limitar aos 10 mais recentes
    const recentViAlas = viAlas.slice(0, 10);
    
    console.log(`✅ [API] Retornando ${recentViAlas.length} VI ALAs (de ${viAlas.length} total)`);
    
    res.json({ success: true, viAlas: recentViAlas });
  } catch (err) {
    console.error('❌ [API] Erro ao listar VI ALAs:', err);
    console.error('❌ [API] Stack:', err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rota para baixar o arquivo base_VI ALA.xlsx completo
app.get('/api/vi-ala.xlsx', (req, res) => {
  try {
    if (!fs.existsSync(BASE_VI_ALA_FILE)) {
      return res.status(404).json({ error: 'Arquivo base_VI ALA.xlsx não encontrado' });
    }
    
    console.log('📥 Requisição para baixar base_VI ALA.xlsx');
    res.sendFile(path.resolve(BASE_VI_ALA_FILE));
  } catch (err) {
    console.error('❌ Erro ao servir base_VI ALA.xlsx:', err);
    res.status(500).json({ error: 'Erro ao servir arquivo base_VI ALA.xlsx' });
  }
});

// Rota catch-all para rotas não encontradas (sempre retorna JSON)
app.use((req, res) => {
  console.log(`⚠️ [404] Rota não encontrada: ${req.method} ${req.path}`);
  res.status(404).json({ 
    success: false, 
    error: 'Rota não encontrada',
    path: req.path,
    method: req.method
  });
});

// Tratamento de erros global
app.use((err, req, res, next) => {
  console.error('❌ [Error] Erro não tratado:', err);
  console.error('❌ [Error] Stack:', err.stack);
  
  // Garantir headers CORS mesmo em erro global
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (!res.headersSent) {
    res.status(500).json({ 
      success: false, 
      error: err.message || 'Erro interno do servidor' 
    });
  }
});

// Tratamento de erros não capturados do processo
process.on('uncaughtException', (err) => {
  console.error('❌ [Fatal] Erro não capturado:', err);
  console.error('❌ [Fatal] Stack:', err.stack);
  // Não encerrar o processo, apenas logar
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ [Fatal] Promise rejeitada não tratada:', reason);
  // Não encerrar o processo, apenas logar
});

// Iniciar servidor - escutar em 0.0.0.0 para aceitar conexões externas (Railway)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor rodando em http://0.0.0.0:${PORT}`);
  console.log(`📁 Pasta de dados: ${DATA_DIR}`);
  console.log(`📁 Arquivo projetistas: ${PROJETISTAS_FILE}`);
  console.log(`📁 Arquivo base CTOs: ${BASE_CTOS_FILE}`);
  console.log(`📁 Arquivo tabulações: ${TABULACOES_FILE}`);
});

