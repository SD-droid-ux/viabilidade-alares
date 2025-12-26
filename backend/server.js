import express from 'express';
import cors from 'cors';
import XLSX from 'xlsx';
import ExcelJS from 'exceljs';
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

// Flag para controlar upload em andamento (pausa requisições de verificação de usuários)
let uploadInProgress = false;
let uploadPromise = null; // Promise que resolve quando upload termina

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
      console.log('⚠️ [Supabase] Supabase não disponível, retornando null para fallback');
      return null; // Retorna null para indicar que deve usar fallback
    }
    
    console.log('📂 [Supabase] ===== CARREGANDO CTOs DO SUPABASE =====');
    console.log('📂 [Supabase] Verificando conexão e disponibilidade...');
    
    // Primeiro, contar quantas CTOs existem
    const { count, error: countError } = await supabase
      .from('ctos')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      console.error('❌ [Supabase] Erro ao contar CTOs:', countError);
      return null; // Fallback para Excel
    }
    
    console.log(`📊 [Supabase] Total de CTOs no banco: ${count || 0}`);
    
    if (!count || count === 0) {
      console.log('⚠️ [Supabase] Nenhuma CTO encontrada no Supabase (retornando array vazio)');
      console.log('⚠️ [Supabase] Isso indica que Supabase está funcionando, mas a tabela está vazia');
      return []; // Retornar array vazio (não null) para indicar que Supabase está funcionando, mas vazio
    }
    
    // Buscar TODOS os registros usando paginação
    // Supabase tem limite de 1000 registros por query, então precisamos paginar
    const BATCH_SIZE = 1000; // Tamanho do lote (máximo do Supabase)
    let allData = [];
    let offset = 0;
    let hasMore = true;
    let batchNumber = 0;
    
    console.log(`📥 [Supabase] Buscando ${count} CTOs em lotes de ${BATCH_SIZE}...`);
    
    while (hasMore) {
      batchNumber++;
      console.log(`📥 [Supabase] Buscando lote ${batchNumber} (offset: ${offset}, limite: ${BATCH_SIZE})...`);
      
      const { data, error } = await supabase
        .from('ctos')
        .select('*')
        .order('created_at', { ascending: false })
        .range(offset, offset + BATCH_SIZE - 1); // range é inclusivo: [offset, offset + BATCH_SIZE - 1]
      
      if (error) {
        console.error(`❌ [Supabase] Erro ao buscar lote ${batchNumber}:`, error);
        console.error('❌ [Supabase] Código do erro:', error.code);
        console.error('❌ [Supabase] Mensagem:', error.message);
        if (error.details) {
          console.error('❌ [Supabase] Detalhes:', error.details);
        }
        if (error.hint) {
          console.error('❌ [Supabase] Dica:', error.hint);
        }
        // Se houver erro, retornar o que já foi carregado (se houver) ou null
        if (allData.length > 0) {
          console.warn(`⚠️ [Supabase] Erro ao buscar lote ${batchNumber}, retornando ${allData.length} CTOs já carregadas`);
          break; // Retornar dados parciais
        }
        return null; // Fallback para Excel
      }
      
      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }
      
      allData = allData.concat(data);
      console.log(`✅ [Supabase] Lote ${batchNumber} carregado: ${data.length} CTOs (total acumulado: ${allData.length})`);
      
      // Se retornou menos que o tamanho do lote, não há mais dados
      if (data.length < BATCH_SIZE) {
        hasMore = false;
        break;
      }
      
      offset += BATCH_SIZE;
      
      // Log de progresso a cada 10 lotes
      if (batchNumber % 10 === 0) {
        console.log(`📊 [Supabase] Progresso: ${allData.length} / ${count} CTOs carregadas (${Math.round((allData.length / count) * 100)}%)`);
      }
    }
    
    console.log(`✅ [Supabase] ${allData.length} CTOs carregadas do Supabase (de ${count} total)`);
    console.log('📊 [Supabase] Convertendo dados para formato Excel...');
    
    // Converter para formato Excel (mesma estrutura do arquivo)
    // IMPORTANTE: Garantir que valores numéricos sejam convertidos corretamente
    const excelData = (allData || []).map((row, index) => {
      // Converter latitude e longitude (críticos para o frontend)
      let latitude = row.latitude;
      if (latitude !== null && latitude !== undefined) {
        latitude = typeof latitude === 'number' ? latitude : parseFloat(latitude);
        if (isNaN(latitude)) latitude = '';
      } else {
        latitude = '';
      }
      
      let longitude = row.longitude;
      if (longitude !== null && longitude !== undefined) {
        longitude = typeof longitude === 'number' ? longitude : parseFloat(longitude);
        if (isNaN(longitude)) longitude = '';
      } else {
        longitude = '';
      }
      
      // Converter portas, ocupado, livre (números inteiros)
      let portas = row.portas;
      if (portas !== null && portas !== undefined) {
        portas = typeof portas === 'number' ? portas : parseInt(portas);
        if (isNaN(portas)) portas = '';
      } else {
        portas = '';
      }
      
      let ocupado = row.ocupado;
      if (ocupado !== null && ocupado !== undefined) {
        ocupado = typeof ocupado === 'number' ? ocupado : parseInt(ocupado);
        if (isNaN(ocupado)) ocupado = '';
      } else {
        ocupado = '';
      }
      
      let livre = row.livre;
      if (livre !== null && livre !== undefined) {
        livre = typeof livre === 'number' ? livre : parseInt(livre);
        if (isNaN(livre)) livre = '';
      } else {
        livre = '';
      }
      
      // Converter pct_ocup (número decimal)
      let pct_ocup = row.pct_ocup;
      if (pct_ocup !== null && pct_ocup !== undefined) {
        pct_ocup = typeof pct_ocup === 'number' ? pct_ocup : parseFloat(pct_ocup);
        if (isNaN(pct_ocup)) pct_ocup = '';
      } else {
        pct_ocup = '';
      }
      
      // Converter data_cadastro (formato string ou Date)
      let data_cadastro = row.data_cadastro;
      if (data_cadastro !== null && data_cadastro !== undefined) {
        if (data_cadastro instanceof Date) {
          // Se for Date, converter para string no formato YYYY-MM-DD
          data_cadastro = data_cadastro.toISOString().split('T')[0];
        } else if (typeof data_cadastro === 'string') {
          // Se for string, manter como está (já deve estar no formato correto)
          data_cadastro = data_cadastro;
        } else {
          data_cadastro = String(data_cadastro);
        }
      } else {
        data_cadastro = '';
      }
      
      // Converter outros campos (strings)
      const excelRow = {
        cid_rede: row.cid_rede ? String(row.cid_rede) : '',
        estado: row.estado ? String(row.estado) : '',
        pop: row.pop ? String(row.pop) : '',
        olt: row.olt ? String(row.olt) : '',
        slot: row.slot ? String(row.slot) : '',
        pon: row.pon ? String(row.pon) : '',
        id_cto: row.id_cto ? String(row.id_cto) : '',
        cto: row.cto ? String(row.cto) : '',
        latitude: latitude !== '' ? latitude : '',
        longitude: longitude !== '' ? longitude : '',
        status_cto: row.status_cto ? String(row.status_cto) : '',
        data_cadastro: data_cadastro,
        portas: portas !== '' ? portas : '',
        ocupado: ocupado !== '' ? ocupado : '',
        livre: livre !== '' ? livre : '',
        pct_ocup: pct_ocup !== '' ? pct_ocup : ''
      };
      
      // Log de amostra (primeiras 3 linhas)
      if (index < 3) {
        console.log(`📋 [Supabase] Exemplo linha ${index + 1}:`, {
          id_cto: excelRow.id_cto,
          cto: excelRow.cto,
          latitude: excelRow.latitude,
          longitude: excelRow.longitude,
          portas: excelRow.portas,
          ocupado: excelRow.ocupado
        });
      }
      
      return excelRow;
    });
    
    console.log(`✅ [Supabase] ${excelData.length} CTOs convertidas para formato Excel`);
    console.log('✅ [Supabase] ===== CONVERSÃO CONCLUÍDA =====');
    
    return excelData;
  } catch (err) {
    console.error('❌ [Supabase] ===== ERRO AO LER CTOs =====');
    console.error('❌ [Supabase] Erro:', err.message);
    console.error('❌ [Supabase] Tipo:', err.name);
    console.error('❌ [Supabase] Stack:', err.stack);
    return null; // Fallback para Excel
  }
}

