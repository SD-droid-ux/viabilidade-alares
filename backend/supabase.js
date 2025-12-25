// ============================================
// Módulo de Conexão com Supabase
// ============================================
// Este módulo configura e exporta o cliente Supabase
// para uso em todo o backend
// ============================================

import { createClient } from '@supabase/supabase-js';

// Obter variáveis de ambiente
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Validar variáveis de ambiente
if (!SUPABASE_URL) {
  console.error('❌ [Supabase] SUPABASE_URL não configurada!');
  console.error('❌ [Supabase] Configure a variável de ambiente SUPABASE_URL');
  throw new Error('SUPABASE_URL não configurada');
}

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ [Supabase] SUPABASE_SERVICE_KEY não configurada!');
  console.error('❌ [Supabase] Configure a variável de ambiente SUPABASE_SERVICE_KEY');
  throw new Error('SUPABASE_SERVICE_KEY não configurada');
}

// Criar cliente Supabase com service_role key (acesso total ao banco)
// Usamos service_role porque o backend precisa de acesso completo
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  db: {
    schema: 'public'
  }
});

// Cliente com anon key (para uso futuro, se necessário)
const supabaseAnon = SUPABASE_ANON_KEY 
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

// Função para testar conexão com Supabase
export async function testSupabaseConnection() {
  try {
    console.log('🔍 [Supabase] Testando conexão...');
    console.log('🔍 [Supabase] URL:', SUPABASE_URL);
    
    // Testar conexão fazendo uma query simples
    const { data, error } = await supabase
      .from('projetistas')
      .select('count')
      .limit(1);
    
    if (error) {
      // Se a tabela não existir, ainda é uma conexão válida (erro de tabela, não de conexão)
      if (error.code === 'PGRST116' || error.message.includes('does not exist')) {
        console.log('⚠️ [Supabase] Conexão OK, mas tabela ainda não existe (normal se schema não foi executado)');
        return { success: true, message: 'Conexão OK (tabela não existe ainda)' };
      }
      throw error;
    }
    
    console.log('✅ [Supabase] Conexão estabelecida com sucesso!');
    return { success: true, message: 'Conexão OK' };
  } catch (err) {
    console.error('❌ [Supabase] Erro ao testar conexão:', err.message);
    console.error('❌ [Supabase] Stack:', err.stack);
    return { success: false, error: err.message };
  }
}

// Função para verificar se as tabelas existem
export async function checkTables() {
  try {
    console.log('🔍 [Supabase] Verificando tabelas...');
    
    const tables = ['ctos', 'projetistas', 'tabulacoes', 'vi_ala', 'upload_history'];
    const results = {};
    
    for (const table of tables) {
      try {
        const { error } = await supabase
          .from(table)
          .select('*')
          .limit(1);
        
        if (error) {
          if (error.code === 'PGRST116' || error.message.includes('does not exist')) {
            results[table] = { exists: false, error: 'Tabela não existe' };
          } else {
            results[table] = { exists: false, error: error.message };
          }
        } else {
          results[table] = { exists: true };
        }
      } catch (err) {
        results[table] = { exists: false, error: err.message };
      }
    }
    
    console.log('📊 [Supabase] Status das tabelas:', results);
    return results;
  } catch (err) {
    console.error('❌ [Supabase] Erro ao verificar tabelas:', err);
    return { error: err.message };
  }
}

// Exportar cliente principal (com service_role - acesso total)
export default supabase;

// Exportar cliente anon (se necessário no futuro)
export { supabaseAnon };

// Exportar informações de configuração (para debug)
export const supabaseConfig = {
  url: SUPABASE_URL,
  hasServiceKey: !!SUPABASE_SERVICE_KEY,
  hasAnonKey: !!SUPABASE_ANON_KEY
};

// Log de inicialização
console.log('✅ [Supabase] Módulo carregado');
console.log('✅ [Supabase] URL:', SUPABASE_URL);
console.log('✅ [Supabase] Service Key configurada:', !!SUPABASE_SERVICE_KEY);
console.log('✅ [Supabase] Anon Key configurada:', !!SUPABASE_ANON_KEY);

