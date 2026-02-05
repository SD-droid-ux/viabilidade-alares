import { existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Caminho relativo: scripts/check-backend.js -> frontend/ -> projeto original/ -> backend/
const backendPath = resolve(__dirname, '../../backend');
const backendNodeModules = join(backendPath, 'node_modules');
const backendPackageJson = join(backendPath, 'package.json');

// Verificar se o backend existe e se precisa instalar dependências
if (existsSync(backendPackageJson) && !existsSync(backendNodeModules)) {
  console.log('📦 Instalando dependências do backend...');
  try {
    execSync('npm install', { 
      cwd: backendPath, 
      stdio: 'inherit',
      shell: true 
    });
    console.log('✅ Dependências do backend instaladas!\n');
  } catch (err) {
    console.error('❌ Erro ao instalar dependências do backend');
    console.error('   Execute manualmente: cd backend && npm install');
    // Não encerrar o processo, apenas avisar
  }
} else if (!existsSync(backendPackageJson)) {
  console.warn('⚠️  Backend não encontrado em:', backendPath);
}
