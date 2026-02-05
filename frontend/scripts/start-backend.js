import { execSync } from 'child_process';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Caminho para o backend
const backendPath = resolve(__dirname, '../../backend');

try {
  // Executar npm run dev no backend
  execSync('npm run dev', {
    cwd: backendPath,
    stdio: 'inherit',
    shell: true
  });
} catch (err) {
  console.error('❌ Erro ao iniciar backend:', err.message);
  process.exit(1);
}
