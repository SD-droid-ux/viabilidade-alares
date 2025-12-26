<script>
  import { onMount } from 'svelte';
  import { getApiUrl } from './config';

  // Props
  export let onClose = () => {};
  export let onReloadCTOs = async () => {};
  export let onUpdateProjetistas = (list) => {};
  export let onUpdateTabulacoes = (list) => {};
  export let baseDataExists = true;

  // Estados
  let projetistasList = [];
  let onlineUsers = [];
  let usersInfo = {}; // Armazena informações de status e timestamps dos usuários
  let onlineUsersInterval = null;
  let tabulacoesList = [
    'Aprovado Com Portas',
    'Aprovado Com Alívio de Rede/Cleanup',
    'Aprovado Prédio Não Cabeado',
    'Aprovado - Endereço não Localizado',
    'Fora da Área de Cobertura'
  ];
  let viAlasList = [];
  
  let showDeleteConfirmModal = false;
  let projetistaToDelete = '';
  let showDeleteTabulacaoModal = false;
  let tabulacaoToDelete = '';
  let showAddTabulacaoModal = false;
  let newTabulacaoName = '';
  let tabulacaoError = '';
  let showAddProjetistaModal = false;
  let newProjetistaName = '';
  let newProjetistaSenha = '';
  let showProjetistaPassword = false;
  let projetistaError = '';
  let uploadingBase = false;
  let uploadMessage = '';
  let uploadSuccess = false;
  let baseLastModified = null;
  let uploadPollInterval = null; // Intervalo de polling para verificar status
  let showDeleteBaseModal = false; // Modal de confirmação para deletar base
  let deletingBase = false; // Flag para indicar que está deletando base

  // Carregar dados do localStorage primeiro (instantâneo)
  function loadFromLocalStorage() {
    try {
      const savedProjetistas = localStorage.getItem('projetistasList');
      if (savedProjetistas) {
        projetistasList = JSON.parse(savedProjetistas);
      }
      
      const savedTabulacoes = localStorage.getItem('tabulacoesList');
      if (savedTabulacoes) {
        tabulacoesList = JSON.parse(savedTabulacoes);
      }
      
      // Carregar data de modificação do localStorage se existir
      const savedLastModified = localStorage.getItem('baseLastModified');
      if (savedLastModified) {
        baseLastModified = new Date(savedLastModified);
      }
    } catch (err) {
      console.error('Erro ao carregar do localStorage:', err);
    }
  }

  // Carregar dados ao montar (atualizar com dados do servidor)
  onMount(async () => {
    // Limpar qualquer polling anterior que possa ter ficado ativo
    if (uploadPollInterval) {
      clearInterval(uploadPollInterval);
      uploadPollInterval = null;
    }
    
    // Carregar do localStorage primeiro para mostrar instantaneamente
    loadFromLocalStorage();
    
    // Depois carregar do servidor em paralelo para atualizar
    Promise.all([
      loadProjetistas(),
      loadTabulacoes(),
      loadBaseLastModified(),
      loadViAlas(),
      loadOnlineUsers()
    ]).catch(err => {
      console.error('Erro ao carregar dados:', err);
    });
    
    // Iniciar polling para atualizar usuários online a cada 10 segundos
    onlineUsersInterval = setInterval(() => {
      loadOnlineUsers();
    }, 10000);
    
    // Limpar intervalos quando componente for destruído
    return () => {
      if (onlineUsersInterval) {
        clearInterval(onlineUsersInterval);
        onlineUsersInterval = null;
      }
      if (uploadPollInterval) {
        clearInterval(uploadPollInterval);
        uploadPollInterval = null;
      }
    };
  });
  
  // Verificação reativa: limpar polling se não houver upload em andamento
  $: {
    if (!uploadingBase && uploadPollInterval) {
      console.log('🛑 [Polling] Limpando polling - não há upload em andamento');
      clearInterval(uploadPollInterval);
      uploadPollInterval = null;
    }
  }

  // Carregar projetistas
  async function loadProjetistas() {
    try {
      const response = await fetch(getApiUrl('/api/projetistas'));
      const text = await response.text();
      if (text && text.trim() !== '') {
        const data = JSON.parse(text);
        if (data.success) {
          projetistasList = data.projetistas || [];
          try {
            localStorage.setItem('projetistasList', JSON.stringify(projetistasList));
          } catch (err) {
            console.error('Erro ao salvar no localStorage:', err);
          }
        }
      }
    } catch (err) {
      console.error('Erro ao carregar projetistas:', err);
      // Se falhar, manter dados do localStorage que já foram carregados
    }
  }

  // Carregar tabulações
  async function loadTabulacoes() {
    try {
      const response = await fetch(getApiUrl('/api/tabulacoes'));
      const text = await response.text();
      if (text && text.trim() !== '') {
        const data = JSON.parse(text);
        if (data.success) {
          tabulacoesList = data.tabulacoes || tabulacoesList;
          try {
            localStorage.setItem('tabulacoesList', JSON.stringify(tabulacoesList));
          } catch (err) {
            console.error('Erro ao salvar no localStorage:', err);
          }
        }
      }
    } catch (err) {
      console.error('Erro ao carregar tabulações:', err);
      // Se falhar, manter dados do localStorage que já foram carregados
    }
  }

  // Carregar data da última atualização da base
  async function loadBaseLastModified() {
    try {
      const response = await fetch(getApiUrl('/api/base-last-modified'));
      const text = await response.text();
      if (text && text.trim() !== '') {
        const data = JSON.parse(text);
        if (data.success && data.lastModified) {
          baseLastModified = new Date(data.lastModified);
          // Salvar no localStorage para próxima vez
          try {
            localStorage.setItem('baseLastModified', data.lastModified);
          } catch (err) {
            console.error('Erro ao salvar no localStorage:', err);
          }
        }
      }
    } catch (err) {
      console.error('Erro ao carregar data de modificação:', err);
      // Se falhar, manter dados do localStorage que já foram carregados
    }
  }

  // Carregar usuários online
  async function loadOnlineUsers() {
    try {
      const response = await fetch(getApiUrl('/api/users/online'));
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          onlineUsers = data.onlineUsers || [];
          // Atualizar usersInfo, mantendo informações existentes se não houver novas
          const newUsersInfo = data.usersInfo || {};
          // Mesclar com informações existentes para não perder dados
          usersInfo = { ...usersInfo, ...newUsersInfo };
          
          // Garantir que todos os projetistas na lista tenham informação de status
          projetistasList.forEach(projetista => {
            if (!usersInfo[projetista]) {
              // Se não tem informação, verificar se está online
              if (onlineUsers.includes(projetista)) {
                // Se está na lista de online mas não tem info, criar info básica
                usersInfo[projetista] = {
                  status: 'online',
                  loginTime: Date.now() // Usar timestamp atual como fallback
                };
              }
            }
          });
        }
      }
    } catch (err) {
      console.error('Erro ao carregar usuários online:', err);
    }
  }
  
  // Função para obter texto do tooltip baseado no status do usuário
  function getProjetistaTooltip(projetista) {
    if (!projetista) return 'Status desconhecido';
    
    // Verificar primeiro se está na lista de online (MESMA LÓGICA EXATA da bolinha verde)
    // Isso garante que o tooltip sempre corresponda à cor da bolinha
    const isOnline = Array.isArray(onlineUsers) && onlineUsers.includes(projetista);
    const info = usersInfo && typeof usersInfo === 'object' ? usersInfo[projetista] : null;
    
    // Se está online (mesma verificação da bolinha verde), SEMPRE mostrar "Ativo"
    if (isOnline) {
      // Tentar obter timestamp de login de qualquer forma possível
      let loginTime = null;
      
      if (info) {
        // Prioridade 1: loginTime direto
        if (info.loginTime) {
          loginTime = info.loginTime;
        }
        // Prioridade 2: se status é online e tem loginTime
        else if (info.status === 'online' && info.loginTime) {
          loginTime = info.loginTime;
        }
      }
      
      // Se tem timestamp de login, formatar
      if (loginTime) {
        try {
          const date = new Date(loginTime);
          // Verificar se a data é válida
          if (!isNaN(date.getTime())) {
            const formattedDate = date.toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric'
            });
            const formattedTime = date.toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit'
            });
            return `Ativo desde ${formattedDate} - ${formattedTime}h`;
          }
        } catch (err) {
          console.error('Erro ao formatar data de login:', err);
        }
      }
      
      // Se está online mas não tem timestamp, mostrar apenas "Ativo"
      return 'Ativo';
    }
    
    // Se NÃO está online (mesma verificação da bolinha vermelha), mostrar "Inativo"
    // Tentar obter timestamp de logout
    if (info && info.logoutTime) {
      try {
        const date = new Date(info.logoutTime);
        // Verificar se a data é válida
        if (!isNaN(date.getTime())) {
          const formattedDate = date.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          });
          const formattedTime = date.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit'
          });
          return `Inativo desde ${formattedDate} - ${formattedTime}h`;
        }
      } catch (err) {
        console.error('Erro ao formatar data de logout:', err);
      }
    }
    
    // Se não está online e não tem informação de logout, retornar status básico
    return 'Inativo';
  }

  // Carregar VI ALAs
  async function loadViAlas() {
    try {
      console.log('📥 Carregando VI ALAs...');
      const response = await fetch(getApiUrl('/api/vi-ala/list'));
      
      if (!response.ok) {
        console.warn('⚠️ Erro ao carregar VI ALAs (status:', response.status, ')');
        viAlasList = [];
        return;
      }
      
      const text = await response.text();
      if (text && text.trim() !== '') {
        const data = JSON.parse(text);
        if (data.success && data.viAlas) {
          // Os dados já vêm ordenados do backend, mas garantir ordenação
          const sorted = (data.viAlas || []).sort((a, b) => {
            const numA = typeof a.numero === 'number' ? a.numero : parseInt(a.numero) || 0;
            const numB = typeof b.numero === 'number' ? b.numero : parseInt(b.numero) || 0;
            return numB - numA; // Ordem decrescente (mais recente primeiro)
          });
          
          // Limitar aos 10 mais recentes (backend já limita, mas garantir)
          viAlasList = sorted.slice(0, 10);
          console.log(`✅ ${viAlasList.length} VI ALAs carregados`);
        } else {
          viAlasList = [];
          console.log('ℹ️ Nenhum VI ALA encontrado na base');
        }
      } else {
        viAlasList = [];
      }
    } catch (err) {
      console.error('❌ Erro ao carregar VI ALAs:', err);
      viAlasList = [];
    }
  }

  // Função para baixar a base de dados do VI ALA
  async function downloadViAlaBase() {
    try {
      const response = await fetch(getApiUrl('/api/vi-ala.xlsx'));
      
      if (!response.ok) {
        // Tentar ler como JSON se não for um arquivo
        try {
          const errorData = await response.json();
          alert(`Erro ao baixar arquivo: ${errorData.error || 'Arquivo não encontrado'}`);
        } catch {
          alert(`Erro ao baixar arquivo (status: ${response.status})`);
        }
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'base_VI ALA.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      console.log('✅ Base VI ALA baixada com sucesso');
    } catch (err) {
      console.error('Erro ao baixar base de dados do VI ALA:', err);
      alert('Erro ao baixar arquivo. Tente novamente.');
    }
  }

  // Função para fechar modal de deletar base
  function closeDeleteBaseModal() {
    showDeleteBaseModal = false;
  }

  // Função para deletar base atual
  async function deleteBase() {
    closeDeleteBaseModal();
    deletingBase = true;
    uploadMessage = '';
    uploadSuccess = false;

    try {
      const apiUrl = getApiUrl('/api/base/delete');
      console.log('🗑️ [Delete] Deletando base de dados...');
      console.log('🔗 [Delete] URL:', apiUrl);

      const response = await fetch(apiUrl, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      console.log('📥 [Delete] Resposta recebida:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ [Delete] Erro HTTP:', response.status, errorText);
        
        try {
          const errorData = JSON.parse(errorText);
          throw new Error(errorData.error || `Erro ao deletar base (${response.status})`);
        } catch {
          throw new Error(`Erro ao deletar base (${response.status}): ${errorText.substring(0, 200)}`);
        }
      }

      const data = await response.json();
      console.log('✅ [Delete] Dados recebidos:', data);

      if (data.success) {
        uploadSuccess = true;
        uploadMessage = data.message || 'Base de dados deletada com sucesso!';
        baseLastModified = null;
        baseDataExists = false;
        
        // Limpar localStorage
        try {
          localStorage.removeItem('baseLastModified');
        } catch (err) {
          console.error('Erro ao limpar localStorage:', err);
        }
        
        // Recarregar os dados das CTOs (vai retornar vazio agora)
        if (onReloadCTOs) {
          try {
            await onReloadCTOs();
            console.log('✅ Base de dados recarregada após deleção');
          } catch (err) {
            console.error('Erro ao recarregar base de dados:', err);
          }
        }
      } else {
        uploadSuccess = false;
        uploadMessage = data.error || 'Erro ao deletar base de dados';
      }
    } catch (err) {
      uploadSuccess = false;
      
      if (err.name === 'TypeError' && err.message.includes('Failed to fetch')) {
        uploadMessage = 'Não foi possível conectar ao servidor. Verifique se o backend está online.';
      } else {
        uploadMessage = `Erro ao deletar base: ${err.message}`;
      }
      
      console.error('❌ [Delete] Erro ao deletar base:', err);
    } finally {
      deletingBase = false;
    }
  }

  // Função para fechar tela de configurações
  function closeSettings() {
    // Limpar polling se estiver ativo
    if (uploadPollInterval) {
      clearInterval(uploadPollInterval);
      uploadPollInterval = null;
    }
    uploadMessage = '';
    uploadSuccess = false;
    uploadingBase = false;
    showDeleteBaseModal = false;
    deletingBase = false;
    if (onClose) {
      onClose();
    }
  }

  // Função para abrir modal de confirmação de exclusão
  function confirmDeleteProjetista(nome) {
    projetistaToDelete = nome;
    showDeleteConfirmModal = true;
  }

  // Função para fechar modal de confirmação
  function closeDeleteConfirmModal() {
    showDeleteConfirmModal = false;
    projetistaToDelete = '';
  }

  // Função para abrir modal de confirmação de exclusão de tabulação
  function confirmDeleteTabulacao(nome) {
    tabulacaoToDelete = nome;
    showDeleteTabulacaoModal = true;
  }

  // Função para fechar modal de confirmação de tabulação
  function closeDeleteTabulacaoModal() {
    showDeleteTabulacaoModal = false;
    tabulacaoToDelete = '';
  }

  // Função para abrir modal de adicionar tabulação
  function openAddTabulacaoModal() {
    showAddTabulacaoModal = true;
    newTabulacaoName = '';
    tabulacaoError = '';
  }

  // Função para fechar modal de adicionar tabulação
  function closeAddTabulacaoModal() {
    showAddTabulacaoModal = false;
    newTabulacaoName = '';
    tabulacaoError = '';
  }

  // Função para adicionar tabulação
  async function addTabulacao() {
    tabulacaoError = '';
    
    if (!newTabulacaoName || !newTabulacaoName.trim()) {
      tabulacaoError = 'Nome da tabulação é obrigatório';
      return;
    }
    
    try {
      const response = await fetch(getApiUrl('/api/tabulacoes'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nome: newTabulacaoName.trim()
        }),
      });

      const data = await response.json();

      if (data.success) {
        tabulacoesList = data.tabulacoes || [];
        
        try {
          localStorage.setItem('tabulacoesList', JSON.stringify(tabulacoesList));
        } catch (err) {
          console.error('Erro ao sincronizar localStorage:', err);
        }
        
        // Notificar componente pai sobre a atualização
        if (onUpdateTabulacoes) {
          onUpdateTabulacoes(tabulacoesList);
        }
        
        closeAddTabulacaoModal();
      } else {
        tabulacaoError = data.error || 'Erro ao adicionar tabulação';
      }
    } catch (err) {
      console.error('Erro ao adicionar tabulação:', err);
      tabulacaoError = 'Erro ao adicionar tabulação. Tente novamente.';
    }
  }

  // Função para deletar tabulação
  async function deleteTabulacao() {
    if (!tabulacaoToDelete) return;
    
    const nome = tabulacaoToDelete;
    closeDeleteTabulacaoModal();

    try {
      const response = await fetch(getApiUrl(`/api/tabulacoes/${encodeURIComponent(nome)}`), {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          tabulacoesList = data.tabulacoes || [];
          
          try {
            localStorage.setItem('tabulacoesList', JSON.stringify(tabulacoesList));
          } catch (err) {
            console.error('Erro ao sincronizar localStorage:', err);
          }
          
          // Notificar componente pai sobre a atualização
          if (onUpdateTabulacoes) {
            onUpdateTabulacoes(tabulacoesList);
          }
          
          console.log(`Tabulação "${nome}" deletada com sucesso do banco de dados.`);
          return;
        } else {
          console.warn(`Aviso da API: ${data.message || 'Erro ao deletar tabulação'}`);
        }
      } else {
        try {
          const errorData = await response.json();
          console.error(`Erro da API: ${errorData.detail || 'Erro desconhecido'}`);
        } catch (e) {
          console.error(`Erro HTTP ${response.status}: ${response.statusText}`);
        }
      }
    } catch (err) {
      console.error('Erro ao deletar tabulação:', err);
    }
  }

  // Função para deletar projetista
  async function deleteProjetista() {
    if (!projetistaToDelete) return;
    
    const nome = projetistaToDelete;
    closeDeleteConfirmModal();

    try {
      const response = await fetch(getApiUrl(`/api/projetistas/${encodeURIComponent(nome)}`), {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          projetistasList = data.projetistas || [];
          
          try {
            localStorage.setItem('projetistasList', JSON.stringify(projetistasList));
          } catch (err) {
            console.error('Erro ao sincronizar localStorage:', err);
          }
          
          // Notificar componente pai sobre a atualização
          if (onUpdateProjetistas) {
            onUpdateProjetistas(projetistasList);
          }
          
          console.log(`Projetista "${nome}" deletado com sucesso do banco de dados.`);
          return;
        } else {
          console.warn(`Aviso da API: ${data.message || 'Erro ao deletar projetista'}`);
        }
      } else {
        try {
          const errorData = await response.json();
          console.error(`Erro da API: ${errorData.detail || 'Erro desconhecido'}`);
        } catch (e) {
          console.error(`Erro HTTP ${response.status}: ${response.statusText}`);
        }
      }
    } catch (err) {
      console.error('Erro ao conectar com a API:', err);
    }

    // Se a API não funcionou, deletar localmente (fallback)
    projetistasList = projetistasList.filter(p => p !== nome);
    
    try {
      localStorage.setItem('projetistasList', JSON.stringify(projetistasList));
      console.log(`Projetista "${nome}" deletado localmente (API não disponível).`);
    } catch (localErr) {
      console.error('Erro ao salvar no localStorage:', localErr);
    }
    
    // Notificar componente pai sobre a atualização
    if (onUpdateProjetistas) {
      onUpdateProjetistas(projetistasList);
    }
  }

  // Função para abrir modal de adicionar projetista
  function openAddProjetistaModal() {
    showAddProjetistaModal = true;
    newProjetistaName = '';
    newProjetistaSenha = '';
    projetistaError = '';
    showProjetistaPassword = false;
  }

  // Função para fechar modal de adicionar projetista
  function closeAddProjetistaModal() {
    showAddProjetistaModal = false;
    newProjetistaName = '';
    newProjetistaSenha = '';
    projetistaError = '';
    showProjetistaPassword = false;
  }

  // Função para adicionar projetista
  async function addProjetista() {
    projetistaError = '';
    
    if (!newProjetistaName || !newProjetistaName.trim()) {
      projetistaError = 'Nome do projetista é obrigatório';
      return;
    }
    
    if (!newProjetistaSenha || !newProjetistaSenha.trim()) {
      projetistaError = 'Senha é obrigatória';
      return;
    }
    
    try {
      const response = await fetch(getApiUrl('/api/projetistas'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nome: newProjetistaName.trim(),
          senha: newProjetistaSenha.trim()
        }),
      });

      const data = await response.json();

      if (data.success) {
        projetistasList = data.projetistas || [];
        
        try {
          localStorage.setItem('projetistasList', JSON.stringify(projetistasList));
        } catch (err) {
          console.error('Erro ao sincronizar localStorage:', err);
        }
        
        // Notificar componente pai sobre a atualização
        if (onUpdateProjetistas) {
          onUpdateProjetistas(projetistasList);
        }
        
        closeAddProjetistaModal();
      } else {
        projetistaError = data.error || 'Erro ao adicionar projetista';
      }
    } catch (err) {
      console.error('Erro ao adicionar projetista:', err);
      projetistaError = 'Erro ao adicionar projetista. Tente novamente.';
    }
  }


  // Função para fazer upload da nova base de dados
  async function handleBaseUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    uploadMessage = '';
    uploadSuccess = false;
    uploadingBase = true;

    try {
      const formData = new FormData();
      formData.append('file', file);

      // Obter URL da API com tratamento de erro robusto
      let apiUrl;
      try {
        apiUrl = getApiUrl('/api/upload-base');
      } catch (urlError) {
        console.error('❌ [Upload] Erro ao obter URL da API:', urlError);
        throw new Error('Erro ao construir URL da API. Verifique a configuração VITE_API_URL.');
      }
      
      // Validar URL antes de fazer fetch
      if (!apiUrl) {
        console.error('❌ [Upload] apiUrl é null ou undefined');
        throw new Error('URL da API inválida (null/undefined). Verifique a configuração VITE_API_URL.');
      }
      
      if (typeof apiUrl !== 'string') {
        console.error('❌ [Upload] apiUrl não é string:', typeof apiUrl, apiUrl);
        throw new Error(`URL da API inválida (tipo: ${typeof apiUrl}). Verifique a configuração VITE_API_URL.`);
      }
      
      if (apiUrl.trim() === '') {
        console.error('❌ [Upload] apiUrl é string vazia');
        throw new Error('URL da API inválida (string vazia). Verifique a configuração VITE_API_URL.');
      }
      
      // Validar se é uma URL válida ou path relativo
      const isAbsoluteUrl = apiUrl.startsWith('http://') || apiUrl.startsWith('https://');
      const isRelativePath = apiUrl.startsWith('/');
      
      if (!isAbsoluteUrl && !isRelativePath) {
        console.error('❌ [Upload] apiUrl não é URL absoluta nem path relativo:', apiUrl);
        throw new Error(`URL da API inválida (formato incorreto): ${apiUrl}`);
      }
      
      // Se é URL absoluta, validar formato
      if (isAbsoluteUrl) {
        try {
          new URL(apiUrl);
        } catch (urlError) {
          console.error('❌ [Upload] Erro ao validar URL:', urlError);
          throw new Error(`URL da API inválida (formato incorreto): ${apiUrl}`);
        }
      }
      
      console.log('📤 [Upload] Enviando arquivo para:', apiUrl);
      console.log('📤 [Upload] Método HTTP:', 'POST');
      console.log('📤 [Upload] Tamanho do arquivo:', file.size, 'bytes');
      console.log('📤 [Upload] Tipo do arquivo:', file.type || 'não especificado');
      console.log('📤 [Upload] FormData criado:', formData.has('file'));

      // Fazer fetch com tratamento de erro específico
      let response;
      try {
        const fetchOptions = {
          method: 'POST',
          body: formData
        };
        console.log('📤 [Upload] Opções do fetch:', { method: fetchOptions.method, hasBody: !!fetchOptions.body });
        response = await fetch(apiUrl, fetchOptions);
      } catch (fetchError) {
        console.error('❌ [Upload] Erro no fetch:', fetchError);
        console.error('❌ [Upload] URL usada:', apiUrl);
        console.error('❌ [Upload] Tipo do erro:', fetchError.name);
        console.error('❌ [Upload] Mensagem:', fetchError.message);
        
        if (fetchError.name === 'TypeError' && fetchError.message.includes('Failed to fetch')) {
          throw new Error('Não foi possível conectar ao servidor. Verifique se o backend está online.');
        }
        throw fetchError;
      }

      console.log('📥 [Upload] Resposta recebida:', response.status, response.statusText);
      console.log('📥 [Upload] Content-Type:', response.headers.get('content-type'));

      // Verificar se a resposta é OK antes de tentar ler
      if (!response.ok) {
        // Tentar ler como texto primeiro
        const errorText = await response.text();
        console.error('❌ [Upload] Erro HTTP:', response.status, errorText.substring(0, 200));
        
        if (response.status === 502) {
          throw new Error('Servidor não está respondendo (502 Bad Gateway). Verifique se o backend está online.');
        } else if (response.status === 504) {
          throw new Error('Timeout do servidor. O arquivo pode ser muito grande. Tente novamente.');
        } else {
          // Tentar parsear como JSON se possível
          try {
            const errorData = JSON.parse(errorText);
            throw new Error(errorData.error || `Erro do servidor (${response.status}): ${errorText.substring(0, 100)}`);
          } catch {
            throw new Error(`Erro do servidor (${response.status}): ${errorText.substring(0, 200) || response.statusText}`);
          }
        }
      }

      const text = await response.text();
      let data;
      
      if (!text || text.trim() === '') {
        throw new Error(`Resposta vazia do servidor (${response.status} ${response.statusText})`);
      }
      
      try {
        data = JSON.parse(text);
        console.log('✅ [Upload] Dados recebidos:', data);
      } catch (parseErr) {
        console.error('❌ [Upload] Erro ao parsear JSON:', parseErr);
        console.error('❌ [Upload] Resposta recebida (primeiros 500 chars):', text.substring(0, 500));
        throw new Error(`Erro ao processar resposta do servidor. O servidor retornou: ${text.substring(0, 200)}`);
      }

      if (data.success) {
        // Se o backend indicou que está processando em background
        if (data.processing) {
          uploadSuccess = false; // Ainda não é sucesso definitivo
          uploadMessage = data.message || 'Upload recebido! Processando arquivo em background...';
          uploadingBase = true; // Manter flag de upload ativo
          
          // Limpar qualquer polling anterior
          if (uploadPollInterval) {
            clearInterval(uploadPollInterval);
            uploadPollInterval = null;
          }
          
          // Guardar timestamp antes do upload para comparar depois
          const timestampBeforeUpload = baseLastModified ? baseLastModified.getTime() : 0;
          
          // Iniciar polling para verificar status do processamento
          // O backend processa em background, então precisamos verificar periodicamente
          let pollAttempts = 0;
          const maxPollAttempts = 120; // 10 minutos máximo (120 * 5s = 600s)
          const pollInterval = 5000; // Verificar a cada 5 segundos
          
          uploadPollInterval = setInterval(async () => {
            pollAttempts++;
            
            try {
              // Verificar se a base foi atualizada verificando a data de modificação
              await loadBaseLastModified();
              
              // Verificar se a base foi atualizada (nova data de modificação)
              if (baseLastModified && baseLastModified.getTime() > timestampBeforeUpload) {
                // Base foi atualizada! Parar polling e marcar como sucesso
                clearInterval(uploadPollInterval);
                uploadPollInterval = null;
                uploadingBase = false;
                uploadSuccess = true;
                uploadMessage = 'Base de dados atualizada com sucesso!';
                
                // Recarregar os dados das CTOs
                if (onReloadCTOs) {
                  try {
                    await onReloadCTOs();
                    console.log('✅ Base de dados recarregada com sucesso após upload');
                  } catch (err) {
                    console.error('Erro ao recarregar base de dados:', err);
                  }
                }
                
                return; // Parar polling
              }
              
              // Se passou muito tempo, assumir que terminou (ou deu erro)
              if (pollAttempts >= maxPollAttempts) {
                clearInterval(uploadPollInterval);
                uploadPollInterval = null;
                uploadingBase = false;
                uploadMessage = 'Processamento demorou mais que o esperado. Verifique os logs do servidor.';
                uploadSuccess = false;
                return;
              }
            } catch (pollErr) {
              console.error('❌ [Upload] Erro ao verificar status:', pollErr);
              // Continuar tentando até atingir maxPollAttempts
            }
          }, pollInterval);
          
          // Parar polling após 10 minutos (timeout de segurança)
          setTimeout(() => {
            if (uploadPollInterval) {
              clearInterval(uploadPollInterval);
              uploadPollInterval = null;
            }
            if (uploadingBase) {
              // Se ainda está processando, verificar uma última vez
              loadBaseLastModified().then(() => {
                uploadingBase = false;
                if (baseLastModified && baseLastModified.getTime() > timestampBeforeUpload) {
                  // Base foi atualizada, assumir sucesso
                  uploadSuccess = true;
                  uploadMessage = 'Base de dados atualizada com sucesso!';
                  
                  // Recarregar os dados das CTOs
                  if (onReloadCTOs) {
                    onReloadCTOs().catch(err => {
                      console.error('Erro ao recarregar base de dados:', err);
                    });
                  }
                } else {
                  uploadMessage = 'Processamento concluído. Verifique se a base foi atualizada corretamente.';
                }
              }).catch(() => {
                uploadingBase = false;
                uploadMessage = 'Não foi possível verificar o status final do processamento.';
              });
            }
          }, 600000); // 10 minutos
          
          event.target.value = '';
          return; // Não limpar uploadingBase ainda
        } else {
          // Processamento imediato (não em background)
          uploadSuccess = true;
          uploadMessage = data.message || 'Base de dados atualizada com sucesso!';
          
          if (data.lastModified) {
            baseLastModified = new Date(data.lastModified);
          }
          
          // Recarregar os dados das CTOs
          if (onReloadCTOs) {
            try {
              await onReloadCTOs();
              console.log('✅ Base de dados recarregada com sucesso');
            } catch (err) {
              console.error('Erro ao recarregar base de dados:', err);
            }
          }

          event.target.value = '';
          uploadingBase = false;
        }
      } else {
        uploadSuccess = false;
        uploadMessage = data.error || 'Erro ao atualizar base de dados';
        uploadingBase = false;
      }
    } catch (err) {
      // Limpar polling se houver erro
      if (uploadPollInterval) {
        clearInterval(uploadPollInterval);
        uploadPollInterval = null;
      }
      
      uploadSuccess = false;
      uploadingBase = false;
      
      // Mensagens de erro mais específicas
      if (err.name === 'TypeError' && err.message.includes('Failed to fetch')) {
        uploadMessage = 'Não foi possível conectar ao servidor. Verifique se o backend está online e tente novamente.';
      } else if (err.message.includes('CORS')) {
        uploadMessage = 'Erro de CORS. O servidor não está permitindo requisições do frontend.';
      } else if (err.message.includes('502')) {
        uploadMessage = 'Servidor não está respondendo (502 Bad Gateway). Verifique se o backend está online no Railway.';
      } else if (err.message.includes('504')) {
        uploadMessage = 'Timeout do servidor. O arquivo pode ser muito grande ou o processamento está demorando. Tente novamente.';
      } else {
        uploadMessage = `Erro ao fazer upload: ${err.message}`;
      }
      
      console.error('❌ [Upload] Erro ao fazer upload da base:', err);
      console.error('❌ [Upload] Tipo do erro:', err.name);
      console.error('❌ [Upload] Mensagem:', err.message);
    }
  }