// Nova rota OTIMIZADA: Buscar CTOs próximas por coordenadas (não carrega todas)
// Esta é a solução para resolver o problema de memória - busca apenas CTOs próximas
app.get('/api/ctos/nearby', async (req, res) => {
  try {
    // Garantir headers CORS
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radiusMeters = parseFloat(req.query.radius || 350); // Default 350m (margem para distância real via ruas)
    
    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'Latitude e longitude são obrigatórios' });
    }
    
    console.log(`🔍 [API] Buscando CTOs próximas de (${lat}, ${lng}) em raio de ${radiusMeters}m`);
    
    if (supabase && isSupabaseAvailable()) {
      try {
        // Calcular bounding box (caixa delimitadora) para filtrar eficientemente
        // Aproximação: 1 grau ≈ 111km, então radiusMeters/111000 graus
        const radiusDegrees = radiusMeters / 111000;
        const latMin = lat - radiusDegrees;
        const latMax = lat + radiusDegrees;
        const lngMin = lng - radiusDegrees;
        const lngMax = lng + radiusDegrees;
        
        // Buscar CTOs dentro da bounding box primeiro (muito eficiente com índice)
        const { data, error } = await supabase
          .from('ctos')
          .select('*')
          .gte('latitude', latMin)
          .lte('latitude', latMax)
          .gte('longitude', lngMin)
          .lte('longitude', lngMax);
        
        if (error) {
          console.error('❌ [API] Erro ao buscar CTOs:', error);
          throw error;
        }
        
        // Função de cálculo de distância geodésica (Haversine)
        const calculateDistance = (lat1, lng1, lat2, lng2) => {
          const R = 6371000; // Raio da Terra em metros
          const dLat = (lat2 - lat1) * Math.PI / 180;
          const dLng = (lng2 - lng1) * Math.PI / 180;
          const a = 
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          return R * c;
        };
        
        // Filtrar por distância exata e calcular distâncias
        const nearbyCTOs = (data || [])
          .map(row => {
            const distance = calculateDistance(lat, lng, parseFloat(row.latitude), parseFloat(row.longitude));
            return {
              nome: row.cto || row.id_cto || '',
              latitude: parseFloat(row.latitude),
              longitude: parseFloat(row.longitude),
              vagas_total: row.portas || 0,
              clientes_conectados: row.ocupado || 0,
              pct_ocup: row.pct_ocup || 0,
              cidade: row.cid_rede || '',
              pop: row.pop || '',
              id: row.id_cto || row.id?.toString() || '',
              distancia_metros: Math.round(distance * 100) / 100
            };
          })
          .filter(cto => cto.distancia_metros <= radiusMeters)
          .sort((a, b) => a.distancia_metros - b.distancia_metros)
          .slice(0, 5); // Limitar a 5 CTOs mais próximas (mesmo número usado no frontend)
        
        console.log(`✅ [API] ${nearbyCTOs.length} CTOs encontradas próximas (de ${data?.length || 0} na bounding box)`);
        
        return res.json({
          success: true,
          ctos: nearbyCTOs,
          count: nearbyCTOs.length
        });
      } catch (supabaseErr) {
        console.error('❌ [API] Erro ao buscar CTOs do Supabase:', supabaseErr);
        return res.status(500).json({ error: 'Erro ao buscar CTOs', details: supabaseErr.message });
      }
    } else {
      return res.status(503).json({ error: 'Supabase não disponível' });
    }
  } catch (err) {
    console.error('❌ [API] Erro na rota /api/ctos/nearby:', err);
    return res.status(500).json({ error: 'Erro interno', details: err.message });
  }
});

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
    
    console.log('📥 [Base] ===== REQUISIÇÃO /api/base.xlsx RECEBIDA =====');
    console.log('📥 [Base] Timestamp:', new Date().toISOString());
    
    // Tentar usar Supabase primeiro (com streaming para grandes volumes)
    if (supabase && isSupabaseAvailable()) {
      try {
        console.log('✅ [Base] Usando dados do Supabase com STREAMING');
        
        // Primeiro, contar quantas CTOs existem
        const { count, error: countError } = await supabase
          .from('ctos')
          .select('*', { count: 'exact', head: true });
        
        if (countError) {
          console.error('❌ [Supabase] Erro ao contar CTOs:', countError);
          throw countError;
        }
        
        console.log(`📊 [Supabase] Total de CTOs no banco: ${count || 0}`);
        
        if (!count || count === 0) {
          console.log('⚠️ [Supabase] Nenhuma CTO encontrada, criando Excel vazio...');
          // Criar Excel vazio
          const workbook = new ExcelJS.Workbook();
          const worksheet = workbook.addWorksheet('CTOs');
          worksheet.columns = [
            { header: 'CID_REDE', key: 'cid_rede' },
            { header: 'ESTADO', key: 'estado' },
            { header: 'POP', key: 'pop' },
            { header: 'OLT', key: 'olt' },
            { header: 'SLOT', key: 'slot' },
            { header: 'PON', key: 'pon' },
            { header: 'ID_CTO', key: 'id_cto' },
            { header: 'CTO', key: 'cto' },
            { header: 'LATITUDE', key: 'latitude' },
            { header: 'LONGITUDE', key: 'longitude' },
            { header: 'STATUS_CTO', key: 'status_cto' },
            { header: 'DATA_CADASTRO', key: 'data_cadastro' },
            { header: 'PORTAS', key: 'portas' },
            { header: 'OCUPADO', key: 'ocupado' },
            { header: 'LIVRE', key: 'livre' },
            { header: 'PCT_OCUP', key: 'pct_ocup' }
          ];
          
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', 'attachment; filename="base.xlsx"');
          await workbook.xlsx.write(res);
          return;
        }
        
        // SOLUÇÃO OTIMIZADA: Usar XLSX que é mais eficiente em memória
        // Processar e acumular dados em lotes controlados com GC frequente
        
        // SOLUÇÃO FINAL: XLSX é mais eficiente, mas ainda precisamos controlar memória
        // Reduzir batch size e fazer GC muito mais frequente para evitar acúmulo
        
        const BATCH_SIZE = 5000; // Batch médio para equilibrar velocidade e memória
        let offset = 0;
        let hasMore = true;
        let batchNumber = 0;
        let totalProcessed = 0;
        const allRows = []; // Array para acumular linhas
        
        console.log(`📥 [Supabase] Buscando ${count} CTOs em lotes de ${BATCH_SIZE} e gerando Excel com XLSX...`);
        
        // Função auxiliar para converter tipos (otimizada - sem criar objetos desnecessários)
        const convertValue = (value, type = 'string') => {
          if (value === null || value === undefined) return '';
          if (type === 'number') {
            if (typeof value === 'number') return value;
            const num = parseFloat(value);
            return isNaN(num) ? '' : num;
          }
          if (type === 'int') {
            if (typeof value === 'number') return value;
            const num = parseInt(value);
            return isNaN(num) ? '' : num;
          }
          if (type === 'date') {
            if (value instanceof Date) return value.toISOString().split('T')[0];
            return String(value);
          }
          return String(value || '');
        };
        
        try {
          // Processar em lotes e acumular (XLSX gera Excel de forma eficiente quando tudo está pronto)
          while (hasMore) {
            batchNumber++;
            
            // Buscar lote do Supabase
            const { data, error } = await supabase
              .from('ctos')
              .select('*')
              .order('created_at', { ascending: false })
              .range(offset, offset + BATCH_SIZE - 1);
            
            if (error) {
              console.error(`❌ [Supabase] Erro ao buscar lote ${batchNumber}:`, error);
              throw error;
            }
            
            if (!data || data.length === 0) {
              hasMore = false;
              break;
            }
            
            // Converter lote e adicionar ao array
            for (const row of data) {
              allRows.push({
                'CID_REDE': convertValue(row.cid_rede),
                'ESTADO': convertValue(row.estado),
                'POP': convertValue(row.pop),
                'OLT': convertValue(row.olt),
                'SLOT': convertValue(row.slot),
                'PON': convertValue(row.pon),
                'ID_CTO': convertValue(row.id_cto),
                'CTO': convertValue(row.cto),
                'LATITUDE': convertValue(row.latitude, 'number'),
                'LONGITUDE': convertValue(row.longitude, 'number'),
                'STATUS_CTO': convertValue(row.status_cto),
                'DATA_CADASTRO': convertValue(row.data_cadastro, 'date'),
                'PORTAS': convertValue(row.portas, 'int'),
                'OCUPADO': convertValue(row.ocupado, 'int'),
                'LIVRE': convertValue(row.livre, 'int'),
                'PCT_OCUP': convertValue(row.pct_ocup, 'number')
              });
            }
            
            totalProcessed += data.length;
            
            // Log de progresso a cada 10 lotes
            if (batchNumber % 10 === 0 || totalProcessed === count) {
              const memUsage = process.memoryUsage();
              const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);
              console.log(`📊 [Supabase] Progresso: ${totalProcessed} / ${count} CTOs (${Math.round((totalProcessed / count) * 100)}%) | Memória: ${memMB}MB`);
            }
            
            // Se retornou menos que o tamanho do lote, não há mais dados
            if (data.length < BATCH_SIZE) {
              hasMore = false;
              break;
            }
            
            offset += BATCH_SIZE;
            
            // GC a cada lote (muito frequente para evitar acúmulo)
            if (global.gc && batchNumber % 2 === 0) {
              global.gc();
            }
          }
          
          console.log(`📊 [Supabase] Dados carregados (${allRows.length} linhas). Gerando Excel com XLSX...`);
          const memBeforeGen = process.memoryUsage().heapUsed;
          
          // Gerar Excel usando XLSX (muito mais eficiente que ExcelJS)
          const worksheet = XLSX.utils.json_to_sheet(allRows);
          const workbook = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(workbook, worksheet, 'CTOs');
          
          // Gerar buffer do Excel
          const excelBuffer = XLSX.write(workbook, { 
            type: 'buffer', 
            bookType: 'xlsx'
          });
          
          // Limpar referências imediatamente
          allRows.length = 0;
          
          // GC após gerar Excel
          if (global.gc) {
            global.gc();
          }
          
          const memAfterGen = process.memoryUsage().heapUsed;
          console.log(`✅ [Supabase] Excel gerado: ${totalProcessed} CTOs | Arquivo: ${Math.round(excelBuffer.length / 1024 / 1024)}MB`);
          
          // Configurar headers
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          res.setHeader('Content-Disposition', 'attachment; filename="base.xlsx"');
          res.setHeader('Content-Length', excelBuffer.length);
          
          // Enviar buffer
          res.send(excelBuffer);
          
          return;
        } catch (xlsxErr) {
          console.error('❌ [Supabase] Erro ao gerar Excel com XLSX:', xlsxErr);
          throw xlsxErr;
        }
      } catch (supabaseErr) {
        console.error('❌ [Supabase] Erro ao gerar Excel do Supabase, usando fallback:', supabaseErr);
        console.error('❌ [Supabase] Stack:', supabaseErr.stack);
        // Continuar com fallback Excel
      }
    } else {
      console.log('⚠️ [Base] Supabase não disponível, tentando fallback Excel...');
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
    // Garantir headers CORS
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    let lastModified = null;

    if (supabase && isSupabaseAvailable()) {
      // Tentar obter a data da última modificação do Supabase (ex: da tabela upload_history)
      const { data, error } = await supabase
        .from('upload_history')
        .select('uploaded_at')
        .order('uploaded_at', { ascending: false })
        .limit(1);

      if (error) {
        console.warn('⚠️ [API] Erro ao buscar lastModified do Supabase:', error.message);
        // Fallback para arquivo local se Supabase falhar
      } else if (data && data.length > 0) {
        lastModified = data[0].uploaded_at;
        console.log('✅ [API] LastModified do Supabase:', lastModified);
      }
    }

    if (!lastModified) {
      // Se não obteve do Supabase, tentar do arquivo local
      const currentBasePath = await findCurrentBaseFile();
      if (currentBasePath && fs.existsSync(currentBasePath)) {
        const stats = await fsPromises.stat(currentBasePath);
        lastModified = stats.mtime.toISOString();
        console.log('✅ [API] LastModified do arquivo local:', lastModified);
      } else {
        console.log('ℹ️ [API] Nenhuma base de dados encontrada para lastModified.');
      }
    }

    if (lastModified) {
      res.json({ success: true, lastModified });
    } else {
      res.status(404).json({ success: false, error: 'Nenhuma base de dados encontrada ou modificada.' });
    }
  } catch (err) {
    console.error('❌ [API] Erro ao obter lastModified:', err);
    
    // Garantir headers CORS mesmo em erro
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rota para deletar todos os dados da base de dados CTO
app.delete('/api/base/delete', async (req, res) => {
  try {
    // Garantir headers CORS
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    console.log('🗑️ [API] ===== INICIANDO DELEÇÃO DE BASE DE DADOS =====');

    let deletedFromSupabase = false;
    let deletedCount = 0;

    // Tentar deletar do Supabase primeiro
    if (supabase && isSupabaseAvailable()) {
      try {
        console.log('🗑️ [API] Deletando CTOs do Supabase...');
        
        // Primeiro, verificar quantos registros existem
        const { count: countBefore } = await supabase
          .from('ctos')
          .select('*', { count: 'exact', head: true });
        
        console.log(`📊 [API] Registros existentes antes da deleção: ${countBefore || 0}`);
        
        if (countBefore && countBefore > 0) {
          // Deletar TODOS os registros usando uma condição que sempre seja verdadeira
          let deleteSuccess = false;
          
          try {
            const { error: deleteError, count: countResult } = await supabase
              .from('ctos')
              .delete()
              .gte('created_at', '1970-01-01T00:00:00Z'); // Condição sempre verdadeira
            
            if (deleteError) {
              throw deleteError;
            }
            
            deletedCount = countResult || countBefore;
            deleteSuccess = true;
            console.log(`✅ [API] CTOs deletadas: ${deletedCount} registros`);
          } catch (deleteError) {
            console.warn('⚠️ [API] Método 1 falhou, tentando método alternativo...', deleteError.message);
            
            // Método alternativo: Deletar usando neq com UUID impossível
            try {
              const { error: deleteError2, count: countResult2 } = await supabase
                .from('ctos')
                .delete()
                .neq('id', '00000000-0000-0000-0000-000000000000');
              
              if (deleteError2) {
                throw deleteError2;
              }
              
              deletedCount = countResult2 || countBefore;
              deleteSuccess = true;
              console.log(`✅ [API] CTOs deletadas (método alternativo): ${deletedCount} registros`);
            } catch (deleteError2) {
              console.error('❌ [API] Método alternativo também falhou:', deleteError2);
              
              // Método 3: Deletar em lotes (última tentativa)
              console.log('⚠️ [API] Tentando deletar em lotes...');
              let deletedInBatches = 0;
              let batchSize = 1000;
              let hasMore = true;
              
              while (hasMore) {
                const { data: batch, error: batchError } = await supabase
                  .from('ctos')
                  .select('id')
                  .limit(batchSize);
                
                if (batchError) {
                  throw batchError;
                }
                
                if (!batch || batch.length === 0) {
                  hasMore = false;
                  break;
                }
                
                const idsToDelete = batch.map(row => row.id);
                const { error: batchDeleteError } = await supabase
                  .from('ctos')
                  .delete()
                  .in('id', idsToDelete);
                
                if (batchDeleteError) {
                  throw batchDeleteError;
                }
                
                deletedInBatches += idsToDelete.length;
                console.log(`🗑️ [API] Lote deletado: ${idsToDelete.length} registros (total: ${deletedInBatches})`);
                
                if (batch.length < batchSize) {
                  hasMore = false;
                }
              }
              
              deletedCount = deletedInBatches;
              deleteSuccess = true;
              console.log(`✅ [API] CTOs deletadas em lotes: ${deletedCount} registros`);
            }
          }
          
          // Verificar que a deleção foi bem-sucedida
          const { count: countAfter } = await supabase
            .from('ctos')
            .select('*', { count: 'exact', head: true });
          
          if (countAfter && countAfter > 0) {
            console.warn(`⚠️ [API] AINDA EXISTEM ${countAfter} registros após deleção!`);
            console.warn(`⚠️ [API] Isso pode indicar um problema. Continuando...`);
          } else {
            console.log(`✅ [API] Confirmação: Tabela ctos está vazia (${countAfter || 0} registros)`);
          }
          
          deletedFromSupabase = true;
        } else {
          console.log(`ℹ️ [API] Tabela ctos já está vazia, nada para deletar`);
          deletedFromSupabase = true;
        }
      } catch (supabaseErr) {
        console.error('❌ [API] ===== ERRO NA DELEÇÃO SUPABASE =====');
        console.error('❌ [API] Erro ao deletar do Supabase:', supabaseErr.message);
        console.error('❌ [API] Tipo do erro:', supabaseErr.name);
        console.error('❌ [API] Stack:', supabaseErr.stack);
        if (supabaseErr.details) {
          console.error('❌ [API] Detalhes:', supabaseErr.details);
        }
        if (supabaseErr.hint) {
          console.error('❌ [API] Dica:', supabaseErr.hint);
        }
        // Continuar para tentar deletar arquivos locais (fallback)
      }
    } else {
      console.log('⚠️ [API] Supabase não disponível, pulando deleção do Supabase');
    }

    // Deletar arquivos locais também (se existirem)
    try {
      const allFiles = await fsPromises.readdir(DATA_DIR);
      const allBaseAtualFiles = allFiles.filter(file => 
        file.startsWith('base_atual_') && file.endsWith('.xlsx')
      );
      
      if (allBaseAtualFiles.length > 0) {
        console.log(`🗑️ [API] Deletando ${allBaseAtualFiles.length} arquivo(s) local(is)...`);
        
        for (const file of allBaseAtualFiles) {
          const filePath = path.join(DATA_DIR, file);
          try {
            await fsPromises.unlink(filePath);
            console.log(`✅ [API] Arquivo local removido: ${file}`);
          } catch (err) {
            console.error(`❌ [API] Erro ao remover arquivo local ${file}:`, err.message);
          }
        }
      } else {
        console.log('ℹ️ [API] Nenhum arquivo local encontrado para deletar');
      }
    } catch (fileErr) {
      console.warn('⚠️ [API] Erro ao deletar arquivos locais (não crítico):', fileErr.message);
    }

    console.log(`✅ [API] ===== DELEÇÃO CONCLUÍDA =====`);
    
    if (deletedFromSupabase) {
      res.json({
        success: true,
        message: `Base de dados deletada com sucesso! ${deletedCount > 0 ? `${deletedCount} CTOs removidas.` : 'Tabela já estava vazia.'}`,
        deletedCount
      });
    } else {
      res.json({
        success: true,
        message: 'Tentativa de deleção realizada. Verifique os logs para detalhes.',
        deletedCount: 0
      });
    }
  } catch (err) {
    console.error('❌ [API] Erro ao deletar base de dados:', err);
    console.error('❌ [API] Stack:', err.stack);
    
    // Garantir headers CORS mesmo em erro
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    res.status(500).json({
      success: false,
      error: `Erro ao deletar base de dados: ${err.message || 'Erro desconhecido'}`
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
      // Fallback: buscar manualmente TODOS os registros para encontrar o maior número
      console.log('⚠️ [Supabase] Função SQL não disponível, buscando manualmente TODOS os registros...');
      
      // Buscar todos os registros em lotes para garantir que pegamos o maior número
      let maxNumber = 0;
      let offset = 0;
      const BATCH_SIZE = 1000;
      let hasMore = true;
      let totalProcessed = 0;
      
      // Primeiro, contar total de registros para saber quantos processar
      const { count: totalCount } = await supabase
        .from('vi_ala')
        .select('*', { count: 'exact', head: true });
      
      console.log(`📊 [Supabase] Total de VI ALAs no banco: ${totalCount || 0}`);
      
      while (hasMore) {
        const { data, error } = await supabase
          .from('vi_ala')
          .select('vi_ala')
          .order('created_at', { ascending: false })
          .range(offset, offset + BATCH_SIZE - 1);
        
        if (error) {
          console.error('❌ [Supabase] Erro ao buscar VI ALAs:', error);
          break;
        }
        
        // Processar lote atual
        if (data && data.length > 0) {
          for (const row of data) {
            const viAla = row.vi_ala || '';
            if (viAla && typeof viAla === 'string') {
              // Extrair número do VI ALA (formato: "VI ALA-0000001" ou "VI ALA - 0000001")
              const match = viAla.match(/VI\s*ALA[-\s]*(\d+)/i);
              if (match) {
                const number = parseInt(match[1], 10);
                if (!isNaN(number) && number > maxNumber) {
                  maxNumber = number;
                }
              }
            }
          }
          totalProcessed += data.length;
        }
        
        // Verificar se há mais registros
        if (!data || data.length < BATCH_SIZE) {
          hasMore = false;
        } else {
          offset += BATCH_SIZE;
        }
      }
      
      const nextNumber = maxNumber + 1;
      const nextVIALA = `VI ALA-${String(nextNumber).padStart(7, '0')}`;
      
      console.log(`✅ [Supabase] Próximo VI ALA gerado: ${nextVIALA} (max encontrado: ${maxNumber}, próximo: ${nextNumber}, registros processados: ${totalProcessed}/${totalCount || 0})`);
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
    console.log('💾 [Supabase] Dados recebidos:', record);
    
    // Converter data do formato "DD/MM/YYYY HH:MM" para "YYYY-MM-DD" (formato PostgreSQL DATE)
    let dataConvertida = null;
    if (record['DATA']) {
      const dataStr = String(record['DATA']).trim();
      // Tentar vários formatos de data
      if (dataStr.includes('/')) {
        // Formato DD/MM/YYYY ou DD/MM/YYYY HH:MM
        const partes = dataStr.split(' ')[0].split('/'); // Pega só a data, ignora hora
        if (partes.length === 3) {
          const dia = partes[0].padStart(2, '0');
          const mes = partes[1].padStart(2, '0');
          const ano = partes[2];
          dataConvertida = `${ano}-${mes}-${dia}`; // PostgreSQL: YYYY-MM-DD
        }
      } else if (dataStr.match(/^\d{4}-\d{2}-\d{2}/)) {
        // Já está no formato YYYY-MM-DD
        dataConvertida = dataStr.split(' ')[0]; // Pega só a data, ignora hora se houver
      }
      
      if (!dataConvertida) {
        console.warn('⚠️ [Supabase] Formato de data não reconhecido:', dataStr);
        // Tentar criar data a partir de string ISO se possível
        try {
          const dateObj = new Date(dataStr);
          if (!isNaN(dateObj.getTime())) {
            dataConvertida = dateObj.toISOString().split('T')[0]; // YYYY-MM-DD
          }
        } catch (e) {
          console.warn('⚠️ [Supabase] Não foi possível converter data:', e);
        }
      }
    }
    
    // Converter formato Excel para formato Supabase
    const dataToSave = {
      vi_ala: record['VI ALA'] || '',
      ala: record['ALA'] || null,
      data: dataConvertida, // Data convertida para formato PostgreSQL
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
    
    console.log('💾 [Supabase] Dados formatados para salvar:', dataToSave);
    
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
// Função para processar Excel em STREAMING REAL usando exceljs (para arquivos grandes)
// Esta função usa streaming reader que processa linha por linha SEM carregar arquivo na memória
async function processExcelStreaming(filePath, supabaseClient) {
  let totalRows = 0;
  let totalValid = 0;
  let totalInvalid = 0;
  let importedRows = 0;
  const BATCH_SIZE = 2500; // Tamanho otimizado para velocidade (Supabase suporta até 5000, mas 2500 é o ponto ideal)
  let currentBatch = [];
  let batchNumber = 0;
  let headers = {};
  let isFirstRow = true;
  const startTime = Date.now();
  
  // Função auxiliar para converter data
  const parseDate = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString().split('T')[0];
    if (typeof value === 'string') {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    }
    if (typeof value === 'number') {
      // Excel serial date
      const excelEpoch = new Date(1899, 11, 30);
      const date = new Date(excelEpoch.getTime() + value * 86400000);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    }
    return null;
  };
  
  // Função para normalizar chaves
  const normalizeKey = (key) => {
    const lower = String(key || '').toLowerCase().trim();
    const mapping = {
      'cid_rede': 'cid_rede', 'cid rede': 'cid_rede', 'estado': 'estado', 'pop': 'pop',
      'olt': 'olt', 'slot': 'slot', 'pon': 'pon', 'id_cto': 'id_cto', 'id cto': 'id_cto', 'cto': 'cto',
      'latitude': 'latitude', 'lat': 'latitude', 'longitude': 'longitude', 'long': 'longitude', 'lng': 'longitude',
      'status_cto': 'status_cto', 'status cto': 'status_cto', 'data_cadastro': 'data_cadastro', 'data cadastro': 'data_cadastro',
      'portas': 'portas', 'ocupado': 'ocupado', 'livre': 'livre', 'pct_ocup': 'pct_ocup', 'pct ocup': 'pct_ocup'
    };
    return mapping[lower] || lower;
  };
  
  // Função para inserir lote no Supabase (otimizada para velocidade)
  const insertBatch = async (batch) => {
    if (batch.length === 0) return;
    
    batchNumber++;
    const { error } = await supabaseClient
      .from('ctos')
      .insert(batch);
    
    if (error) {
      console.error(`❌ [Streaming] Erro ao importar lote ${batchNumber}:`, error);
      throw error;
    }
    
    importedRows += batch.length;
    
    // Log apenas a cada 5 lotes para não sobrecarregar (melhor performance)
    if (batchNumber % 5 === 0 || batchNumber === 1) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = elapsed > 0 ? (importedRows / elapsed).toFixed(0) : '0';
      console.log(`✅ [Streaming] Lote ${batchNumber}: ${batch.length} CTOs | Total: ${importedRows} | Taxa: ${rate} CTOs/s`);
    }
    
    // GC apenas a cada 20 lotes (não a cada lote para não perder velocidade)
    if (batchNumber % 20 === 0 && global.gc) {
      global.gc();
    }
  };
  
  try {
    console.log('📖 [Streaming] Lendo arquivo Excel em modo STREAMING REAL (sem carregar na memória)...');
    
    // Usar streaming reader do exceljs - NÃO carrega arquivo inteiro na memória
    const stream = fs.createReadStream(filePath);
    const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(stream, {
      sharedStrings: 'cache', // Cache para melhor performance (com 4GB de memória pode usar cache)
      hyperlinks: 'ignore', // Ignorar hyperlinks
      styles: 'ignore', // Ignorar estilos
      worksheets: 'emit' // Emitir worksheets como streams
    });
    
    let worksheetReader = null;
    let processedRows = 0;
    
    // Processar workbook em streaming
    for await (const worksheetReaderItem of workbookReader) {
      worksheetReader = worksheetReaderItem;
      console.log(`📋 [Streaming] Processando planilha: ${worksheetReader.name}`);
      
      // Processar cada linha do worksheet em streaming
      for await (const row of worksheetReader) {
        // Primeira linha = cabeçalho
        if (isFirstRow) {
          isFirstRow = false;
          // Processar cabeçalho
          row.eachCell((cell, colNumber) => {
            const headerValue = cell.value ? String(cell.value).trim() : '';
            if (headerValue) {
              headers[colNumber] = normalizeKey(headerValue);
            }
          });
          console.log(`📋 [Streaming] Colunas detectadas: ${Object.keys(headers).length}`);
          continue; // Pular cabeçalho
        }
        
        // Processar linha de dados
        totalRows++;
        processedRows++;
        
        try {
          const rowData = {};
          
          // Ler apenas células com valores
          row.eachCell((cell, colNumber) => {
            if (headers[colNumber] && cell.value !== null && cell.value !== undefined) {
              rowData[headers[colNumber]] = cell.value;
            }
          });
          
          let lat = rowData.latitude;
          let lng = rowData.longitude;
          
          // Converter coordenadas
          if (typeof lat === 'string') {
            lat = lat.replace(',', '.');
            lat = parseFloat(lat);
          }
          if (typeof lng === 'string') {
            lng = lng.replace(',', '.');
            lng = parseFloat(lng);
          }
          
          const cto = {
            cid_rede: rowData.cid_rede || null,
            estado: rowData.estado || null,
            pop: rowData.pop || null,
            olt: rowData.olt || null,
            slot: rowData.slot || null,
            pon: rowData.pon || null,
            id_cto: rowData.id_cto || null,
            cto: rowData.cto || null,
            latitude: (lat && !isNaN(lat)) ? lat : null,
            longitude: (lng && !isNaN(lng)) ? lng : null,
            status_cto: rowData.status_cto || null,
            data_cadastro: parseDate(rowData.data_cadastro),
            portas: rowData.portas ? parseInt(rowData.portas) : null,
            ocupado: rowData.ocupado ? parseInt(rowData.ocupado) : null,
            livre: rowData.livre ? parseInt(rowData.livre) : null,
            pct_ocup: rowData.pct_ocup ? parseFloat(rowData.pct_ocup) : null
          };
          
          // Validar coordenadas
          if (cto.latitude && cto.longitude && 
              !isNaN(cto.latitude) && !isNaN(cto.longitude) &&
              cto.latitude >= -90 && cto.latitude <= 90 &&
              cto.longitude >= -180 && cto.longitude <= 180) {
            totalValid++;
            currentBatch.push(cto);
            
            // Inserir lote quando atingir tamanho
            if (currentBatch.length >= BATCH_SIZE) {
              await insertBatch(currentBatch);
              currentBatch = []; // Limpar batch explicitamente
            }
          } else {
            totalInvalid++;
          }
        } catch (rowErr) {
          totalInvalid++;
        }
        
        // Log de progresso a cada 20000 linhas (menos frequente = mais rápido)
        if (processedRows % 20000 === 0) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          const memUsage = process.memoryUsage();
          const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);
          console.log(`📊 [Streaming] ${processedRows} linhas processadas | ${importedRows} importadas | ${memMB}MB | ${elapsed}s`);
        }
      }
    }
    
    // Inserir lote restante
    if (currentBatch.length > 0) {
      await insertBatch(currentBatch);
    }
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const avgRate = totalRows > 0 ? (importedRows / (totalTime / 60)).toFixed(0) : 0;
    console.log(`📊 [Streaming] Processamento concluído: ${totalRows} linhas, ${totalValid} válidas, ${totalInvalid} inválidas`);
    console.log(`✅ [Streaming] ${importedRows} CTOs importadas no Supabase em ${totalTime}s (média: ~${avgRate} CTOs/min)`);
    
    return {
      totalRows,
      validRows: totalValid,
      invalidRows: totalInvalid,
      importedRows
    };
  } catch (err) {
    console.error('❌ [Streaming] Erro ao processar Excel:', err);
    throw err;
  }
}

// Validação ultra-leve: apenas verifica se é um arquivo Excel válido
// A validação detalhada será feita durante o processamento em streaming
function validateExcelStructure(filePathOrBuffer) {
  try {
    const isFilePath = typeof filePathOrBuffer === 'string';
    
    // Para arquivos muito grandes, fazer apenas validação básica
    // Verificar se o arquivo existe (se for caminho)
    if (isFilePath && !fs.existsSync(filePathOrBuffer)) {
      return { valid: false, error: 'Arquivo não encontrado' };
    }
    
    // Verificar extensão do arquivo (se for caminho)
    if (isFilePath && !filePathOrBuffer.match(/\.(xlsx|xls)$/i)) {
      return { valid: false, error: 'Arquivo deve ter extensão .xlsx ou .xls' };
    }
    
    // Para arquivos grandes, apenas verificar se é um Excel válido usando exceljs (mais eficiente)
    // Não carregar tudo na memória
    return {
      valid: true,
      totalRows: 0, // Será calculado durante processamento
      validRows: 0,
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
    // Criar promise para controlar quando upload termina
    let resolveUpload;
    uploadPromise = new Promise((resolve) => {
      resolveUpload = resolve;
    });
    uploadInProgress = true;
    console.log('⏸️ [Upload] Flag de upload ativada - requisições /api/users/online serão pausadas');
    
    (async () => {
      let tempFileDeleted = false;
      try {
        console.log('🔍 [Background] Iniciando processamento do arquivo...');
        console.log('ℹ️ [Background] Validação será feita durante processamento em chunks (economiza memória)');

    // Obter data atual para nomear arquivos
    const now = new Date();
    const dateStr = formatDateForFilename(now);
    
        // Tentar importar para Supabase ANTES de salvar arquivo Excel
        let supabaseImported = false;
        let importedRows = 0;
        let totalRows = 0;
        if (supabase && isSupabaseAvailable()) {
          try {
            console.log('📤 [Background] ===== INICIANDO IMPORTAÇÃO SUPABASE =====');
            console.log('📤 [Background] Usando processamento em STREAMING (exceljs) para arquivos grandes...');
            
            // Deletar todas as CTOs existentes antes de importar
            console.log('🗑️ [Background] Limpando CTOs antigas do Supabase...');
            
            // Primeiro, verificar quantos registros existem
            const { count: countBefore } = await supabase
              .from('ctos')
              .select('*', { count: 'exact', head: true });
            
            console.log(`📊 [Background] Registros existentes antes da limpeza: ${countBefore || 0}`);
            
            if (countBefore && countBefore > 0) {
              // Deletar TODOS os registros usando uma condição que sempre seja verdadeira
              // Método 1: Usar gte com created_at (sempre verdadeiro para timestamps)
              let deleteSuccess = false;
              let deleteCount = 0;
              
              try {
                const { error: deleteError, count: countResult } = await supabase
                  .from('ctos')
                  .delete()
                  .gte('created_at', '1970-01-01T00:00:00Z'); // Condição sempre verdadeira
                
                if (deleteError) {
                  throw deleteError;
                }
                
                deleteCount = countResult || countBefore;
                deleteSuccess = true;
                console.log(`✅ [Background] CTOs deletadas: ${deleteCount} registros`);
              } catch (deleteError) {
                console.warn('⚠️ [Background] Método 1 falhou, tentando método alternativo...', deleteError.message);
                
                // Método 2: Deletar usando neq com UUID impossível
                try {
                  const { error: deleteError2, count: countResult2 } = await supabase
                    .from('ctos')
                    .delete()
                    .neq('id', '00000000-0000-0000-0000-000000000000');
                  
                  if (deleteError2) {
                    throw deleteError2;
                  }
                  
                  deleteCount = countResult2 || countBefore;
                  deleteSuccess = true;
                  console.log(`✅ [Background] CTOs deletadas (método alternativo): ${deleteCount} registros`);
                } catch (deleteError2) {
                  console.error('❌ [Background] Método alternativo também falhou:', deleteError2);
                  
                  // Método 3: Deletar em lotes (última tentativa)
                  console.log('⚠️ [Background] Tentando deletar em lotes...');
                  let deletedInBatches = 0;
                  let batchSize = 1000;
                  let hasMore = true;
                  
                  while (hasMore) {
                    const { data: batch, error: batchError } = await supabase
                      .from('ctos')
                      .select('id')
                      .limit(batchSize);
                    
                    if (batchError) {
                      throw batchError;
                    }
                    
                    if (!batch || batch.length === 0) {
                      hasMore = false;
                      break;
                    }
                    
                    const idsToDelete = batch.map(row => row.id);
                    const { error: batchDeleteError } = await supabase
                      .from('ctos')
                      .delete()
                      .in('id', idsToDelete);
                    
                    if (batchDeleteError) {
                      throw batchDeleteError;
                    }
                    
                    deletedInBatches += idsToDelete.length;
                    console.log(`🗑️ [Background] Lote deletado: ${idsToDelete.length} registros (total: ${deletedInBatches})`);
                    
                    if (batch.length < batchSize) {
                      hasMore = false;
                    }
                  }
                  
                  deleteCount = deletedInBatches;
                  deleteSuccess = true;
                  console.log(`✅ [Background] CTOs deletadas em lotes: ${deleteCount} registros`);
                }
              }
              
              // Verificar que a deleção foi bem-sucedida
              const { count: countAfter } = await supabase
                .from('ctos')
                .select('*', { count: 'exact', head: true });
              
              if (countAfter && countAfter > 0) {
                console.warn(`⚠️ [Background] AINDA EXISTEM ${countAfter} registros após deleção!`);
                console.warn(`⚠️ [Background] Isso pode indicar um problema. Continuando com importação...`);
              } else {
                console.log(`✅ [Background] Confirmação: Tabela ctos está vazia (${countAfter || 0} registros)`);
              }
            } else {
              console.log(`ℹ️ [Background] Tabela ctos já está vazia, pulando deleção`);
            }
            
            // Processar usando streaming (exceljs) - NÃO carrega arquivo inteiro na memória
            const result = await processExcelStreaming(tempFilePath, supabase);
            totalRows = result.totalRows;
            importedRows = result.importedRows;
            
            if (importedRows > 0) {
              supabaseImported = true;
              
              // Registrar no histórico de uploads
              try {
                const { error: historyError } = await supabase
                  .from('upload_history')
                  .insert([{
                    file_name: fileName,
                    file_size: fileSize,
                    total_rows: totalRows,
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
              console.warn(`⚠️ [Background] Total de linhas: ${totalRows}, Válidas: ${result.validRows}, Inválidas: ${result.invalidRows}`);
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
        console.log(`✅ [Background] Processamento concluído`);
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
      } finally {
        // Sempre liberar flag e resolver promise quando upload terminar
        uploadInProgress = false;
        if (resolveUpload) {
          resolveUpload();
          console.log('✅ [Upload] Flag de upload desativada - requisições /api/users/online retomadas');
        }
        uploadPromise = null;
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
app.get('/api/users/online', async (req, res) => {
  try {
    // Garantir headers CORS
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    // Se upload estiver em andamento, aguardar até terminar (com timeout)
    if (uploadInProgress && uploadPromise) {
      console.log('⏸️ [Users/Online] Upload em andamento, aguardando conclusão...');
      const MAX_WAIT_TIME = 5 * 60 * 1000; // 5 minutos máximo de espera
      const startWait = Date.now();
      
      try {
        // Aguardar upload terminar (com timeout)
        await Promise.race([
          uploadPromise,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout aguardando upload')), MAX_WAIT_TIME)
          )
        ]);
        console.log(`✅ [Users/Online] Upload concluído, processando requisição (aguardou ${Date.now() - startWait}ms)`);
      } catch (waitErr) {
        if (waitErr.message === 'Timeout aguardando upload') {
          console.warn(`⚠️ [Users/Online] Timeout aguardando upload (${MAX_WAIT_TIME}ms), retornando dados atuais`);
          // Continuar mesmo se timeout (retornar dados atuais)
        } else {
          console.warn(`⚠️ [Users/Online] Erro ao aguardar upload: ${waitErr.message}, retornando dados atuais`);
          // Continuar mesmo se erro (retornar dados atuais)
        }
      }
    }
    
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

// Rota para verificar quantas CTOs existem no Supabase (debug)
app.get('/api/debug/ctos-count', async (req, res) => {
  try {
    // Garantir headers CORS
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    console.log('🔍 [Debug] Verificando quantidade de CTOs no Supabase...');
    
    if (!supabase || !isSupabaseAvailable()) {
      return res.json({
        success: false,
        error: 'Supabase não disponível',
        count: 0,
        source: 'none'
      });
    }
    
    // Contar CTOs
    const { count, error: countError } = await supabase
      .from('ctos')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      console.error('❌ [Debug] Erro ao contar CTOs:', countError);
      return res.json({
        success: false,
        error: countError.message,
        count: 0,
        source: 'supabase_error'
      });
    }
    
    // Buscar algumas CTOs de exemplo (primeiras 5)
    const { data: sampleData, error: sampleError } = await supabase
      .from('ctos')
      .select('id_cto, cto, latitude, longitude, portas, ocupado')
      .limit(5);
    
    const sample = sampleError ? [] : (sampleData || []);
    
    console.log(`✅ [Debug] Total de CTOs no Supabase: ${count || 0}`);
    console.log(`📋 [Debug] Exemplos: ${sample.length} CTOs`);
    
    res.json({
      success: true,
      count: count || 0,
      source: 'supabase',
      sample: sample.map(row => ({
        id_cto: row.id_cto,
        cto: row.cto,
        latitude: row.latitude,
        longitude: row.longitude,
        hasCoords: !!(row.latitude && row.longitude && !isNaN(row.latitude) && !isNaN(row.longitude))
      }))
    });
  } catch (err) {
    console.error('❌ [Debug] Erro ao verificar CTOs:', err);
    
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
      count: 0,
      source: 'error'
    });
  }
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

// Rota para obter próximo VI ALA (busca o mais recente no Supabase e retorna próximo)
app.get('/api/vi-ala/next', async (req, res) => {
  const requestStartTime = Date.now();
  
  // Garantir headers CORS
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Content-Type', 'application/json');
  
  console.log('📥 [API] ===== REQUISIÇÃO RECEBIDA /api/vi-ala/next =====');
  console.log('📥 [API] Timestamp:', new Date().toISOString());
  
  try {
    console.log('⏱️ [API] Buscando próximo VI ALA do Supabase...');
    
    // Buscar próximo VI ALA (tenta Supabase primeiro, fallback Excel)
    const nextVIALA = await getNextVIALA();
    
    if (!nextVIALA) {
      throw new Error('Não foi possível gerar próximo VI ALA');
    }
    
    const elapsedTime = Date.now() - requestStartTime;
    console.log(`✅ [API] Próximo VI ALA gerado: ${nextVIALA} (${elapsedTime}ms)`);
    
    if (!res.headersSent) {
      res.json({ success: true, viAla: nextVIALA });
    }
  } catch (err) {
    const elapsedTime = Date.now() - requestStartTime;
    console.error(`❌ [API] Erro (${elapsedTime}ms):`, err.message);
    console.error('❌ [API] Stack:', err.stack);
    
    // Garantir headers CORS mesmo em erro
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

// Rota para salvar registro VI ALA (Supabase primeiro, fallback Excel)
app.post('/api/vi-ala/save', async (req, res) => {
  try {
    // Garantir headers CORS
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    console.log('📥 [API] Requisição recebida para salvar VI ALA');
    console.log('📦 [API] Body recebido do frontend:', req.body);
    
    const { viAla, ala, data, projetista, cidade, endereco, latitude, longitude } = req.body;
    
    if (!viAla || viAla.trim() === '') {
      console.warn('⚠️ [API] VI ALA não fornecido ou vazio');
      return res.status(400).json({ success: false, error: 'VI ALA é obrigatório' });
    }
    
    // Converter formato frontend para formato interno (Excel)
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
    
    console.log('💾 [API] Salvando registro:', record);
    
    // Salvar (tenta Supabase primeiro, fallback Excel)
    await saveVIALARecord(record);
    
    console.log('✅ [API] Registro salvo com sucesso');
    res.json({ success: true, message: 'Registro salvo com sucesso' });
  } catch (err) {
    console.error('❌ [API] Erro ao salvar registro VI ALA:', err);
    console.error('❌ [API] Stack trace:', err.stack);
    
    // Garantir headers CORS mesmo em erro
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message });
    }
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
