import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const OLD_PROJETISTAS = path.join(__dirname, '../frontend/public/projetistas.xlsx');
const OLD_BASE = path.join(__dirname, '../frontend/public/base.xlsx');

const NEW_PROJETISTAS = path.join(DATA_DIR, 'projetistas.xlsx');
const NEW_BASE = path.join(DATA_DIR, 'base.xlsx');

// Criar pasta data se não existir
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('✅ Pasta backend/data criada');
}

// Migrar projetistas.xlsx se existir na localização antiga
if (fs.existsSync(OLD_PROJETISTAS) && !fs.existsSync(NEW_PROJETISTAS)) {
  fs.copyFileSync(OLD_PROJETISTAS, NEW_PROJETISTAS);
  console.log('✅ Arquivo projetistas.xlsx migrado para backend/data/');
}

// Migrar base.xlsx se existir na localização antiga
if (fs.existsSync(OLD_BASE) && !fs.existsSync(NEW_BASE)) {
  fs.copyFileSync(OLD_BASE, NEW_BASE);
  console.log('✅ Arquivo base.xlsx migrado para backend/data/');
}

console.log('\n📁 Arquivos devem estar em: backend/data/');
console.log('   - base.xlsx');
console.log('   - projetistas.xlsx\n');