</script>

<!-- Tela de Configurações -->
<div 
  class="settings-screen" 
  on:keydown={(e) => e.key === 'Escape' && closeSettings()}
  role="dialog"
  aria-modal="true"
  aria-labelledby="settings-title"
>
  <div class="settings-screen-content">
    <div class="settings-header">
      <h2 id="settings-title">Configurações</h2>
      <button class="settings-close" on:click={closeSettings} aria-label="Fechar configurações">×</button>
    </div>

    <div class="settings-body">
      <div class="settings-section">
        <h3>Projetistas</h3>
        {#if projetistasList.length === 0}
          <p class="empty-message">Nenhum projetista cadastrado.</p>
        {:else}
          <div class="projetistas-list">
            {#each projetistasList as projetista}
              <div class="projetista-item">
                <div class="projetista-name-wrapper">
                  <span 
                    class="projetista-name" 
                    title={onlineUsers && usersInfo ? getProjetistaTooltip(projetista) : 'Carregando...'}
                  >
                    {projetista}
                  </span>
                  {#if onlineUsers && onlineUsers.includes(projetista)}
                    <span class="online-indicator" title="Online">🟢</span>
                  {:else}
                    <span class="offline-indicator" title="Offline">🔴</span>
                  {/if}
                </div>
                <button 
                  class="btn-delete" 
                  on:click={() => confirmDeleteProjetista(projetista)}
                  aria-label="Excluir {projetista}"
                  title="Excluir {projetista}"
                >
                  🗑️
                </button>
              </div>
            {/each}
          </div>
        {/if}
        <div class="add-projetista-section">
          <button 
            class="btn-add" 
            on:click={openAddProjetistaModal}
            title="Adicionar novo projetista"
          >
            + Adicionar novo projetista
          </button>
        </div>
      </div>

      <div class="settings-section">
        <h3>Tabulações</h3>
        {#if tabulacoesList.length === 0}
          <p class="empty-message">Nenhuma tabulação cadastrada.</p>
        {:else}
          <div class="projetistas-list">
            {#each tabulacoesList as tabulacao}
              <div class="projetista-item">
                <span class="projetista-name">{tabulacao}</span>
                <button 
                  class="btn-delete" 
                  on:click={() => confirmDeleteTabulacao(tabulacao)}
                  aria-label="Excluir {tabulacao}"
                  title="Excluir {tabulacao}"
                >
                  🗑️
                </button>
              </div>
            {/each}
          </div>
        {/if}
        <div class="add-projetista-section">
          <button 
            class="btn-add" 
            on:click={openAddTabulacaoModal}
            title="Adicionar nova tabulação"
          >
            + Adicionar nova tabulação
          </button>
        </div>
      </div>

      <div class="settings-section">
        <h3>VI ALAs</h3>
        {#if viAlasList.length === 0}
          <p class="empty-message">Nenhum VI ALA gerado ainda.</p>
        {:else}
          <div class="projetistas-list">
            {#each viAlasList as viAla}
              <div class="projetista-item vi-ala-item">
                <div class="vi-ala-info">
                  <span class="projetista-name">{viAla.id || `VI ALA-${String(viAla.numero || 0).padStart(7, '0')}`}</span>
                  {#if viAla.numero_ala && viAla.numero_ala.trim()}
                    <span class="vi-ala-details">
                      {viAla.numero_ala.trim()}{#if viAla.projetista && viAla.projetista.trim()} - {viAla.projetista.trim()}{/if}
                    </span>
                  {:else if viAla.projetista && viAla.projetista.trim()}
                    <span class="vi-ala-details">
                      {viAla.projetista.trim()}
                    </span>
                  {/if}
                  {#if viAla.data_geracao && viAla.data_geracao.trim()}
                    <span class="vi-ala-date">
                      {(() => {
                        try {
                          const dateStr = viAla.data_geracao.trim();
                          
                          // Formato esperado: "DD/MM/YYYY HH:MM" ou "DD/MM/YYYY"
                          if (dateStr.includes('/')) {
                            // Separar data e hora se houver
                            const parts = dateStr.split(' ');
                            const datePart = parts[0]; // "DD/MM/YYYY"
                            const timePart = parts[1] || ''; // "HH:MM" ou vazio
                            
                            const dateComponents = datePart.split('/');
                            if (dateComponents.length === 3) {
                              const day = parseInt(dateComponents[0], 10);
                              const month = parseInt(dateComponents[1], 10) - 1; // Mês é 0-indexed
                              const year = parseInt(dateComponents[2], 10);
                              
                              let date;
                              if (timePart && timePart.includes(':')) {
                                // Tem hora: "DD/MM/YYYY HH:MM"
                                const timeComponents = timePart.split(':');
                                const hour = parseInt(timeComponents[0], 10);
                                const minute = parseInt(timeComponents[1], 10);
                                date = new Date(year, month, day, hour, minute);
                              } else {
                                // Só tem data: "DD/MM/YYYY"
                                date = new Date(year, month, day);
                              }
                              
                              if (!isNaN(date.getTime())) {
                                const formattedDate = date.toLocaleDateString('pt-BR', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  year: 'numeric'
                                });
                                const formattedTime = date.toLocaleTimeString('pt-BR', {
                                  hour: '2-digit',
                                  minute: '2-digit'
                                });
                                return `${formattedDate} - ${formattedTime}`;
                              }
                            }
                          }
                          
                          // Tentar parsear como ISO ou outro formato
                          const date = new Date(dateStr);
                          if (!isNaN(date.getTime())) {
                            const formattedDate = date.toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric'
                            });
                            const formattedTime = date.toLocaleTimeString('pt-BR', {
                              hour: '2-digit',
                              minute: '2-digit'
                            });
                            return `${formattedDate} - ${formattedTime}`;
                          }
                          
                          // Se não conseguir parsear, retornar original
                          return dateStr;
                        } catch (err) {
                          return viAla.data_geracao || '';
                        }
                      })()}
                    </span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
        <div class="vi-ala-download-section">
          <button 
            class="download-vi-ala-btn" 
            on:click={downloadViAlaBase}
            title="Baixar base de dados completa do VI ALA"
          >
            Baixar Base de Dados VI ALA
          </button>
        </div>
      </div>

      <div class="settings-section">
        <h3>Base de Dados</h3>
        <div class="upload-section">
          <div class="upload-button-container">
            <label for="baseFileInput" class="upload-label">
              <span>Carregar Nova Base de Dados</span>
              <input 
                type="file" 
                id="baseFileInput"
                accept=".xlsx,.xls"
                on:change={(e) => handleBaseUpload(e)}
                disabled={uploadingBase}
                style="display: none;"
              />
            </label>
          </div>
          <p class="upload-hint">Selecione um arquivo Excel (.xlsx ou .xls) com a estrutura da base atual</p>
          
          <div class="delete-base-container" style="margin-top: 1rem;">
            <button 
              class="btn-delete-base" 
              on:click={() => showDeleteBaseModal = true}
              disabled={deletingBase || uploadingBase}
              title="Deletar todos os dados da base de dados CTO"
            >
              🗑️ Deletar Base Atual
            </button>
          </div>
          
          {#if baseDataExists && baseLastModified}
            <p class="last-modified-text">
              Última atualização: {baseLastModified.toLocaleDateString('pt-BR', { 
                day: '2-digit', 
                month: '2-digit', 
                year: 'numeric'
              })} - {baseLastModified.toLocaleTimeString('pt-BR', {
                hour: '2-digit', 
                minute: '2-digit'
              })}
            </p>
          {:else if !baseDataExists}
            <p class="last-modified-text" style="color: #F44336;">
              Não existe base carregada. Por favor carregar nova base.
            </p>
          {/if}
          
          {#if uploadingBase}
            <div class="upload-status">
              <div class="loading-spinner"></div>
              <span>Validando e atualizando base de dados...</span>
            </div>
          {/if}

          {#if uploadMessage}
            <div class="upload-message" class:success={uploadSuccess} class:error={!uploadSuccess}>
              {uploadMessage}
            </div>
          {/if}
        </div>
      </div>

    </div>
  </div>
</div>

<!-- Modal de Confirmação de Exclusão de Projetista -->
{#if showDeleteConfirmModal}
  <div 
    class="modal-overlay confirm-overlay" 
    on:click={closeDeleteConfirmModal}
    on:keydown={(e) => e.key === 'Escape' && closeDeleteConfirmModal()}
    role="button"
    tabindex="-1"
    aria-label="Fechar modal"
  >
    <div 
      class="modal-content confirm-modal" 
      on:click|stopPropagation
      on:keydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div class="modal-header">
        <h2 id="confirm-title">Confirmar Exclusão</h2>
        <button class="modal-close" on:click={closeDeleteConfirmModal} aria-label="Fechar modal">×</button>
      </div>

      <div class="modal-body">
        <div class="confirm-message">
          <p>Deseja realmente excluir o projetista <strong>"{projetistaToDelete}"</strong>?</p>
          <p class="confirm-warning">Esta ação não pode ser desfeita.</p>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn-cancel" on:click={closeDeleteConfirmModal}>Cancelar</button>
          <button type="button" class="btn-delete-confirm" on:click={deleteProjetista}>
            Excluir
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Modal de Confirmação de Exclusão de Tabulação -->
{#if showDeleteTabulacaoModal}
  <div 
    class="modal-overlay confirm-overlay" 
    on:click={closeDeleteTabulacaoModal}
    on:keydown={(e) => e.key === 'Escape' && closeDeleteTabulacaoModal()}
    role="button"
    tabindex="-1"
    aria-label="Fechar modal"
  >
    <div 
      class="modal-content confirm-modal" 
      on:click|stopPropagation
      on:keydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-tabulacao-title"
    >
      <div class="modal-header">
        <h2 id="confirm-tabulacao-title">Confirmar Exclusão</h2>
        <button class="modal-close" on:click={closeDeleteTabulacaoModal} aria-label="Fechar modal">×</button>
      </div>

      <div class="modal-body">
        <div class="confirm-message">
          <p>Deseja realmente excluir a tabulação <strong>"{tabulacaoToDelete}"</strong>?</p>
          <p class="confirm-warning">Esta ação não pode ser desfeita.</p>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn-cancel" on:click={closeDeleteTabulacaoModal}>Cancelar</button>
          <button type="button" class="btn-delete-confirm" on:click={deleteTabulacao}>
            Excluir
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Modal de Adicionar Projetista -->
{#if showAddProjetistaModal}
  <div 
    class="modal-overlay confirm-overlay" 
    on:click={closeAddProjetistaModal}
    on:keydown={(e) => e.key === 'Escape' && closeAddProjetistaModal()}
    role="button"
    tabindex="-1"
    aria-label="Fechar modal"
  >
    <div 
      class="modal-content confirm-modal" 
      on:click|stopPropagation
      on:keydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-projetista-title"
    >
      <div class="modal-header">
        <h2 id="add-projetista-title">Adicionar Novo Projetista</h2>
        <button class="modal-close" on:click={closeAddProjetistaModal} aria-label="Fechar modal">×</button>
      </div>

      <div class="modal-body">
        <form on:submit|preventDefault={addProjetista}>
          <div class="form-group">
            <label for="projetistaNome">Nome de usuário <span class="required">*</span></label>
            <input 
              type="text" 
              id="projetistaNome"
              bind:value={newProjetistaName}
              placeholder="Digite o nome do projetista"
              required
              class:error={projetistaError && !newProjetistaName.trim()}
            />
          </div>

          <div class="form-group">
            <label for="projetistaSenha">Senha <span class="required">*</span></label>
            <div class="password-input-wrapper">
              {#if showProjetistaPassword}
                <input 
                  type="text"
                  id="projetistaSenha"
                  bind:value={newProjetistaSenha}
                  placeholder="Digite a senha"
                  required
                  class:error={projetistaError && !newProjetistaSenha.trim()}
                />
              {:else}
                <input 
                  type="password"
                  id="projetistaSenha"
                  bind:value={newProjetistaSenha}
                  placeholder="Digite a senha"
                  required
                  class:error={projetistaError && !newProjetistaSenha.trim()}
                />
              {/if}
              <button 
                type="button"
                class="password-toggle"
                on:click={() => showProjetistaPassword = !showProjetistaPassword}
                aria-label={showProjetistaPassword ? 'Ocultar senha' : 'Mostrar senha'}
                title={showProjetistaPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {#if showProjetistaPassword}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                {:else}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                {/if}
              </button>
            </div>
          </div>

          {#if projetistaError}
            <div class="error-message-modal">
              {projetistaError}
            </div>
          {/if}

          <div class="modal-actions">
            <button type="button" class="btn-cancel" on:click={closeAddProjetistaModal}>Cancelar</button>
            <button type="submit" class="btn-add-confirm">
              Adicionar
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
{/if}

<!-- Modal de Confirmação de Exclusão de Base -->
{#if showDeleteBaseModal}
  <div 
    class="modal-overlay confirm-overlay" 
    on:click={closeDeleteBaseModal}
    on:keydown={(e) => e.key === 'Escape' && closeDeleteBaseModal()}
    role="button"
    tabindex="-1"
    aria-label="Fechar modal"
  >
    <div 
      class="modal-content confirm-modal" 
      on:click|stopPropagation
      on:keydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-base-title"
    >
      <div class="modal-header">
        <h2 id="confirm-delete-base-title">Confirmar Exclusão</h2>
        <button class="modal-close" on:click={closeDeleteBaseModal} aria-label="Fechar modal">×</button>
      </div>

      <div class="modal-body">
        <div class="confirm-message">
          <p>Deseja realmente <strong>deletar TODOS os dados</strong> da base de dados CTO?</p>
          <p class="confirm-warning">⚠️ Esta ação é IRREVERSÍVEL e irá apagar todos os dados da tabela <strong>ctos</strong> no Supabase.</p>
          <p class="confirm-warning">Você precisará fazer upload de uma nova base para restaurar os dados.</p>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn-cancel" on:click={closeDeleteBaseModal} disabled={deletingBase}>
            Cancelar
          </button>
          <button type="button" class="btn-delete-confirm" on:click={deleteBase} disabled={deletingBase}>
            {deletingBase ? 'Deletando...' : 'Sim, Deletar Base'}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Modal de Adicionar Tabulação -->
{#if showAddTabulacaoModal}
  <div 
    class="modal-overlay confirm-overlay" 
    on:click={closeAddTabulacaoModal}
    on:keydown={(e) => e.key === 'Escape' && closeAddTabulacaoModal()}
    role="button"
    tabindex="-1"
    aria-label="Fechar modal"
  >
    <div 
      class="modal-content confirm-modal" 
      on:click|stopPropagation
      on:keydown={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-tabulacao-title"
    >
      <div class="modal-header">
        <h2 id="add-tabulacao-title">Adicionar Nova Tabulação</h2>
        <button class="modal-close" on:click={closeAddTabulacaoModal} aria-label="Fechar modal">×</button>
      </div>

      <div class="modal-body">
        <form on:submit|preventDefault={addTabulacao}>
          <div class="form-group">
            <label for="newTabulacaoName">Nome da Tabulação <span class="required">*</span></label>
            <input 
              type="text" 
              id="newTabulacaoName"
              bind:value={newTabulacaoName}
              placeholder="Digite o nome da tabulação"
              required
              class:error={tabulacaoError && !newTabulacaoName.trim()}
            />
          </div>

          {#if tabulacaoError}
            <div class="error-message-modal">
              {tabulacaoError}
            </div>
          {/if}

          <div class="modal-actions">
            <button type="button" class="btn-cancel" on:click={closeAddTabulacaoModal}>Cancelar</button>
            <button type="submit" class="btn-add-confirm">
              Adicionar
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
{/if}


<style>
  /* Tela de Configurações - Fullscreen */
  .settings-screen {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    background: linear-gradient(135deg, rgba(123, 104, 238, 0.7) 0%, rgba(100, 149, 237, 0.7) 100%) !important;
    z-index: 10002 !important;
    display: flex !important;
    flex-direction: column;
    overflow-y: auto;
    animation: slideInSettings 0.3s ease-out;
  }

  @keyframes slideInSettings {
    from {
      opacity: 0;
      transform: translateX(100%);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  .settings-screen-content {
    width: 100%;
    max-width: 1400px;
    margin: 0 auto;
    padding: 0;
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    position: relative;
  }

  .settings-screen-content::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 0;
  }

  .settings-screen-content > * {
    position: relative;
    z-index: 1;
  }

  .settings-header {
    background: linear-gradient(135deg, rgba(123, 104, 238, 0.95) 0%, rgba(100, 149, 237, 0.95) 100%);
    color: white;
    padding: 1rem 2rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 4px 6px rgba(0,0,0,0.2);
    backdrop-filter: blur(10px);
    width: 100vw;
    margin-left: calc(-50vw + 50%);
    position: relative;
    z-index: 10;
    box-sizing: border-box;
  }

  .settings-header h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    color: white;
  }

  .settings-close {
    background: rgba(255, 255, 255, 0.2);
    border: none;
    color: white;
    font-size: 1.75rem;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    line-height: 1;
    padding: 0;
    position: relative;
    z-index: 11;
    flex-shrink: 0;
    margin-left: auto;
  }

  .settings-close:hover {
    background: rgba(255, 255, 255, 0.3);
    transform: rotate(90deg);
  }

  .settings-body {
    flex: 1;
    padding: 2rem;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
    gap: 2rem;
    align-content: start;
  }

  .settings-section {
    background: rgba(255, 255, 255, 0.95);
    padding: 1.5rem;
    border-radius: 12px;
    box-shadow: 2px 0 8px rgba(0,0,0,0.15);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.5);
  }

  @media (max-width: 900px) {
    .settings-body {
      grid-template-columns: 1fr;
    }
  }

  .settings-section h3 {
    color: #7B68EE;
    font-size: 1.2rem;
    font-weight: 600;
    margin: 0 0 1.5rem 0;
    padding-bottom: 0.75rem;
    border-bottom: 2px solid #7B68EE;
  }

  .empty-message {
    color: #666;
    font-size: 0.9rem;
    margin: 1rem 0;
    text-align: center;
    padding: 1rem;
    background: rgba(123, 104, 238, 0.05);
    border-radius: 8px;
    border: 1px dashed rgba(123, 104, 238, 0.2);
  }

  .projetistas-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-height: 500px;
    overflow-y: auto;
    padding-right: 0.5rem;
  }

  .projetistas-list::-webkit-scrollbar {
    width: 6px;
  }

  .projetistas-list::-webkit-scrollbar-track {
    background: #f1f1f1;
    border-radius: 3px;
  }

  .projetistas-list::-webkit-scrollbar-thumb {
    background: #7B68EE;
    border-radius: 3px;
  }

  .projetista-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem;
    background: #ffffff;
    border: 1px solid #E0E0E0;
    border-radius: 8px;
    transition: all 0.2s ease;
  }

  .projetista-item.vi-ala-item {
    align-items: flex-start;
  }

  .projetista-item:hover {
    background: #f8f9ff;
    border-color: #7B68EE;
    box-shadow: 0 2px 8px rgba(123, 104, 238, 0.1);
  }

  .projetista-name {
    font-size: 0.95rem;
    color: #333;
    font-weight: 500;
    flex: 1;
  }
  
  .online-indicator {
    font-size: 0.75rem;
    display: inline-block;
    animation: pulse 2s ease-in-out infinite;
  }
  
  .offline-indicator {
    font-size: 0.75rem;
    display: inline-block;
    opacity: 0.7;
  }
  
  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.6;
    }
  }


  .vi-ala-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1;
    width: 100%;
  }

  .vi-ala-info .projetista-name {
    font-weight: 600;
    color: #7B68EE;
    font-size: 1rem;
  }

  .vi-ala-details {
    font-size: 0.85rem;
    color: #666;
    font-weight: 400;
  }

  .vi-ala-date {
    font-size: 0.75rem;
    color: #999;
    font-weight: 400;
    margin-top: 0.25rem;
  }

  .vi-ala-download-section {
    margin-top: 1rem;
    display: flex;
    justify-content: center;
  }

  .download-vi-ala-btn {
    width: 100%;
    padding: 0.875rem 1.5rem;
    background: linear-gradient(135deg, #7B68EE 0%, #6495ED 100%);
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.95rem;
    transition: all 0.3s ease;
    box-shadow: 0 4px 6px rgba(123, 104, 238, 0.3);
    font-family: 'Inter', sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .download-vi-ala-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 12px rgba(123, 104, 238, 0.4);
  }

  .download-vi-ala-btn:active {
    transform: translateY(0);
  }

  .download-vi-ala-btn:focus {
    outline: none;
    box-shadow: 
      0 0 0 3px rgba(123, 104, 238, 0.2),
      0 4px 6px rgba(123, 104, 238, 0.3);
  }

  .btn-delete {
    background: linear-gradient(135deg, #7B68EE 0%, #6495ED 100%);
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    font-size: 0.9rem;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 36px;
    height: 36px;
  }

  .btn-delete:hover {
    background: linear-gradient(135deg, #8B7AE8 0%, #7499F0 100%);
    transform: translateY(-1px);
    box-shadow: 0 2px 6px rgba(123, 104, 238, 0.3);
  }

  .btn-delete:active {
    transform: translateY(0);
  }

  /* Modal Styles */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10003;
    padding: 20px;
  }

  .confirm-overlay {
    z-index: 10003 !important;
    background: rgba(0, 0, 0, 0.7);
  }

  .modal-content {
    background: white;
    border-radius: 12px;
    max-width: 600px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
    border-bottom: 2px solid #7B68EE;
    background: linear-gradient(135deg, #7B68EE 0%, #6495ED 100%);
    color: white;
  }

  .modal-header h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
  }

  .modal-close {
    background: none;
    border: none;
    color: white;
    font-size: 2rem;
    cursor: pointer;
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: background 0.3s;
  }

  .modal-close:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .modal-body {
    padding: 1.5rem;
  }

  .modal-actions {
    display: flex;
    gap: 1rem;
    justify-content: flex-end;
    margin-top: 2rem;
    padding-top: 1.5rem;
    border-top: 1px solid #ddd;
  }

  .btn-cancel {
    padding: 0.75rem 1.5rem;
    border: none;
    border-radius: 6px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s;
    font-family: 'Inter', sans-serif;
    background: #e0e0e0;
    color: #333;
  }

  .btn-cancel:hover {
    background: #d0d0d0;
  }

  .confirm-modal {
    max-width: 450px;
  }

  .confirm-message {
    text-align: center;
    padding: 1rem 0;
  }

  .confirm-message p {
    margin: 0.75rem 0;
    font-size: 1rem;
    color: #333;
    line-height: 1.6;
  }

  .confirm-message strong {
    color: #7B68EE;
    font-weight: 600;
  }

  .confirm-warning {
    color: #F44336 !important;
    font-size: 0.9rem !important;
    font-weight: 500;
    margin-top: 1rem !important;
  }

  .btn-delete-confirm {
    background: #bdbdbd;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.75rem 1.5rem;
    cursor: pointer;
    font-size: 1rem;
    font-weight: 600;
    transition: all 0.3s;
    margin-left: 0.5rem;
  }

  .btn-delete-confirm:hover {
    background: #424242;
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
  }

  .btn-delete-confirm:active {
    transform: translateY(0);
  }

  .add-projetista-section {
    margin-top: 1rem;
    display: flex;
    justify-content: center;
  }

  .btn-add {
    background: linear-gradient(135deg, #7B68EE 0%, #6495ED 100%);
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    font-family: 'Inter', sans-serif;
  }

  .btn-add:hover {
    background: linear-gradient(135deg, #8B7AE8 0%, #7499F0 100%);
    transform: translateY(-1px);
    box-shadow: 0 4px 8px rgba(123, 104, 238, 0.3);
  }

  .form-group {
    margin-bottom: 1.5rem;
  }

  .form-group label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 600;
    color: #333;
    font-size: 0.9375rem;
  }

  .required {
    color: #F44336;
  }

  .form-group input {
    width: 100%;
    padding: 0.75rem;
    border: 2px solid #E2E8F0;
    border-radius: 8px;
    font-size: 0.9375rem;
    font-family: 'Inter', sans-serif;
    transition: all 0.2s ease;
    box-sizing: border-box;
  }

  .form-group input:focus {
    outline: none;
    border-color: #7B68EE;
    box-shadow: 0 0 0 3px rgba(123, 104, 238, 0.1);
  }

  .form-group input.error {
    border-color: #F44336;
  }

  .password-input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .password-input-wrapper input {
    padding-right: 3rem;
  }

  .password-toggle {
    position: absolute;
    right: 0.75rem;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #718096;
    transition: all 0.2s ease;
  }

  .password-toggle:hover {
    color: #7B68EE;
  }

  .password-toggle svg {
    width: 20px;
    height: 20px;
  }

  .error-message-modal {
    background: #ffebee;
    border: 1px solid #F44336;
    color: #C53030;
    padding: 0.75rem;
    border-radius: 6px;
    font-size: 0.875rem;
    margin-bottom: 1rem;
  }

  .success-message-modal {
    background: #e8f5e9;
    border: 1px solid #4caf50;
    color: #2e7d32;
    padding: 0.75rem;
    border-radius: 6px;
    font-size: 0.875rem;
    margin-bottom: 1rem;
    font-weight: 500;
  }

  .btn-add-confirm {
    background: linear-gradient(135deg, #7B68EE 0%, #6495ED 100%);
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.75rem 1.5rem;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    font-family: 'Inter', sans-serif;
  }

  .btn-add-confirm:hover {
    background: linear-gradient(135deg, #8B7AE8 0%, #7499F0 100%);
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(123, 104, 238, 0.3);
  }

  .btn-add-confirm:active {
    transform: translateY(0);
  }

  .upload-section {
    margin-top: 0.5rem;
    text-align: center;
  }

  .upload-button-container {
    display: flex;
    justify-content: center;
    margin-bottom: 1rem;
  }

  .upload-label {
    display: inline-block;
    padding: 0.875rem 1.5rem;
    background: linear-gradient(135deg, #7B68EE 0%, #6495ED 100%);
    color: white;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.95rem;
    transition: all 0.3s ease;
    box-shadow: 0 4px 6px rgba(123, 104, 238, 0.3);
  }

  .upload-label:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 12px rgba(123, 104, 238, 0.4);
  }

  .upload-label:active {
    transform: translateY(0);
  }

  .upload-hint {
    font-size: 0.875rem;
    color: #666;
    margin: 0.75rem 0;
    line-height: 1.5;
  }

  .last-modified-text {
    font-size: 0.875rem;
    color: #7B68EE;
    margin: 1rem 0 0.5rem 0;
    font-weight: 600;
  }

  .upload-status {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    margin: 1rem 0;
    padding: 1rem;
    background: rgba(123, 104, 238, 0.1);
    border-radius: 8px;
    color: #7B68EE;
    font-size: 0.9rem;
    font-weight: 500;
    border: 1px solid rgba(123, 104, 238, 0.2);
  }

  .loading-spinner {
    width: 20px;
    height: 20px;
    border: 3px solid rgba(123, 104, 238, 0.2);
    border-top-color: #7B68EE;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .upload-message {
    margin: 1rem 0;
    padding: 1rem;
    border-radius: 8px;
    font-size: 0.9rem;
    line-height: 1.5;
    white-space: pre-line;
    font-weight: 500;
  }

  .upload-message.success {
    background: rgba(76, 175, 80, 0.1);
    border: 1px solid #4CAF50;
    color: #2e7d32;
  }

  .upload-message.error {
    background: rgba(244, 67, 54, 0.1);
    border: 1px solid #F44336;
    color: #c62828;
  }

  .upload-message.processing {
    background: rgba(123, 104, 238, 0.1);
    border: 1px solid #7B68EE;
    color: #5a4fcf;
  }

  .delete-base-container {
    display: flex;
    justify-content: center;
    margin-top: 1rem;
  }

  .btn-delete-base {
    width: 100%;
    padding: 0.75rem 1.5rem;
    background: linear-gradient(135deg, #F44336 0%, #E53935 100%);
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-weight: 600;
    font-size: 0.9rem;
    transition: all 0.3s ease;
    box-shadow: 0 4px 6px rgba(244, 67, 54, 0.3);
    font-family: 'Inter', sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .btn-delete-base:hover:not(:disabled) {
    background: linear-gradient(135deg, #EF5350 0%, #E53935 100%);
    transform: translateY(-2px);
    box-shadow: 0 6px 12px rgba(244, 67, 54, 0.4);
  }

  .btn-delete-base:active:not(:disabled) {
    transform: translateY(0);
  }

  .btn-delete-base:disabled {
    background: #ccc;
    cursor: not-allowed;
    opacity: 0.6;
  }

  .btn-delete-base:focus {
    outline: none;
    box-shadow: 
      0 0 0 3px rgba(244, 67, 54, 0.2),
      0 4px 6px rgba(244, 67, 54, 0.3);
  }
</style>
