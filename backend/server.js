import express from 'express';
import cors from 'cors';
import XLSX from 'xlsx';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import supabase, { testSupabaseConnection, checkTables, isSupabaseAvailable } from './supabase.js';

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

// Configurar body parser com limites maiores e timeout maior
app.use(express.json({ 
  limit: '100mb',
  parameterLimit: 50000
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: '100mb',
  parameterLimit: 50000
}));

// Middleware para logar requisições (debug)
app.use((req, res, next) => {
  console.log(`📥 [${new Date().toISOString()}] ${req.method} ${req.path}`);
  console.log(`📥 [Request] Origin: ${req.headers.origin || 'N/A'}`);
  console.log(`📥 [Request] Host: ${req.headers.host || 'N/A'}`);
  next();
});

// Criar pasta data se não existir
// Permite configurar via variável de ambiente (útil para Railway volumes)
// IMPORTANTE: Definir DATA_DIR ANTES de usar no multer
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Configurar multer para upload de arquivos
// OTIMIZAÇÃO DE MEMÓRIA: Usar diskStorage em vez de memoryStorage
// Isso evita carregar arquivos grandes na memória, prevenindo "Out of memory" no Railway
let upload;
try {
  // Criar pasta temporária para uploads
  const TEMP_DIR = path.join(DATA_DIR, 'temp');
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
  
  upload = multer({ 
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, TEMP_DIR);
      },
      filename: (req, file, cb) => {
        // Nome único para evitar conflitos
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `upload-${uniqueSuffix}-${file.originalname}`);
      }
    }),
    limits: { 
      fileSize: 100 * 1024 * 1024, // 100MB limite
      files: 1,
      fields: 0
    }
  });
  console.log('✅ Multer configurado com diskStorage (otimizado para memória)');
} catch (err) {
  console.error('❌ Erro ao configurar multer:', err);
  console.error('Certifique-se de que o multer está instalado: npm install multer');
  process.exit(1);
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
// IMPORTANTE: Esta função NUNCA retorna backups - apenas arquivos base_atual_*.xlsx
async function findCurrentBaseFile() {
  try {
    const files = await fsPromises.readdir(DATA_DIR);
    // Filtrar APENAS arquivos base_atual_*.xlsx (NUNCA backups que começam com backup_)
    const baseAtualFiles = files.filter(file => 
      file.startsWith('base_atual_') && file.endsWith('.xlsx') && !file.startsWith('backup_')
    );
    
    if (baseAtualFiles.length === 0) {
      console.log('📋 [Base] Nenhum arquivo base_atual encontrado');
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
    const mostRecent = filesWithStats[0].path;
    console.log(`📋 [Base] Base atual encontrada: ${path.basename(mostRecent)} (mais recente de ${baseAtualFiles.length} arquivo(s))`);
    return mostRecent;
  } catch (err) {
    console.error('❌ [Base] Erro ao buscar arquivo base_atual:', err);
    return null;
  }
}

// Função para encontrar o arquivo backup mais recente (assíncrona)
// IMPORTANTE: Esta função é usada APENAS para limpeza de backups antigos
// NUNCA é usada para servir dados ao sistema - apenas para gerenciamento de arquivos
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
// IMPORTANTE: Esta função NUNCA retorna backups - apenas arquivos base_atual_*.xlsx
function getCurrentBaseFilePathSync() {
  try {
    const files = fs.readdirSync(DATA_DIR);
    // Filtrar APENAS arquivos base_atual_*.xlsx (NUNCA backups que começam com backup_)
    const baseAtualFiles = files.filter(file => 
      file.startsWith('base_atual_') && file.endsWith('.xlsx') && !file.startsWith('backup_')
    );
    
    if (baseAtualFiles.length > 0) {
      // Ordenar por data de modificação (mais recente primeiro)
      const filesWithStats = baseAtualFiles.map(file => ({
        name: file,
        path: path.join(DATA_DIR, file),
        mtime: fs.statSync(path.join(DATA_DIR, file)).mtime
      }));
      
      filesWithStats.sort((a, b) => b.mtime - a.mtime);
      const mostRecent = filesWithStats[0].path;
      console.log(`📋 [Base] Base atual (sync): ${path.basename(mostRecent)}`);
      return mostRecent;
    }
  } catch (err) {
    console.error('❌ [Base] Erro ao buscar base atual (sync):', err);
    // Ignorar erro e tentar fallback
  }
  
  // Fallback para compatibilidade com arquivo antigo (base.xlsx)
  // Este fallback é apenas para migração - não deve ser usado em produção
  if (fs.existsSync(BASE_CTOS_FILE)) {
    console.log('⚠️ [Base] Usando fallback base.xlsx (arquivo antigo)');
    return BASE_CTOS_FILE;
  }
  return null;
}

// Função assíncrona para obter o caminho do arquivo base atual
// IMPORTANTE: Esta função NUNCA retorna backups - apenas arquivos base_atual_*.xlsx
async function getCurrentBaseFilePath() {
  const currentBase = await findCurrentBaseFile();
  if (currentBase) {
    return currentBase;
  }
  // Fallback para compatibilidade com arquivo antigo (base.xlsx)
  // Este fallback é apenas para migração - não deve ser usado em produção
  try {
    await fsPromises.access(BASE_CTOS_FILE);
    console.log('⚠️ [Base] Usando fallback base.xlsx (arquivo antigo)');
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

// Limpar arquivos temporários antigos periodicamente (a cada 1 hora)
// Isso previne acúmulo de arquivos temporários em caso de erros
setInterval(async () => {
  try {
    const TEMP_DIR = path.join(DATA_DIR, 'temp');
    if (!fs.existsSync(TEMP_DIR)) {
      return;
    }
    
    const files = await fsPromises.readdir(TEMP_DIR);
    const now = Date.now();
    const MAX_AGE = 60 * 60 * 1000; // 1 hora
    
    for (const file of files) {
      if (file.startsWith('upload-')) {
        const filePath = path.join(TEMP_DIR, file);
        try {
          const stats = await fsPromises.stat(filePath);
          const age = now - stats.mtime.getTime();
          
          if (age > MAX_AGE) {
            await fsPromises.unlink(filePath);
            console.log(`🗑️ [Cleanup] Arquivo temporário antigo removido: ${file}`);
          }
        } catch (err) {
          console.error(`❌ [Cleanup] Erro ao verificar/remover arquivo temporário ${file}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('❌ [Cleanup] Erro ao limpar arquivos temporários:', err.message);
  }
}, 60 * 60 * 1000); // A cada 1 hora

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

// Função para ler CTOs do Supabase e converter para Excel (nova versão)
async function readCTOsFromSupabase() {
  try {
    if (!supabase || !isSupabaseAvailable()) {
      return null; // Retorna null para indicar que deve usar fallback
    }
    
    console.log('📂 [Supabase] Carregando CTOs do Supabase...');
    
    const { data, error } = await supabase
      .from('ctos')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('❌ [Supabase] Erro ao ler CTOs:', error);
      return null; // Fallback para Excel
    }
    
    if (!data || data.length === 0) {
      console.log('⚠️ [Supabase] Nenhuma CTO encontrada no Supabase');
      return null; // Fallback para Excel
    }
    
    // Converter para formato Excel (mesma estrutura do arquivo)
    const excelData = (data || []).map(row => ({
      cid_rede: row.cid_rede || '',
      estado: row.estado || '',
      pop: row.pop || '',
      olt: row.olt || '',
      slot: row.slot || '',
      pon: row.pon || '',
      id_cto: row.id_cto || '',
      cto: row.cto || '',
      latitude: row.latitude || '',
      longitude: row.longitude || '',
      status_cto: row.status_cto || '',
      data_cadastro: row.data_cadastro || '',
      portas: row.portas || '',
      ocupado: row.ocupado || '',
      livre: row.livre || '',
      pct_ocup: row.pct_ocup || ''
    }));
    
    console.log(`✅ [Supabase] ${excelData.length} CTOs carregadas do Supabase`);
    
    return excelData;
  } catch (err) {
    console.error('❌ [Supabase] Erro ao ler CTOs:', err);
    return null; // Fallback para Excel
  }
}

// Rota para servir o arquivo base.xlsx (tenta Supabase primeiro, fallback para Excel)
// IMPORTANTE: Esta rota NUNCA serve backups - apenas arquivos base_atual_*.xlsx
app.get('/api/base.xlsx', async (req, res) => {
  try {
    // Garantir headers CORS
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    console.log('📥 [Base] Requisição para /api/base.xlsx recebida');
    
    // Tentar ler do Supabase primeiro
    const supabaseData = await readCTOsFromSupabase();
    if (supabaseData !== null && supabaseData.length > 0) {
      try {
        console.log('📤 [Supabase] Convertendo CTOs do Supabase para Excel...');
        console.log(`📊 [Supabase] Total de CTOs: ${supabaseData.length}`);
        
        // Criar workbook Excel em memória
        const worksheet = XLSX.utils.json_to_sheet(supabaseData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'CTOs');
        
        // Gerar buffer Excel
        const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        
        console.log(`✅ [Supabase] Excel gerado: ${supabaseData.length} CTOs (${excelBuffer.length} bytes)`);
        
        // Configurar headers para download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="base.xlsx"');
        res.setHeader('Content-Length', excelBuffer.length);
        
        // Enviar buffer
        res.send(excelBuffer);
        return;
      } catch (excelErr) {
        console.error('❌ [Supabase] Erro ao gerar Excel do Supabase, usando fallback:', excelErr);
        console.error('❌ [Supabase] Stack:', excelErr.stack);
        // Continuar com fallback Excel
      }
    } else {
      console.log('⚠️ [Base] Supabase não retornou dados ou está vazio, tentando fallback Excel...');
    }
    
    // Fallback: servir arquivo Excel do disco
    console.log('📂 [Excel] Tentando encontrar arquivo Excel no disco...');
    const currentBasePath = getCurrentBaseFilePathSync();
    
    if (!currentBasePath || !fs.existsSync(currentBasePath)) {
      console.warn('⚠️ [Base] Nenhum arquivo base_atual_*.xlsx encontrado');
      console.warn('⚠️ [Base] Criando arquivo Excel vazio para evitar erro 404...');
      
      // Criar arquivo Excel vazio com estrutura básica
      const emptyData = [{
        cid_rede: '',
        estado: '',
        pop: '',
        olt: '',
        slot: '',
        pon: '',
        id_cto: '',
        cto: '',
        latitude: '',
        longitude: '',
        status_cto: '',
        data_cadastro: '',
        portas: '',
        ocupado: '',
        livre: '',
        pct_ocup: ''
      }];
      
      const worksheet = XLSX.utils.json_to_sheet(emptyData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'CTOs');
      
      const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      
      console.log('✅ [Base] Arquivo Excel vazio criado e enviado');
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="base.xlsx"');
      res.setHeader('Content-Length', excelBuffer.length);
      res.send(excelBuffer);
      return;
    }
    
    // Validação extra: garantir que não é um backup
    const fileName = path.basename(currentBasePath);
    if (fileName.startsWith('backup_')) {
      console.error('❌ [Base] ERRO CRÍTICO: Tentativa de servir backup como base atual!');
      return res.status(500).json({ error: 'Erro interno: arquivo de backup detectado' });
    }
    
    console.log(`📤 [Excel] Servindo arquivo: ${fileName}`);
    res.sendFile(path.resolve(currentBasePath));
  } catch (err) {
    console.error('❌ [Base] Erro ao servir base.xlsx:', err);
    console.error('❌ [Base] Stack:', err.stack);
    
    // Garantir headers CORS mesmo em erro
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erro ao servir arquivo base.xlsx', details: err.message });
    }
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

// Função para ler projetistas do Supabase (nova versão)
async function readProjetistasFromSupabase() {
  try {
    if (!supabase || !isSupabaseAvailable()) {
      return null; // Retorna null para indicar que deve usar fallback
    }
    
    console.log('📂 [Supabase] Carregando projetistas do Supabase...');
    
    const { data, error } = await supabase
      .from('projetistas')
      .select('nome, senha')
      .order('nome', { ascending: true });
    
    if (error) {
      console.error('❌ [Supabase] Erro ao ler projetistas:', error);
      return null; // Fallback para Excel
    }
    
    const projetistas = (data || []).map(p => ({
      nome: p.nome || '',
      senha: p.senha || ''
    }));
    
    console.log(`✅ [Supabase] ${projetistas.length} projetistas carregados do Supabase`);
    if (projetistas.length > 0) {
      console.log(`📋 [Supabase] Projetistas: ${projetistas.map(p => p.nome).join(', ')}`);
    }
    
    return projetistas;
  } catch (err) {
    console.error('❌ [Supabase] Erro ao ler projetistas:', err);
    return null; // Fallback para Excel
  }
}

// Função para ler projetistas do Excel (fallback)
function readProjetistasFromExcel() {
  try {
    if (!fs.existsSync(PROJETISTAS_FILE)) {
      console.log(`⚠️ Arquivo de projetistas não encontrado: ${PROJETISTAS_FILE}`);
      return [];
    }
    
    console.log(`📂 [Excel] Carregando projetistas de: ${PROJETISTAS_FILE}`);
    
    const workbook = XLSX.readFile(PROJETISTAS_FILE);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`📊 [Excel] Colunas encontradas no Excel: ${Object.keys(data[0] || {})}`);
    
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
    
    console.log(`✅ [Excel] ${projetistas.length} projetistas carregados do Excel`);
    if (projetistas.length > 0) {
      console.log(`📋 [Excel] Projetistas: ${projetistas.map(p => p.nome).join(', ')}`);
    }
    
    return projetistas;
  } catch (err) {
    console.error('❌ [Excel] Erro ao ler projetistas:', err);
    return [];
  }
}

// Função para ler projetistas (tenta Supabase primeiro, fallback para Excel)
// Mantém compatibilidade: função síncrona para uso em rotas síncronas
function readProjetistas() {
  // Para uso síncrono, sempre usa Excel (compatibilidade)
  // Rotas assíncronas devem usar readProjetistasAsync()
  return readProjetistasFromExcel();
}

// Função assíncrona para ler projetistas (tenta Supabase primeiro)
async function readProjetistasAsync() {
  // Tentar Supabase primeiro
  const supabaseData = await readProjetistasFromSupabase();
  if (supabaseData !== null) {
    return supabaseData;
  }
  
  // Fallback para Excel
  return readProjetistasFromExcel();
}

// Função para salvar projetistas no Supabase (nova versão)
async function saveProjetistasToSupabase(projetistas) {
  try {
    if (!supabase || !isSupabaseAvailable()) {
      return false; // Indica que deve usar fallback
    }
    
    console.log('💾 [Supabase] Salvando projetistas no Supabase...');
    
    // Normalizar dados
    const dataToSave = projetistas.map(p => {
      if (typeof p === 'string') {
        return { nome: p.trim(), senha: '' };
      }
      return {
        nome: (p.nome || '').trim(),
        senha: (p.senha || '').trim()
      };
    }).filter(p => p.nome); // Remover vazios
    
    // Deletar todos os projetistas existentes e inserir os novos
    // (Isso garante sincronização completa)
    const { error: deleteError } = await supabase
      .from('projetistas')
      .delete()
      .neq('id', 0); // Deletar todos (condição sempre verdadeira)
    
    if (deleteError) {
      console.error('❌ [Supabase] Erro ao limpar projetistas:', deleteError);
      return false;
    }
    
    // Inserir todos os projetistas
    if (dataToSave.length > 0) {
      const { error: insertError } = await supabase
        .from('projetistas')
        .insert(dataToSave);
      
      if (insertError) {
        console.error('❌ [Supabase] Erro ao inserir projetistas:', insertError);
        return false;
      }
    }
    
    console.log(`✅ [Supabase] ${dataToSave.length} projetistas salvos no Supabase`);
    if (dataToSave.length > 0) {
      const nomes = dataToSave.map(p => p.nome).join(', ');
      console.log(`📋 [Supabase] Projetistas: ${nomes}`);
    }
    
    return true; // Sucesso
  } catch (err) {
    console.error('❌ [Supabase] Erro ao salvar projetistas:', err);
    return false; // Fallback para Excel
  }
}

// Função para salvar projetistas no Excel (fallback)
async function saveProjetistasToExcel(projetistas) {
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
      console.log(`✅ [Excel] Base de dados atualizada! Projetistas salvos no Excel: ${projetistas.length} projetistas`);
      console.log(`📁 [Excel] Arquivo: ${PROJETISTAS_FILE}`);
      if (projetistas.length > 0) {
        const nomes = projetistas.map(p => typeof p === 'string' ? p : p.nome).join(', ');
        console.log(`📋 [Excel] Projetistas na base: ${nomes}`);
      }
    } catch (err) {
      console.error('❌ [Excel] Erro ao salvar projetistas:', err);
      throw err;
    }
  });
}

// Função para salvar projetistas (tenta Supabase primeiro, fallback para Excel)
async function saveProjetistas(projetistas) {
  // Tentar Supabase primeiro
  const saved = await saveProjetistasToSupabase(projetistas);
  if (saved) {
    return; // Sucesso no Supabase
  }
  
  // Fallback para Excel
  console.log('⚠️ [Save] Usando fallback Excel para salvar projetistas');
  await saveProjetistasToExcel(projetistas);
}

// Função para ler tabulações do Supabase (nova versão)
async function readTabulacoesFromSupabase() {
  try {
    if (!supabase || !isSupabaseAvailable()) {
      return null; // Retorna null para indicar que deve usar fallback
    }
    
    console.log('📂 [Supabase] Carregando tabulações do Supabase...');
    
    const { data, error } = await supabase
      .from('tabulacoes')
      .select('nome')
      .order('nome', { ascending: true });
    
    if (error) {
      console.error('❌ [Supabase] Erro ao ler tabulações:', error);
      return null; // Fallback para Excel
    }
    
    const tabulacoes = (data || []).map(t => (t.nome || '').trim()).filter(nome => nome);
    
    console.log(`✅ [Supabase] ${tabulacoes.length} tabulações carregadas do Supabase`);
    if (tabulacoes.length > 0) {
      console.log(`📋 [Supabase] Tabulações: ${tabulacoes.join(', ')}`);
    }
    
    return tabulacoes;
  } catch (err) {
    console.error('❌ [Supabase] Erro ao ler tabulações:', err);
    return null; // Fallback para Excel
  }
}

// Função para ler tabulações do Excel (fallback)
async function readTabulacoesFromExcel() {
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
      await saveTabulacoesToExcel(defaultTabulacoes);
      return defaultTabulacoes;
    }
    
    console.log(`📂 [Excel] Carregando tabulações de: ${TABULACOES_FILE}`);
    
    const workbook = XLSX.readFile(TABULACOES_FILE);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`📊 [Excel] Colunas encontradas no Excel: ${Object.keys(data[0] || {})}`);
    
    const nomeCol = data.length > 0 ? Object.keys(data[0]).find(col => col.toLowerCase().trim() === 'nome') : 'nome';
    
    const tabulacoes = data
      .map(row => row.nome || row.Nome || row[nomeCol] || '')
      .filter(nome => nome && nome.trim() !== '')
      .map(nome => nome.trim());
    
    console.log(`✅ [Excel] ${tabulacoes.length} tabulações carregadas do Excel`);
    if (tabulacoes.length > 0) {
      console.log(`📋 [Excel] Tabulações: ${tabulacoes.join(', ')}`);
    }
    
    return tabulacoes;
  } catch (err) {
    console.error('❌ [Excel] Erro ao ler tabulações:', err);
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

// Função para ler tabulações (tenta Supabase primeiro, fallback para Excel)
async function readTabulacoes() {
  // Tentar Supabase primeiro
  const supabaseData = await readTabulacoesFromSupabase();
  if (supabaseData !== null) {
    return supabaseData;
  }
  
  // Fallback para Excel
  return await readTabulacoesFromExcel();
}

// Função para salvar tabulações no Supabase (nova versão)
async function saveTabulacoesToSupabase(tabulacoes) {
  try {
    if (!supabase || !isSupabaseAvailable()) {
      return false; // Indica que deve usar fallback
    }
    
    console.log('💾 [Supabase] Salvando tabulações no Supabase...');
    
    // Normalizar dados
    const dataToSave = tabulacoes
      .map(nome => (nome || '').trim())
      .filter(nome => nome) // Remover vazios
      .map(nome => ({ nome }));
    
    // Deletar todas as tabulações existentes e inserir as novas
    // (Isso garante sincronização completa)
    const { error: deleteError } = await supabase
      .from('tabulacoes')
      .delete()
      .neq('id', 0); // Deletar todos (condição sempre verdadeira)
    
    if (deleteError) {
      console.error('❌ [Supabase] Erro ao limpar tabulações:', deleteError);
      return false;
    }
    
    // Inserir todas as tabulações
    if (dataToSave.length > 0) {
      const { error: insertError } = await supabase
        .from('tabulacoes')
        .insert(dataToSave);
      
      if (insertError) {
        console.error('❌ [Supabase] Erro ao inserir tabulações:', insertError);
        return false;
      }
    }
    
    console.log(`✅ [Supabase] ${dataToSave.length} tabulações salvas no Supabase`);
    if (dataToSave.length > 0) {
      const nomes = dataToSave.map(t => t.nome).join(', ');
      console.log(`📋 [Supabase] Tabulações: ${nomes}`);
    }
    
    return true; // Sucesso
  } catch (err) {
    console.error('❌ [Supabase] Erro ao salvar tabulações:', err);
    return false; // Fallback para Excel
  }
}

// Função para salvar tabulações no Excel (fallback)
async function saveTabulacoesToExcel(tabulacoes) {
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
      console.log(`✅ [Excel] Base de dados atualizada! Tabulações salvas no Excel: ${tabulacoes.length} tabulações`);
      console.log(`📁 [Excel] Arquivo: ${TABULACOES_FILE}`);
      if (tabulacoes.length > 0) {
        console.log(`📋 [Excel] Tabulações na base: ${tabulacoes.join(', ')}`);
      }
    } catch (err) {
      console.error('❌ [Excel] Erro ao salvar tabulações:', err);
      throw err;
    }
  });
}

// Função para salvar tabulações (tenta Supabase primeiro, fallback para Excel)
async function saveTabulacoes(tabulacoes) {
  // Tentar Supabase primeiro
  const saved = await saveTabulacoesToSupabase(tabulacoes);
  if (saved) {
    return; // Sucesso no Supabase
  }
  
  // Fallback para Excel
  console.log('⚠️ [Save] Usando fallback Excel para salvar tabulações');
  await saveTabulacoesToExcel(tabulacoes);
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

// Função para ler VI ALAs do Supabase (nova versão)
async function readVIALABaseFromSupabase() {
  try {
    if (!supabase || !isSupabaseAvailable()) {
      return null; // Retorna null para indicar que deve usar fallback
    }
    
    console.log('📂 [Supabase] Carregando VI ALAs do Supabase...');
    
    const { data, error } = await supabase
      .from('vi_ala')
      .select('vi_ala, ala, data, projetista, cidade, endereco, latitude, longitude')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('❌ [Supabase] Erro ao ler VI ALAs:', error);
      return null; // Fallback para Excel
    }
    
    // Converter para formato compatível com Excel (mesma estrutura)
    const records = (data || []).map(row => ({
      'VI ALA': row.vi_ala || '',
      'ALA': row.ala || '',
      'DATA': row.data || '',
      'PROJETISTA': row.projetista || '',
      'CIDADE': row.cidade || '',
      'ENDEREÇO': row.endereco || '',
      'LATITUDE': row.latitude || '',
      'LONGITUDE': row.longitude || ''
    }));
    
    console.log(`✅ [Supabase] ${records.length} VI ALAs carregados do Supabase`);
    
    return records;
  } catch (err) {
    console.error('❌ [Supabase] Erro ao ler VI ALAs:', err);
    return null; // Fallback para Excel
  }
}

// Função interna para ler base_VI_ALA.xlsx (sem lock, para uso interno)
async function _readVIALABaseInternal() {
  // Tentar Supabase primeiro
  const supabaseData = await readVIALABaseFromSupabase();
  if (supabaseData !== null) {
    return supabaseData;
  }
  
  // Fallback para Excel
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
    console.error('❌ [Excel] Erro ao ler base VI ALA:', err);
    throw err;
  }
}

// Função para ler base_VI_ALA.xlsx (com lock para uso externo)
async function readVIALABase() {
  return await withLock('vi_ala', async () => {
    return await _readVIALABaseInternal();
  });
}

// Função para obter o próximo VI ALA do Supabase (nova versão)
async function getNextVIALAFromSupabase() {
  try {
    if (!supabase || !isSupabaseAvailable()) {
      return null; // Retorna null para indicar que deve usar fallback
    }
    
    console.log('🔍 [Supabase] Obtendo próximo VI ALA do Supabase...');
    
    // Tentar usar a função SQL primeiro (mais eficiente)
    try {
      const { data, error } = await supabase.rpc('get_next_vi_ala_number');
      
      if (error) {
        // Se a função não existir, buscar manualmente
        throw error;
      }
      
      // data pode ser 0 (primeiro número), então verificar explicitamente
      const nextNumber = (data !== null && data !== undefined) ? data : 1;
      const nextVIALA = `VI ALA-${String(nextNumber).padStart(7, '0')}`;
      
      console.log(`✅ [Supabase] Próximo VI ALA gerado: ${nextVIALA} (número: ${nextNumber})`);
      return nextVIALA;
    } catch (rpcError) {
      // Fallback: buscar manualmente o máximo
      console.log('⚠️ [Supabase] Função SQL não disponível, buscando manualmente...');
      
      const { data, error } = await supabase
        .from('vi_ala')
        .select('vi_ala')
        .order('created_at', { ascending: false })
        .limit(100); // Limitar para performance
      
      if (error) {
        console.error('❌ [Supabase] Erro ao buscar VI ALAs:', error);
        return null;
      }
      
      // Encontrar maior número
      let maxNumber = 0;
      if (data && data.length > 0) {
        for (const row of data) {
          const viAla = row.vi_ala || '';
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
      
      const nextNumber = maxNumber + 1;
      const nextVIALA = `VI ALA-${String(nextNumber).padStart(7, '0')}`;
      
      console.log(`✅ [Supabase] Próximo VI ALA gerado: ${nextVIALA} (max: ${maxNumber}, próximo: ${nextNumber})`);
      return nextVIALA;
    }
  } catch (err) {
    console.error('❌ [Supabase] Erro ao obter próximo VI ALA:', err);
    return null; // Fallback para Excel
  }
}

// Função para obter o próximo VI ALA do Excel (fallback)
async function getNextVIALAFromExcel() {
  const startTime = Date.now();
  try {
    console.log('🔍 [Excel] Obtendo próximo VI ALA do Excel...');
    
    // Verificar/criar base (rápido, sem lock para evitar travamento)
    try {
      await fsPromises.access(BASE_VI_ALA_FILE);
      console.log('✅ [Excel] Arquivo existe');
    } catch {
      console.log('📝 [Excel] Arquivo não existe, criando...');
      const headers = ['VI ALA', 'ALA', 'DATA', 'PROJETISTA', 'CIDADE', 'ENDEREÇO', 'LATITUDE', 'LONGITUDE'];
      const worksheet = XLSX.utils.aoa_to_sheet([headers]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'VI ALA');
      XLSX.writeFile(workbook, BASE_VI_ALA_FILE);
      console.log('✅ [Excel] Arquivo criado');
    }
    
    // Ler dados (rápido)
    console.log('📖 [Excel] Lendo dados...');
    const fileBuffer = await fsPromises.readFile(BASE_VI_ALA_FILE);
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet) || [];
    
    console.log(`📊 [Excel] Total de registros: ${data.length}`);
    
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
    console.log(`✅ [Excel] Próximo gerado: ${nextVIALA} (max: ${maxNumber}, próximo: ${nextNumber}) em ${elapsed}ms`);
    
    return nextVIALA;
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`❌ [Excel] Erro após ${elapsed}ms:`, err);
    throw err;
  }
}

// Função para obter o próximo VI ALA (tenta Supabase primeiro, fallback para Excel)
async function getNextVIALA() {
  // Tentar Supabase primeiro
  const supabaseResult = await getNextVIALAFromSupabase();
  if (supabaseResult !== null) {
    return supabaseResult;
  }
  
  // Fallback para Excel
  return await getNextVIALAFromExcel();
}

// Função para salvar registro VI ALA no Supabase (nova versão)
async function saveVIALARecordToSupabase(record) {
  try {
    if (!supabase || !isSupabaseAvailable()) {
      return false; // Indica que deve usar fallback
    }
    
    console.log('💾 [Supabase] Salvando registro VI ALA no Supabase...');
    
    // Converter formato Excel para formato Supabase
    const dataToSave = {
      vi_ala: record['VI ALA'] || '',
      ala: record['ALA'] || null,
      data: record['DATA'] || null,
      projetista: record['PROJETISTA'] || null,
      cidade: record['CIDADE'] || null,
      endereco: record['ENDEREÇO'] || null,
      latitude: record['LATITUDE'] ? parseFloat(record['LATITUDE']) : null,
      longitude: record['LONGITUDE'] ? parseFloat(record['LONGITUDE']) : null
    };
    
    // Validar campos obrigatórios
    if (!dataToSave.vi_ala) {
      throw new Error('VI ALA é obrigatório');
    }
    
    // Inserir no Supabase
    const { error } = await supabase
      .from('vi_ala')
      .insert([dataToSave]);
    
    if (error) {
      console.error('❌ [Supabase] Erro ao inserir VI ALA:', error);
      return false;
    }
    
    console.log(`✅ [Supabase] Registro VI ALA salvo: ${dataToSave.vi_ala}`);
    return true; // Sucesso
  } catch (err) {
    console.error('❌ [Supabase] Erro ao salvar registro VI ALA:', err);
    return false; // Fallback para Excel
  }
}

// Função para salvar registro na base_VI_ALA.xlsx (fallback)
async function saveVIALARecordToExcel(record) {
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
      console.log('✅ [Excel] Registro VI ALA salvo:', record['VI ALA']);
      
      return true;
    } catch (err) {
      console.error('❌ [Excel] Erro ao salvar registro VI ALA:', err);
      throw err;
    }
  });
}

// Função para salvar registro VI ALA (tenta Supabase primeiro, fallback para Excel)
async function saveVIALARecord(record) {
  // Tentar Supabase primeiro
  const saved = await saveVIALARecordToSupabase(record);
  if (saved) {
    return; // Sucesso no Supabase
  }
  
  // Fallback para Excel
  console.log('⚠️ [Save] Usando fallback Excel para salvar VI ALA');
  await saveVIALARecordToExcel(record);
}

// Rota para listar projetistas
app.get('/api/projetistas', async (req, res) => {
  try {
    // Usar versão assíncrona que tenta Supabase primeiro
    const projetistas = await readProjetistasAsync();
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
    
    // Tentar adicionar no Supabase primeiro
    if (supabase && isSupabaseAvailable()) {
      try {
        // Verificar se já existe
        const { data: existing } = await supabase
          .from('projetistas')
          .select('nome')
          .ilike('nome', nomeLimpo)
          .limit(1);
        
        if (existing && existing.length > 0) {
          return res.json({ success: false, error: 'Projetista já existe' });
        }
        
        // Inserir no Supabase
        const { error } = await supabase
          .from('projetistas')
          .insert([{ nome: nomeLimpo, senha: senhaLimpa }]);
        
        if (error) {
          throw error;
        }
        
        console.log(`✅ [Supabase] Projetista '${nomeLimpo}' adicionado no Supabase`);
        
        // Buscar todos para retornar
        const projetistas = await readProjetistasAsync();
        const nomesProjetistas = projetistas.map(p => p.nome);
        
        return res.json({ success: true, projetistas: nomesProjetistas, message: 'Projetista adicionado com sucesso' });
      } catch (supabaseErr) {
        console.error('❌ [Supabase] Erro ao adicionar projetista, usando fallback Excel:', supabaseErr);
        // Continuar com fallback Excel
      }
    }
    
    // Fallback: usar Excel
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
    
    // Tentar deletar no Supabase primeiro
    if (supabase && isSupabaseAvailable()) {
      try {
        // Buscar projetista para verificar se existe
        const { data: existing } = await supabase
          .from('projetistas')
          .select('nome')
          .ilike('nome', nomeDecoded)
          .limit(1);
        
        if (!existing || existing.length === 0) {
          const projetistas = await readProjetistasAsync();
          const nomesAntes = projetistas.map(p => p.nome);
          return res.json({ 
            success: false, 
            projetistas: nomesAntes, 
            message: 'Projetista não encontrado' 
          });
        }
        
        // Deletar do Supabase
        const { error } = await supabase
          .from('projetistas')
          .delete()
          .ilike('nome', nomeDecoded);
        
        if (error) {
          throw error;
        }
        
        console.log(`✅ [Supabase] Projetista '${nomeDecoded}' deletado do Supabase`);
        
        // Buscar todos para retornar
        const projetistas = await readProjetistasAsync();
        const nomesProjetistas = projetistas.map(p => p.nome);
        
        return res.json({ 
          success: true, 
          projetistas: nomesProjetistas, 
          message: `Projetista '${nomeDecoded}' deletado com sucesso` 
        });
      } catch (supabaseErr) {
        console.error('❌ [Supabase] Erro ao deletar projetista, usando fallback Excel:', supabaseErr);
        // Continuar com fallback Excel
      }
    }
    
    // Fallback: usar Excel
    let projetistas = readProjetistas();
    
    const nomesAntes = projetistas.map(p => typeof p === 'string' ? p : p.nome);
    console.log(`📋 [Excel] Projetistas antes da exclusão: ${nomesAntes.join(', ')}`);
    
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
    
    console.log(`📊 [Excel] Projetistas antes: ${projetistasAntes}, depois: ${projetistasDepois}`);
    
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
app.post('/api/auth/login', async (req, res) => {
  try {
    const { usuario, senha } = req.body;
    
    if (!usuario || !usuario.trim()) {
      return res.status(400).json({ success: false, error: 'Usuário é obrigatório' });
    }
    
    if (!senha || !senha.trim()) {
      return res.status(400).json({ success: false, error: 'Senha é obrigatória' });
    }
    
    const usuarioLimpo = usuario.trim();
    const senhaLimpa = senha.trim();
    
    // Tentar buscar no Supabase primeiro
    if (supabase && isSupabaseAvailable()) {
      try {
        const { data, error } = await supabase
          .from('projetistas')
          .select('nome, senha')
          .ilike('nome', usuarioLimpo)
          .limit(1);
        
        if (error) {
          throw error;
        }
        
        if (!data || data.length === 0) {
          return res.json({ success: false, error: 'Usuário ou senha incorretos' });
        }
        
        const projetista = data[0];
        if (projetista.senha !== senhaLimpa) {
          return res.json({ success: false, error: 'Usuário ou senha incorretos' });
        }
        
        // Login válido - continuar com registro de sessão
      } catch (supabaseErr) {
        console.error('❌ [Supabase] Erro ao validar login, usando fallback Excel:', supabaseErr);
        // Continuar com fallback Excel
        const projetistas = readProjetistas();
        
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
      }
    } else {
      // Fallback: usar Excel
      const projetistas = readProjetistas();
      
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
    
    // Tentar atualizar no Supabase primeiro
    if (supabase && isSupabaseAvailable()) {
      try {
        // Buscar projetista
        const { data: existing } = await supabase
          .from('projetistas')
          .select('id, nome')
          .ilike('nome', nomeDecoded)
          .limit(1);
        
        if (!existing || existing.length === 0) {
          return res.status(404).json({ success: false, error: 'Projetista não encontrado' });
        }
        
        // Atualizar senha
        const { error } = await supabase
          .from('projetistas')
          .update({ senha: senha.trim() })
          .eq('id', existing[0].id);
        
        if (error) {
          throw error;
        }
        
        console.log(`✅ [Supabase] Senha do projetista '${nomeDecoded}' atualizada no Supabase`);
        return res.json({ success: true, message: 'Senha atualizada com sucesso' });
      } catch (supabaseErr) {
        console.error('❌ [Supabase] Erro ao atualizar senha, usando fallback Excel:', supabaseErr);
        // Continuar com fallback Excel
      }
    }
    
    // Fallback: usar Excel
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
app.put('/api/projetistas/:nome/name', async (req, res) => {
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
    
    // Tentar atualizar no Supabase primeiro
    if (supabase && isSupabaseAvailable()) {
      try {
        // Verificar se novo nome já existe
        const { data: nomeExiste } = await supabase
          .from('projetistas')
          .select('nome')
          .ilike('nome', novoNomeLimpo)
          .limit(1);
        
        if (nomeExiste && nomeExiste.length > 0 && nomeExiste[0].nome.toLowerCase() !== nomeDecoded.toLowerCase()) {
          return res.status(400).json({ success: false, error: 'Este nome já está em uso por outro usuário' });
        }
        
        // Buscar projetista
        const { data: existing } = await supabase
          .from('projetistas')
          .select('id, nome, senha')
          .ilike('nome', nomeDecoded)
          .limit(1);
        
        if (!existing || existing.length === 0) {
          return res.status(404).json({ success: false, error: 'Projetista não encontrado' });
        }
        
        // Atualizar nome
        const { error } = await supabase
          .from('projetistas')
          .update({ nome: novoNomeLimpo })
          .eq('id', existing[0].id);
        
        if (error) {
          throw error;
        }
        
        console.log(`✅ [Supabase] Nome do projetista '${nomeDecoded}' atualizado para '${novoNomeLimpo}' no Supabase`);
        
        // Atualizar sessões ativas se o usuário estiver logado
        if (activeSessions[nomeDecoded]) {
          const sessionData = activeSessions[nomeDecoded];
          delete activeSessions[nomeDecoded];
          activeSessions[novoNomeLimpo] = sessionData;
          console.log(`🔄 Sessão ativa atualizada: '${nomeDecoded}' → '${novoNomeLimpo}'`);
        }
        
        // Atualizar histórico de logout se existir
        if (logoutHistory[nomeDecoded]) {
          logoutHistory[novoNomeLimpo] = logoutHistory[nomeDecoded];
          delete logoutHistory[nomeDecoded];
        }
        
        return res.json({ success: true, message: 'Nome atualizado com sucesso', novoNome: novoNomeLimpo });
      } catch (supabaseErr) {
        console.error('❌ [Supabase] Erro ao atualizar nome, usando fallback Excel:', supabaseErr);
        // Continuar com fallback Excel
      }
    }
    
    // Fallback: usar Excel
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
    await saveProjetistas(projetistas);
    
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
// OTIMIZAÇÃO: Aceita tanto Buffer (memória) quanto caminho de arquivo (disco)
function validateExcelStructure(filePathOrBuffer) {
  try {
    // Determinar se é caminho de arquivo ou buffer
    const isFilePath = typeof filePathOrBuffer === 'string';
    
    // Ler apenas metadados primeiro (muito rápido)
    // Se for caminho de arquivo, ler do disco diretamente (economiza memória)
    const workbook = XLSX.read(filePathOrBuffer, { 
      type: isFilePath ? 'file' : 'buffer',
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

// Rota GET para /api/upload-base (retorna erro informativo)
app.get('/api/upload-base', (req, res) => {
  console.log('⚠️ [Upload] Requisição GET recebida em /api/upload-base (deveria ser POST)');
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.status(405).json({
    success: false,
    error: 'Método não permitido. Use POST para fazer upload de arquivos.',
    method: req.method,
    allowedMethods: ['POST']
  });
});

// Rota para upload e atualização da base de dados
app.post('/api/upload-base', (req, res, next) => {
  console.log('📥 [Upload] Requisição POST recebida para upload de base de dados');
  console.log('📥 [Upload] Método:', req.method);
  console.log('📥 [Upload] Origin:', req.headers.origin);
  console.log('📥 [Upload] Content-Type:', req.headers['content-type']);
  console.log('📥 [Upload] Path:', req.path);
  console.log('📥 [Upload] URL completa:', req.url);
  
  // Garantir headers CORS ANTES de qualquer processamento
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  
  // Configurar timeout maior para uploads grandes (2 minutos = 120 segundos)
  // Railway tem timeout de gateway de ~30s, mas precisamos tempo para receber arquivo grande
  req.setTimeout(2 * 60 * 1000); // 2 minutos para receber o arquivo
  res.setTimeout(2 * 60 * 1000); // 2 minutos para enviar resposta
  
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
  // Obter origin novamente para garantir que está disponível
  const origin = req.headers.origin;
  
  try {
    if (!req.file) {
      // Garantir headers CORS
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      
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
      // Garantir headers CORS
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      
      return res.status(400).json({
        success: false,
        error: 'Formato de arquivo inválido. Apenas arquivos Excel (.xlsx ou .xls) são aceitos.'
      });
    }

    // Obter informações do arquivo
    const tempFilePath = req.file.path;
    const fileSize = req.file.size;
    const fileName = req.file.originalname;
    
    console.log(`📤 Arquivo recebido: ${fileName} (${fileSize} bytes)`);
    console.log(`📋 Tipo MIME: ${req.file.mimetype}`);
    console.log(`💾 Arquivo salvo temporariamente em: ${tempFilePath}`);

    // Garantir headers CORS na resposta ANTES de qualquer processamento
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    // RESPONDER IMEDIATAMENTE para evitar timeout do Railway
    // Validar e processar em background
    res.json({
      success: true,
      message: `Upload recebido! Validando e processando arquivo em background...`,
      processing: true,
      fileSize: fileSize,
      fileName: fileName
    });
    
    console.log(`💾 [Upload] Arquivo salvo temporariamente em: ${tempFilePath} (${fileSize} bytes)`);
    
    // Processar validação e salvamento em background (não bloqueia resposta)
    (async () => {
      let tempFileDeleted = false;
      try {
        console.log('🔍 [Background] Iniciando validação do arquivo...');
        
        // OTIMIZAÇÃO DE MEMÓRIA: Validar diretamente do arquivo no disco
        // Isso evita carregar o arquivo inteiro na memória
        const validation = validateExcelStructure(tempFilePath);
        console.log(`📊 [Background] Resultado da validação:`, validation);
        
        if (!validation.valid) {
          console.error(`❌ [Background] Validação falhou: ${validation.error}`);
          // Deletar arquivo temporário
          try {
            await fsPromises.unlink(tempFilePath);
            tempFileDeleted = true;
            console.log('🗑️ [Background] Arquivo temporário removido após validação falhar');
          } catch (unlinkErr) {
            console.error('❌ [Background] Erro ao remover arquivo temporário:', unlinkErr);
          }
          return;
        }

        console.log(`✅ [Background] Validação bem-sucedida: ${validation.validRows} linhas válidas de ${validation.totalRows} total`);
        
        // Obter data atual para nomear arquivos
        const now = new Date();
        const dateStr = formatDateForFilename(now);
        
        // Tentar importar para Supabase ANTES de salvar arquivo Excel
        let supabaseImported = false;
        let importedRows = 0;
        if (supabase && isSupabaseAvailable()) {
          try {
            console.log('📤 [Background] ===== INICIANDO IMPORTAÇÃO SUPABASE =====');
            console.log('📤 [Background] Lendo dados do Excel para importar no Supabase...');
            
            // Ler dados do arquivo Excel
            const workbook = XLSX.readFile(tempFilePath);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const excelData = XLSX.utils.sheet_to_json(worksheet);
            
            console.log(`📊 [Background] Total de linhas no Excel: ${excelData.length}`);
            
            if (excelData && excelData.length > 0) {
              // Mostrar primeiras colunas encontradas para debug
              if (excelData.length > 0) {
                const firstRow = excelData[0];
                const columns = Object.keys(firstRow);
                console.log(`📋 [Background] Colunas encontradas no Excel (${columns.length}):`, columns.slice(0, 10).join(', '), columns.length > 10 ? '...' : '');
              }
              
              // Função auxiliar para converter data
              const parseDate = (value) => {
                if (!value) return null;
                if (value instanceof Date) return value.toISOString().split('T')[0];
                if (typeof value === 'string') {
                  // Tentar parsear diferentes formatos
                  const date = new Date(value);
                  if (!isNaN(date.getTime())) {
                    return date.toISOString().split('T')[0];
                  }
                }
                if (typeof value === 'number') {
                  // Excel serial date
                  const date = XLSX.SSF.parse_date_code(value);
                  if (date) {
                    return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
                  }
                }
                return null;
              };
              
              // Converter para formato Supabase
              let validCount = 0;
              let invalidCount = 0;
              const ctosToImport = excelData
                .map((row, index) => {
                  try {
                    // Normalizar nomes de colunas (case insensitive)
                    const normalizeKey = (key) => {
                      const lower = String(key || '').toLowerCase().trim();
                      const mapping = {
                        'cid_rede': 'cid_rede',
                        'cid rede': 'cid_rede',
                        'estado': 'estado',
                        'pop': 'pop',
                        'olt': 'olt',
                        'slot': 'slot',
                        'pon': 'pon',
                        'id_cto': 'id_cto',
                        'id cto': 'id_cto',
                        'cto': 'cto',
                        'latitude': 'latitude',
                        'lat': 'latitude',
                        'longitude': 'longitude',
                        'long': 'longitude',
                        'lng': 'longitude',
                        'status_cto': 'status_cto',
                        'status cto': 'status_cto',
                        'data_cadastro': 'data_cadastro',
                        'data cadastro': 'data_cadastro',
                        'portas': 'portas',
                        'ocupado': 'ocupado',
                        'livre': 'livre',
                        'pct_ocup': 'pct_ocup',
                        'pct ocup': 'pct_ocup'
                      };
                      return mapping[lower] || lower;
                    };
                    
                    const normalizedRow = {};
                    for (const key in row) {
                      const normalizedKey = normalizeKey(key);
                      normalizedRow[normalizedKey] = row[key];
                    }
                    
                    // Converter valores
                    let lat = normalizedRow.latitude;
                    let lng = normalizedRow.longitude;
                    
                    // Tentar converter para número se for string
                    if (typeof lat === 'string') {
                      lat = lat.replace(',', '.');
                      lat = parseFloat(lat);
                    }
                    if (typeof lng === 'string') {
                      lng = lng.replace(',', '.');
                      lng = parseFloat(lng);
                    }
                    
                    const cto = {
                      cid_rede: normalizedRow.cid_rede || null,
                      estado: normalizedRow.estado || null,
                      pop: normalizedRow.pop || null,
                      olt: normalizedRow.olt || null,
                      slot: normalizedRow.slot || null,
                      pon: normalizedRow.pon || null,
                      id_cto: normalizedRow.id_cto || null,
                      cto: normalizedRow.cto || null,
                      latitude: (lat && !isNaN(lat)) ? lat : null,
                      longitude: (lng && !isNaN(lng)) ? lng : null,
                      status_cto: normalizedRow.status_cto || null,
                      data_cadastro: parseDate(normalizedRow.data_cadastro),
                      portas: normalizedRow.portas ? parseInt(normalizedRow.portas) : null,
                      ocupado: normalizedRow.ocupado ? parseInt(normalizedRow.ocupado) : null,
                      livre: normalizedRow.livre ? parseInt(normalizedRow.livre) : null,
                      pct_ocup: normalizedRow.pct_ocup ? parseFloat(normalizedRow.pct_ocup) : null
                    };
                    
                    // Filtrar apenas linhas com coordenadas válidas (essenciais)
                    if (cto.latitude && cto.longitude && 
                        !isNaN(cto.latitude) && !isNaN(cto.longitude) &&
                        cto.latitude >= -90 && cto.latitude <= 90 &&
                        cto.longitude >= -180 && cto.longitude <= 180) {
                      validCount++;
                      return cto;
                    }
                    invalidCount++;
                    return null;
                  } catch (rowErr) {
                    console.warn(`⚠️ [Background] Erro ao processar linha ${index + 1}:`, rowErr.message);
                    invalidCount++;
                    return null;
                  }
                })
                .filter(cto => cto !== null); // Remover inválidos
              
              console.log(`📊 [Background] CTOs processadas: ${validCount} válidas, ${invalidCount} inválidas`);
              console.log(`📊 [Background] Total de CTOs para importar: ${ctosToImport.length}`);
              
              if (ctosToImport.length > 0) {
                // Deletar todas as CTOs existentes antes de importar (substituição completa)
                console.log('🗑️ [Background] Limpando CTOs antigas do Supabase...');
                const { error: deleteError, count: deleteCount } = await supabase
                  .from('ctos')
                  .delete()
                  .neq('id', 0); // Deletar todos
                
                if (deleteError) {
                  console.error('❌ [Background] Erro ao limpar CTOs antigas:', deleteError);
                  console.error('❌ [Background] Detalhes do erro:', JSON.stringify(deleteError, null, 2));
                  throw deleteError;
                }
                
                console.log(`✅ [Background] CTOs antigas removidas (${deleteCount || 'N/A'} registros)`);
                
                // Importar em lotes de 1000 para melhor performance
                const BATCH_SIZE = 1000;
                let imported = 0;
                const totalBatches = Math.ceil(ctosToImport.length / BATCH_SIZE);
                
                console.log(`📦 [Background] Importando em ${totalBatches} lote(s) de até ${BATCH_SIZE} registros cada...`);
                
                for (let i = 0; i < ctosToImport.length; i += BATCH_SIZE) {
                  const batch = ctosToImport.slice(i, i + BATCH_SIZE);
                  const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
                  
                  console.log(`📦 [Background] Importando lote ${batchNumber}/${totalBatches} (${batch.length} registros)...`);
                  
                  const { error: insertError, data: insertData } = await supabase
                    .from('ctos')
                    .insert(batch)
                    .select('id');
                  
                  if (insertError) {
                    console.error(`❌ [Background] Erro ao importar lote ${batchNumber}:`, insertError);
                    console.error(`❌ [Background] Detalhes do erro:`, JSON.stringify(insertError, null, 2));
                    console.error(`❌ [Background] Primeiro registro do lote:`, JSON.stringify(batch[0], null, 2));
                    throw insertError;
                  }
                  
                  imported += batch.length;
                  console.log(`✅ [Background] Lote ${batchNumber}/${totalBatches} importado: ${imported}/${ctosToImport.length} CTOs`);
                }
                
                importedRows = imported;
                supabaseImported = true;
                
                // Registrar no histórico de uploads
                try {
                  const { error: historyError } = await supabase
                    .from('upload_history')
                    .insert([{
                      file_name: fileName,
                      file_size: fileSize,
                      total_rows: excelData.length,
                      valid_rows: importedRows,
                      uploaded_by: req.body?.usuario || req.user?.nome || 'Sistema'
                    }]);
                  
                  if (historyError) {
                    console.warn('⚠️ [Background] Erro ao registrar histórico (não crítico):', historyError);
                  } else {
                    console.log('✅ [Background] Histórico de upload registrado');
                  }
                } catch (historyErr) {
                  console.warn('⚠️ [Background] Erro ao registrar histórico (não crítico):', historyErr.message);
                }
                
                console.log(`✅ [Background] ===== IMPORTAÇÃO SUPABASE CONCLUÍDA =====`);
                console.log(`✅ [Background] ${importedRows} CTOs importadas com sucesso no Supabase!`);
              } else {
                console.warn('⚠️ [Background] Nenhuma CTO válida encontrada para importar');
                console.warn(`⚠️ [Background] Total de linhas no Excel: ${excelData.length}`);
                console.warn(`⚠️ [Background] Linhas válidas: ${validCount}, Linhas inválidas: ${invalidCount}`);
                console.warn(`⚠️ [Background] Verifique se o Excel contém colunas 'latitude' e 'longitude' com valores válidos`);
              }
            } else {
              console.warn('⚠️ [Background] Excel está vazio ou não contém dados');
            }
          } catch (supabaseErr) {
            console.error('❌ [Background] ===== ERRO NA IMPORTAÇÃO SUPABASE =====');
            console.error('❌ [Background] Erro ao importar para Supabase:', supabaseErr.message);
            console.error('❌ [Background] Tipo do erro:', supabaseErr.name);
            console.error('❌ [Background] Stack:', supabaseErr.stack);
            if (supabaseErr.details) {
              console.error('❌ [Background] Detalhes:', supabaseErr.details);
            }
            if (supabaseErr.hint) {
              console.error('❌ [Background] Dica:', supabaseErr.hint);
            }
            console.error('❌ [Background] Continuando com salvamento Excel (fallback)...');
            // Continuar com salvamento Excel (não quebrar o fluxo)
          }
        } else {
          console.log('⚠️ [Background] Supabase não disponível, pulando importação');
        }
        
        // Processar operações de arquivo de forma sequencial e segura
        console.log('📂 [Background] Procurando arquivos existentes...');
        
        // 1. Encontrar TODAS as bases antigas (base_atual_*.xlsx)
        const allFiles = await fsPromises.readdir(DATA_DIR);
        const allBaseAtualFiles = allFiles.filter(file => 
          file.startsWith('base_atual_') && file.endsWith('.xlsx')
        );
        
        console.log(`📋 [Background] Encontradas ${allBaseAtualFiles.length} base(s) antiga(s) para substituir`);
        
        // 2. Encontrar a base atual mais recente (se existir) para fazer backup
        const currentBasePath = await findCurrentBaseFile();
        
        // 3. Se existe base atual, criar backup ANTES de deletar
        if (currentBasePath) {
          const backupFileName = `backup_${dateStr}.xlsx`;
          const newBackupPath = path.join(DATA_DIR, backupFileName);
          
          // Criar backup da base atual (renomear ou copiar)
          try {
            await fsPromises.rename(currentBasePath, newBackupPath);
            console.log(`💾 [Background] Base atual movida para backup: ${backupFileName}`);
          } catch (err) {
            console.warn('⚠️ [Background] Erro ao renomear, tentando copiar...', err.message);
            try {
              await fsPromises.copyFile(currentBasePath, newBackupPath);
              console.log(`💾 [Background] Backup criado por cópia: ${backupFileName}`);
            } catch (copyErr) {
              console.error('❌ [Background] Erro ao copiar para backup:', copyErr);
              // Continuar mesmo se backup falhar
            }
          }
        }
        
        // 5. DELETAR TODAS as bases antigas (base_atual_*.xlsx)
        // Isso garante que não fiquem múltiplas bases antigas
        // IMPORTANTE: Não deletar a base atual se ela ainda existir (caso backup foi feito por cópia)
        for (const oldFile of allBaseAtualFiles) {
          const oldFilePath = path.join(DATA_DIR, oldFile);
          
          // Se esta é a base atual e ainda existe (backup foi feito por cópia), pular
          if (currentBasePath && oldFilePath === currentBasePath && fs.existsSync(currentBasePath)) {
            console.log(`⏭️ [Background] Pulando base atual (já tem backup): ${oldFile}`);
            continue;
          }
          
          try {
            await fsPromises.unlink(oldFilePath);
            console.log(`🗑️ [Background] Base antiga removida: ${oldFile}`);
          } catch (err) {
            console.error(`❌ [Background] Erro ao remover base antiga ${oldFile}:`, err.message);
            // Continuar mesmo se uma falhar
          }
        }
        
        // Se a base atual ainda existe após backup (foi copiada, não renomeada), deletá-la agora
        if (currentBasePath && fs.existsSync(currentBasePath)) {
          try {
            await fsPromises.unlink(currentBasePath);
            console.log(`🗑️ [Background] Base atual original removida após backup: ${path.basename(currentBasePath)}`);
          } catch (err) {
            console.error(`❌ [Background] Erro ao remover base atual original:`, err.message);
            // Continuar mesmo se falhar
          }
        }
        
        // 6. Limpar backups antigos (manter apenas os 3 mais recentes)
        const allBackupFiles = allFiles.filter(file => 
          file.startsWith('backup_') && file.endsWith('.xlsx')
        );
        
        if (allBackupFiles.length > 3) {
          // Obter stats de todos os backups
          const backupFilesWithStats = await Promise.all(
            allBackupFiles.map(async (file) => {
              const filePath = path.join(DATA_DIR, file);
              const stats = await fsPromises.stat(filePath);
              return {
                name: file,
                path: filePath,
                mtime: stats.mtime
              };
            })
          );
          
          // Ordenar por data (mais recente primeiro)
          backupFilesWithStats.sort((a, b) => b.mtime - a.mtime);
          
          // Deletar backups antigos (manter apenas os 3 mais recentes)
          const backupsToDelete = backupFilesWithStats.slice(3);
          for (const backup of backupsToDelete) {
            try {
              await fsPromises.unlink(backup.path);
              console.log(`🗑️ [Background] Backup antigo removido: ${backup.name}`);
            } catch (err) {
              console.error(`❌ [Background] Erro ao remover backup antigo ${backup.name}:`, err.message);
            }
          }
        }
        
        // 7. Salvar NOVA base como base_atual_DD-MM-YYYY.xlsx
        // OTIMIZAÇÃO: Mover arquivo temporário em vez de copiar (mais rápido e usa menos memória)
        const newBaseFileName = `base_atual_${dateStr}.xlsx`;
        const newBasePath = path.join(DATA_DIR, newBaseFileName);
        
        console.log(`💾 [Background] Movendo arquivo temporário para: ${newBaseFileName} (${fileSize} bytes)`);
        
        // Mover arquivo temporário para a localização final (mais eficiente que copiar)
        try {
          await fsPromises.rename(tempFilePath, newBasePath);
          tempFileDeleted = true; // Arquivo foi movido, não precisa deletar
          console.log(`✅ [Background] Arquivo movido com sucesso (sem usar memória extra)`);
        } catch (renameErr) {
          // Se renomear falhar (pode ser por estar em volumes diferentes), copiar
          console.warn('⚠️ [Background] Erro ao renomear, copiando arquivo...', renameErr.message);
          await fsPromises.copyFile(tempFilePath, newBasePath);
          // Deletar arquivo temporário após copiar
          await fsPromises.unlink(tempFilePath);
          tempFileDeleted = true;
          console.log(`✅ [Background] Arquivo copiado e temporário removido`);
        }
        
        console.log(`✅ [Background] Nova base de dados salva com sucesso: ${newBaseFileName}`);
        console.log(`✅ [Background] Processamento concluído: ${validation.validRows} linhas válidas de ${validation.totalRows} total`);
        if (supabaseImported) {
          console.log(`✅ [Background] ${importedRows} CTOs importadas no Supabase`);
        } else {
          console.log(`⚠️ [Background] Importação Supabase não realizada (usando apenas Excel)`);
        }
        console.log(`✅ [Background] Base antiga substituída - sistema agora usa: ${newBaseFileName}`);
      } catch (err) {
        console.error('❌ [Background] Erro ao processar arquivo em background:', err);
        console.error('❌ [Background] Stack:', err.stack);
        
        // Garantir que arquivo temporário seja deletado mesmo em caso de erro
        if (!tempFileDeleted && tempFilePath) {
          try {
            await fsPromises.unlink(tempFilePath);
            console.log('🗑️ [Background] Arquivo temporário removido após erro');
          } catch (unlinkErr) {
            console.error('❌ [Background] Erro ao remover arquivo temporário após erro:', unlinkErr);
          }
        }
        // Não podemos retornar erro ao cliente (já respondemos), apenas logar
      }
    })();
  } catch (err) {
    console.error('❌ Erro ao fazer upload da base de dados:', err);
    console.error('❌ Stack trace:', err.stack);
    
    // Garantir headers CORS mesmo em caso de erro
    const errorOrigin = req.headers.origin;
    if (errorOrigin) {
      res.setHeader('Access-Control-Allow-Origin', errorOrigin);
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
    
    // Tentar adicionar no Supabase primeiro
    if (supabase && isSupabaseAvailable()) {
      try {
        // Verificar se já existe
        const { data: existing } = await supabase
          .from('tabulacoes')
          .select('nome')
          .ilike('nome', nomeLimpo)
          .limit(1);
        
        if (existing && existing.length > 0) {
          const tabulacoes = await readTabulacoes();
          return res.json({ success: true, tabulacoes, message: 'Tabulação já existe' });
        }
        
        // Inserir no Supabase
        const { error } = await supabase
          .from('tabulacoes')
          .insert([{ nome: nomeLimpo }]);
        
        if (error) {
          throw error;
        }
        
        console.log(`✅ [Supabase] Tabulação '${nomeLimpo}' adicionada no Supabase`);
        
        // Buscar todas para retornar
        const tabulacoes = await readTabulacoes();
        
        return res.json({ success: true, tabulacoes, message: 'Tabulação adicionada com sucesso' });
      } catch (supabaseErr) {
        console.error('❌ [Supabase] Erro ao adicionar tabulação, usando fallback Excel:', supabaseErr);
        // Continuar com fallback Excel
      }
    }
    
    // Fallback: usar Excel
    let tabulacoes = await readTabulacoes();
    
    // Verificar se já existe
    if (tabulacoes.includes(nomeLimpo)) {
      return res.json({ success: true, tabulacoes, message: 'Tabulação já existe' });
    }
    
    // Adicionar nova tabulação
    tabulacoes.push(nomeLimpo);
    tabulacoes.sort(); // Ordenar alfabeticamente
    
    // Salvar
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
    
    const nomeLimpo = nome.trim();
    
    // Tentar deletar no Supabase primeiro
    if (supabase && isSupabaseAvailable()) {
      try {
        // Buscar tabulação para verificar se existe
        const { data: existing } = await supabase
          .from('tabulacoes')
          .select('nome')
          .ilike('nome', nomeLimpo)
          .limit(1);
        
        if (!existing || existing.length === 0) {
          return res.status(404).json({ success: false, error: 'Tabulação não encontrada' });
        }
        
        // Deletar do Supabase
        const { error } = await supabase
          .from('tabulacoes')
          .delete()
          .ilike('nome', nomeLimpo);
        
        if (error) {
          throw error;
        }
        
        console.log(`✅ [Supabase] Tabulação '${nomeLimpo}' deletada do Supabase`);
        
        // Buscar todas para retornar
        const tabulacoes = await readTabulacoes();
        
        return res.json({ success: true, tabulacoes, message: 'Tabulação deletada com sucesso' });
      } catch (supabaseErr) {
        console.error('❌ [Supabase] Erro ao deletar tabulação, usando fallback Excel:', supabaseErr);
        // Continuar com fallback Excel
      }
    }
    
    // Fallback: usar Excel
    let tabulacoes = await readTabulacoes();
    
    // Verificar se existe
    const index = tabulacoes.indexOf(nomeLimpo);
    if (index === -1) {
      return res.status(404).json({ success: false, error: 'Tabulação não encontrada' });
    }
    
    // Remover tabulação
    tabulacoes.splice(index, 1);
    
    // Salvar
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
    // Garantir headers CORS
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
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

// Rota para testar conexão com Supabase
app.get('/api/test-supabase', async (req, res) => {
  try {
    // Garantir headers CORS
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    console.log('🔍 [API] Testando conexão com Supabase...');
    
    // Testar conexão
    const connectionTest = await testSupabaseConnection();
    
    // Verificar tabelas
    const tablesCheck = await checkTables();
    
    res.json({
      success: connectionTest.success,
      connection: connectionTest,
      tables: tablesCheck,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('❌ [API] Erro ao testar Supabase:', err);
    
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    res.status(500).json({
      success: false,
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Rota raiz - retorna informações da API
app.get('/', (req, res) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.json({
    success: true,
    message: 'API Viabilidade Alares - Backend',
    version: '1.0.0',
    status: 'online',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      test: '/api/test',
      upload: '/api/upload-base',
      login: '/api/auth/login',
      logout: '/api/auth/logout',
      users: '/api/users/online',
      projetistas: '/api/projetistas',
      tabulacoes: '/api/tabulacoes',
      viAla: {
        next: '/api/vi-ala/next',
        save: '/api/vi-ala/save',
        list: '/api/vi-ala/list',
        download: '/api/vi-ala.xlsx'
      }
    }
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
try {
  const server = app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Servidor rodando em http://0.0.0.0:${PORT}`);
    console.log(`📁 Pasta de dados: ${DATA_DIR}`);
    console.log(`📁 Arquivo projetistas: ${PROJETISTAS_FILE}`);
    console.log(`📁 Arquivo base CTOs: ${BASE_CTOS_FILE}`);
    console.log(`📁 Arquivo tabulações: ${TABULACOES_FILE}`);
    console.log(`✅ Servidor iniciado com sucesso!`);
    
    // Testar conexão com Supabase na inicialização (não bloqueia)
    (async () => {
      try {
        console.log('🔍 [Startup] Testando conexão com Supabase...');
        const connectionTest = await testSupabaseConnection();
        if (connectionTest.success) {
          console.log('✅ [Startup] Conexão com Supabase OK!');
          
          // Verificar tabelas
          const tablesCheck = await checkTables();
          const existingTables = Object.entries(tablesCheck)
            .filter(([_, status]) => status.exists)
            .map(([table, _]) => table);
          
          if (existingTables.length > 0) {
            console.log(`✅ [Startup] Tabelas encontradas: ${existingTables.join(', ')}`);
          } else {
            console.log('⚠️ [Startup] Nenhuma tabela encontrada. Execute o schema SQL no Supabase.');
          }
        } else {
          console.log('⚠️ [Startup] Conexão com Supabase falhou:', connectionTest.error);
          console.log('⚠️ [Startup] Verifique as variáveis de ambiente SUPABASE_URL e SUPABASE_SERVICE_KEY');
        }
      } catch (err) {
        console.error('❌ [Startup] Erro ao testar Supabase:', err.message);
        console.log('⚠️ [Startup] O servidor continuará funcionando, mas Supabase pode não estar disponível');
      }
    })();
  });
  
  // Configurar timeout do servidor (2 minutos para uploads grandes)
  // Railway pode ter timeout de gateway, mas aumentamos o máximo possível
  server.timeout = 2 * 60 * 1000; // 2 minutos (120 segundos)
  server.keepAliveTimeout = 120000; // 2 minutos
  server.headersTimeout = 121000; // 2 minutos + 1 segundo
  
  // Tratamento de erros do servidor
  server.on('error', (err) => {
    console.error('❌ [Server] Erro no servidor:', err);
  });
  
} catch (err) {
  console.error('❌ [Fatal] Erro ao iniciar servidor:', err);
  console.error('❌ [Fatal] Stack:', err.stack);
  process.exit(1);
}

