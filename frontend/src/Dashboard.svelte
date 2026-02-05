<script>
  import { onMount } from 'svelte';
  import { getAvailableTools } from './tools/toolsRegistry.js';
  import { getApiUrl } from './config.js';
  import Config from './Config.svelte';
  
  export let onToolSelect = (toolId) => {};
  export let currentUser = '';
  export let userTipo = 'user'; // Tipo de usuário: 'admin' ou 'user'
  export let onLogout = () => {};
  export let onUserUpdate = (newUserName) => {}; // Callback para atualizar nome do usuário no componente pai

  // Imagem de fundo do Dashboard
  // Altere aqui o nome do arquivo quando adicionar a nova imagem em /public
  const backgroundImage = '/dashboard-background.png'; // Troque pelo nome da sua imagem

  // Estado para permissões de ferramentas do usuário atual
  let userToolPermissions = {};
  let permissionsLoaded = false; // Flag para indicar se permissões foram carregadas
  let loadingPermissions = true; // Flag para indicar que está carregando permissões
  
  // Lista de ferramentas disponíveis (vem do registry)
  // IMPORTANTE: Só mostrar ferramentas se tiver permissão EXPLICITAMENTE habilitada (true)
  // Se não há permissões carregadas ainda, não mostrar nada (aguardar carregamento)
  $: tools = permissionsLoaded 
    ? getAvailableTools().filter(tool => {
        // Se é admin, mostrar todas as ferramentas
        if (userTipo === 'admin') {
          return true;
        }
        // Se não há permissões definidas para esta ferramenta, considerar como não permitida
        // Só mostrar se estiver EXPLICITAMENTE habilitada (true)
        return userToolPermissions[tool.id] === true;
      })
    : []; // Enquanto não carregar permissões, não mostrar ferramentas
  
  // Função para carregar permissões de ferramentas do usuário atual
  async function loadUserToolPermissions() {
    if (!currentUser) {
      loadingPermissions = false;
      permissionsLoaded = true;
      return;
    }
    
    loadingPermissions = true;
    
    try {
      const response = await fetch(getApiUrl(`/api/projetistas/${encodeURIComponent(currentUser)}/permissions`), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Usuario': currentUser || '',
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.permissions) {
          userToolPermissions = data.permissions;
          console.log('✅ [Dashboard] Permissões carregadas:', userToolPermissions);
        } else {
          // Se não há permissões salvas, inicializar como objeto vazio
          userToolPermissions = {};
          console.log('ℹ️ [Dashboard] Nenhuma permissão específica encontrada, usando padrão');
        }
      } else {
        console.warn('⚠️ [Dashboard] Erro ao carregar permissões (status:', response.status, ')');
        userToolPermissions = {};
      }
    } catch (err) {
      console.error('❌ [Dashboard] Erro ao carregar permissões de ferramentas:', err);
      // Em caso de erro, não permitir acesso a nenhuma ferramenta (segurança)
      userToolPermissions = {};
    } finally {
      loadingPermissions = false;
      permissionsLoaded = true;
      console.log('✅ [Dashboard] Permissões carregadas. Ferramentas disponíveis:', tools.length);
    }
  }
  
  // Carregar permissões quando o componente for montado ou quando currentUser mudar
  $: if (currentUser) {
    loadUserToolPermissions();
  }
  
  // Também carregar ao montar o componente
  onMount(() => {
    if (currentUser) {
      loadUserToolPermissions();
    } else {
      // Se não há usuário, marcar como carregado para não ficar em loading infinito
      loadingPermissions = false;
      permissionsLoaded = true;
    }
  });

  // Estado do modal de confirmação de logout
  let showLogoutModal = false;

  // Estado do modal de configurações
  let showSettingsModal = false;

  // Estados para modal de alterar senha e nome
  let showChangePasswordModal = false;
  let newPassword = '';
  let confirmPassword = '';
  let showChangePassword = false;
  let showConfirmPassword = false;
  let changePasswordError = '';
  let changePasswordSuccess = false;
  let newUserName = '';
  let changeUserNameError = '';
  let changeUserNameSuccess = false;

  function handleToolClick(tool) {
    if (tool.available) {
      // Abrir ferramenta em nova aba com URL específica
      const currentUrl = window.location.origin + window.location.pathname;
      const toolUrl = `${currentUrl}#/${tool.id}`;
      window.open(toolUrl, '_blank');
    }
  }

  function handleLogoutClick() {
    showLogoutModal = true;
  }

  // Função para abrir modal de configurações
  function openSettingsModal() {
    showSettingsModal = true;
  }

  // Função para fechar modal de configurações
  function closeSettingsModal() {
    showSettingsModal = false;
  }

  // Função para recarregar dados (placeholder - não usado no Dashboard mas necessário para Config)
  async function reloadCTOsData() {
    // No Dashboard não há necessidade de recarregar CTOs
    // Esta função existe apenas para compatibilidade com o componente Config
  }

  function closeLogoutModal() {
    showLogoutModal = false;
  }

  function confirmLogout() {
    showLogoutModal = false;
    onLogout();
  }

  // Função para abrir modal de trocar senha
  function openChangePasswordModal() {
    showChangePasswordModal = true;
    newPassword = '';
    confirmPassword = '';
    changePasswordError = '';
    changePasswordSuccess = false;
    showChangePassword = false;
    showConfirmPassword = false;
    newUserName = currentUser || '';
    changeUserNameError = '';
    changeUserNameSuccess = false;
  }

  // Função para fechar modal de trocar senha
  function closeChangePasswordModal() {
    showChangePasswordModal = false;
    newPassword = '';
    confirmPassword = '';
    changePasswordError = '';
    changePasswordSuccess = false;
    showChangePassword = false;
    showConfirmPassword = false;
    newUserName = '';
    changeUserNameError = '';
    changeUserNameSuccess = false;
  }

  // Função para trocar senha do usuário atual
  async function changeUserPassword() {
    changePasswordError = '';
    changePasswordSuccess = false;
    
    if (!newPassword || !newPassword.trim()) {
      changePasswordError = 'Nova senha é obrigatória';
      return;
    }
    
    if (newPassword.trim().length < 4) {
      changePasswordError = 'A senha deve ter pelo menos 4 caracteres';
      return;
    }
    
    if (newPassword !== confirmPassword) {
      changePasswordError = 'As senhas não coincidem';
      return;
    }
    
    try {
      const response = await fetch(getApiUrl(`/api/projetistas/${encodeURIComponent(currentUser)}/password`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          senha: newPassword.trim()
        }),
      });

      const data = await response.json();

      if (data.success) {
        changePasswordSuccess = true;
        changePasswordError = '';
        // Fechar modal após sucesso
        setTimeout(() => {
          closeChangePasswordModal();
        }, 2000);
      } else {
        changePasswordError = data.error || 'Erro ao alterar senha';
      }
    } catch (err) {
      console.error('Erro ao alterar senha:', err);
      changePasswordError = 'Erro ao conectar com o servidor. Tente novamente.';
    }
  }

  // Função para alterar nome do usuário atual
  async function changeUserName() {
    changeUserNameError = '';
    changeUserNameSuccess = false;
    
    if (!newUserName || !newUserName.trim()) {
      changeUserNameError = 'Novo nome é obrigatório';
      return;
    }
    
    if (newUserName.trim().length < 2) {
      changeUserNameError = 'O nome deve ter pelo menos 2 caracteres';
      return;
    }
    
    if (newUserName.trim().toLowerCase() === currentUser.toLowerCase()) {
      changeUserNameError = 'O novo nome deve ser diferente do nome atual';
      return;
    }
    
    try {
      const response = await fetch(getApiUrl(`/api/projetistas/${encodeURIComponent(currentUser)}/name`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          novoNome: newUserName.trim()
        }),
      });

      const data = await response.json();

      if (data.success) {
        changeUserNameSuccess = true;
        changeUserNameError = '';
        
        // Atualizar localStorage
        if (typeof localStorage !== 'undefined') {
          const storedUsuario = localStorage.getItem('usuario');
          if (storedUsuario) {
            localStorage.setItem('usuario', data.novoNome);
          }
        }
        
        // Atualizar currentUser localmente
        currentUser = data.novoNome;
        
        // Notificar componente pai sobre a mudança
        if (onUserUpdate && typeof onUserUpdate === 'function') {
          onUserUpdate(data.novoNome);
        }
        
        // Fechar modal após sucesso
        setTimeout(() => {
          closeChangePasswordModal();
        }, 2000);
      } else {
        changeUserNameError = data.error || 'Erro ao alterar nome';
      }
    } catch (err) {
      console.error('Erro ao alterar nome:', err);
      changeUserNameError = 'Erro ao conectar com o servidor. Tente novamente.';
    }
  }
</script>

<div class="dashboard-container" style="background-image: url('{backgroundImage}');">
  <header class="dashboard-header">
    <div class="header-content">
      <div class="header-left">
        <h1 class="dashboard-title">Porta de Ferramentas - Engenharia</h1>
        <p class="dashboard-subtitle">Setor de Planejamento e Projetos - Engenharia Alares</p>
      </div>
      <div class="header-right">
        <span 
          class="user-name clickable" 
          on:click={openChangePasswordModal}
          title="Clique para alterar dados"
          role="button"
          tabindex="0"
          on:keydown={(e) => e.key === 'Enter' && openChangePasswordModal()}
        >
          {currentUser}
        </span>
        <button 
          class="settings-button" 
          on:click={openSettingsModal}
          title="Configurações"
          aria-label="Configurações"
          type="button"
        >
          ⚙️
        </button>
        <button class="logout-button" on:click={handleLogoutClick} title="Sair">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="16 17 21 12 16 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  </header>

  <main class="dashboard-main">
    <div class="main-wrapper">
      <div class="welcome-section">
        <h2 class="welcome-title">Bem-vindo, {currentUser}!</h2>
        <p class="welcome-subtitle">Selecione uma ferramenta abaixo para começar</p>
      </div>

      <div class="tools-section">
        <h2 class="section-title">Ferramentas Disponíveis</h2>
        {#if loadingPermissions}
          <div class="loading-permissions">
            <div class="spinner"></div>
            <p>Carregando permissões...</p>
          </div>
        {:else if tools.length === 0}
          <div class="no-tools-message">
            <p>Você não tem acesso a nenhuma ferramenta no momento.</p>
            <p class="no-tools-subtitle">Entre em contato com o administrador para solicitar acesso.</p>
          </div>
        {:else}
          <div class="tools-grid">
            {#each tools as tool (tool.id)}
              <button
                class="tool-card"
                class:disabled={!tool.available}
                on:click={() => handleToolClick(tool)}
                disabled={!tool.available}
              >
                <div class="tool-icon-wrapper">
                  <div class="tool-icon" style="background: linear-gradient(135deg, {tool.color}15 0%, {tool.color}25 100%);">
                    <span class="icon-emoji">{tool.icon}</span>
                  </div>
                </div>
                <div class="tool-content">
                  <h3 class="tool-title">{tool.title}</h3>
                  <p class="tool-description">{tool.description}</p>
                </div>
                <div class="tool-arrow">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </main>
</div>

<!-- Modal de Configurações -->
{#if showSettingsModal}
  <Config 
    onClose={closeSettingsModal}
    onReloadCTOs={reloadCTOsData}
    onUpdateProjetistas={(list) => { /* No Dashboard não precisamos atualizar lista local */ }}
    onUpdateTabulacoes={(list) => { /* No Dashboard não precisamos atualizar lista local */ }}
    baseDataExists={true}
    userTipo={userTipo}
    currentUser={currentUser}
  />
{/if}

<!-- Modal de Alterar Dados do Usuário -->
{#if showChangePasswordModal}
  <div 
    class="modal-overlay change-password-overlay" 
    on:click={closeChangePasswordModal}
    on:keydown={(e) => e.key === 'Escape' && closeChangePasswordModal()}
    role="button"
    tabindex="-1"
    aria-label="Fechar modal"
  >
    <div 
      class="modal-content change-password-modal" 
      on:click|stopPropagation
      on:keydown={(e) => e.stopPropagation()}
      role="dialog"
      tabindex="0"
      aria-modal="true"
      aria-labelledby="change-password-title"
    >
      <div class="modal-header">
        <h2 id="change-password-title">Alterar Dados - {currentUser}</h2>
        <button class="modal-close" on:click={closeChangePasswordModal} aria-label="Fechar modal">×</button>
      </div>

      <div class="modal-body">
        <!-- Seção de Alterar Nome -->
        <div style="margin-bottom: 2rem; padding-bottom: 2rem; border-bottom: 1px solid #e0e0e0;">
          <h3 class="settings-section-title">Alterar Nome do Usuário</h3>
          <form on:submit|preventDefault={changeUserName}>
            <div class="form-group">
              <label for="newUserName">Novo Nome <span class="required">*</span></label>
              <input 
                type="text" 
                id="newUserName"
                bind:value={newUserName}
                placeholder="Digite o novo nome"
                required
                class:error={changeUserNameError && !newUserName.trim()}
              />
            </div>

            {#if changeUserNameError}
              <div class="error-message-modal">
                {changeUserNameError}
              </div>
            {/if}

            {#if changeUserNameSuccess}
              <div class="success-message-modal">
                ✅ Nome alterado com sucesso!
              </div>
            {/if}

            <div class="modal-actions" style="margin-top: 1rem;">
              <button type="submit" class="btn-add-confirm">
                Alterar Nome
              </button>
            </div>
          </form>
        </div>

        <!-- Seção de Alterar Senha -->
        <div>
          <h3 class="settings-section-title">Alterar Senha</h3>
          <form on:submit|preventDefault={changeUserPassword}>
            <div class="form-group">
              <label for="newPasswordUser">Nova Senha <span class="required">*</span></label>
              <div class="password-input-wrapper">
                {#if showChangePassword}
                  <input 
                    type="text"
                    id="newPasswordUser"
                    bind:value={newPassword}
                    placeholder="Digite a nova senha"
                    required
                    class:error={changePasswordError && !newPassword.trim()}
                  />
                {:else}
                  <input 
                    type="password"
                    id="newPasswordUser"
                    bind:value={newPassword}
                    placeholder="Digite a nova senha"
                    required
                    class:error={changePasswordError && !newPassword.trim()}
                  />
                {/if}
                <button 
                  type="button"
                  class="password-toggle"
                  on:click={() => showChangePassword = !showChangePassword}
                  aria-label={showChangePassword ? 'Ocultar senha' : 'Mostrar senha'}
                  title={showChangePassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {#if showChangePassword}
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

            <div class="form-group">
              <label for="confirmPasswordUser">Confirmar Nova Senha <span class="required">*</span></label>
              <div class="password-input-wrapper">
                {#if showConfirmPassword}
                  <input 
                    type="text"
                    id="confirmPasswordUser"
                    bind:value={confirmPassword}
                    placeholder="Digite a senha novamente"
                    required
                    class:error={changePasswordError && newPassword !== confirmPassword}
                  />
                {:else}
                  <input 
                    type="password"
                    id="confirmPasswordUser"
                    bind:value={confirmPassword}
                    placeholder="Digite a senha novamente"
                    required
                    class:error={changePasswordError && newPassword !== confirmPassword}
                  />
                {/if}
                <button 
                  type="button"
                  class="password-toggle"
                  on:click={() => showConfirmPassword = !showConfirmPassword}
                  aria-label={showConfirmPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  title={showConfirmPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {#if showConfirmPassword}
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

            {#if changePasswordError}
              <div class="error-message-modal">
                {changePasswordError}
              </div>
            {/if}

            {#if changePasswordSuccess}
              <div class="success-message-modal">
                ✅ Senha alterada com sucesso!
              </div>
            {/if}

            <div class="modal-actions" style="margin-top: 1rem;">
              <button type="button" class="btn-cancel" on:click={closeChangePasswordModal}>Fechar</button>
              <button type="submit" class="btn-add-confirm">
                Alterar Senha
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Modal de Confirmação de Logout -->
{#if showLogoutModal}
  <div 
    class="modal-overlay confirm-overlay" 
    on:click={closeLogoutModal}
    on:keydown={(e) => e.key === 'Escape' && closeLogoutModal()}
    role="button"
    tabindex="-1"
    aria-label="Fechar modal"
  >
    <div 
      class="modal-content confirm-modal" 
      on:click|stopPropagation
      on:keydown={(e) => e.stopPropagation()}
      role="dialog"
      tabindex="0"
      aria-modal="true"
      aria-labelledby="confirm-logout-title"
    >
      <div class="modal-header">
        <h2 id="confirm-logout-title">Confirmar Saída</h2>
        <button class="modal-close" on:click={closeLogoutModal} aria-label="Fechar modal">×</button>
      </div>

      <div class="modal-body">
        <div class="confirm-message">
          <p>Deseja realmente sair?</p>
        </div>

        <div class="modal-actions">
          <button type="button" class="btn-cancel" on:click={closeLogoutModal}>Cancelar</button>
          <button type="button" class="btn-logout-confirm" on:click={confirmLogout}>
            Sair
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  }

  .dashboard-container {
    min-height: 100vh;
    background-image: url('{backgroundImage}');
    background-size: cover;
    background-position: right bottom;
    background-repeat: no-repeat;
    background-attachment: fixed;
    padding: 0;
    position: relative;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
  }

  .dashboard-container::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 50%, transparent 100%);
    pointer-events: none;
    z-index: 0;
  }

  .dashboard-header {
    background: linear-gradient(135deg, #7B68EE 0%, #6B5BEE 100%);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
    padding: 1.5rem 2rem;
    position: sticky;
    top: 0;
    z-index: 100;
    width: 100%;
    box-sizing: border-box;
    position: relative;
    backdrop-filter: blur(10px);
  }

  .header-content {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    box-sizing: border-box;
  }

  .header-left {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex-shrink: 1;
    min-width: 0;
  }

  .dashboard-title {
    color: white;
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0;
    letter-spacing: -0.5px;
    font-family: 'Inter', sans-serif;
  }

  .dashboard-subtitle {
    color: rgba(255, 255, 255, 0.9);
    font-size: 0.875rem;
    margin: 0;
    font-weight: 400;
    font-family: 'Inter', sans-serif;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-shrink: 0;
    margin-left: auto;
  }

  .user-name {
    color: white;
    font-size: 0.9375rem;
    font-weight: 500;
    padding: 0.5rem 1rem;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    backdrop-filter: blur(10px);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .user-name.clickable {
    cursor: pointer;
    transition: all 0.2s ease;
    user-select: none;
  }

  .user-name.clickable:hover {
    background: rgba(255, 255, 255, 0.25);
    transform: translateY(-1px);
  }

  .user-name.clickable:active {
    background: rgba(255, 255, 255, 0.3);
    transform: translateY(0);
  }

  .settings-button {
    background: rgba(255, 255, 255, 0.15);
    border: 1.5px solid rgba(255, 255, 255, 0.25);
    border-radius: 10px;
    padding: 0.625rem;
    cursor: pointer;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    backdrop-filter: blur(10px);
    flex-shrink: 0;
    font-size: 1.25rem;
    width: 40px;
    height: 40px;
  }

  .settings-button:hover {
    background: rgba(255, 255, 255, 0.25);
    border-color: rgba(255, 255, 255, 0.4);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  .settings-button:active {
    transform: translateY(0);
  }

  .logout-button {
    background: rgba(255, 255, 255, 0.15);
    border: 1.5px solid rgba(255, 255, 255, 0.25);
    border-radius: 10px;
    padding: 0.625rem;
    cursor: pointer;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    backdrop-filter: blur(10px);
    flex-shrink: 0;
  }

  .logout-button:hover {
    background: rgba(255, 255, 255, 0.25);
    border-color: rgba(255, 255, 255, 0.4);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  .logout-button:active {
    transform: translateY(0);
  }

  .dashboard-main {
    flex: 1;
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 4rem 2rem;
    position: relative;
    z-index: 1;
  }

  .main-wrapper {
    max-width: 1200px;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 3rem;
  }

  .welcome-section {
    text-align: center;
    padding: 2rem 0;
    animation: fadeInUp 0.6s ease-out;
    position: relative;
    z-index: 1;
  }

  .welcome-title {
    color: #ffffff;
    font-size: 2.25rem;
    font-weight: 700;
    margin: 0 0 0.75rem 0;
    letter-spacing: -0.5px;
    text-shadow: 
      0 2px 8px rgba(123, 104, 238, 0.5),
      0 4px 16px rgba(100, 149, 237, 0.3),
      0 0 20px rgba(123, 104, 238, 0.2);
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
  }

  .welcome-subtitle {
    color: rgba(255, 255, 255, 0.95);
    font-size: 1.125rem;
    margin: 0;
    font-weight: 500;
    letter-spacing: 0.2px;
    text-shadow: 
      0 2px 6px rgba(123, 104, 238, 0.4),
      0 1px 3px rgba(100, 149, 237, 0.3),
      0 0 10px rgba(123, 104, 238, 0.2);
  }

  .tools-section {
    width: 100%;
    animation: fadeInUp 0.8s ease-out 0.2s both;
  }

  .section-title {
    color: #ffffff;
    font-size: 1.5rem;
    font-weight: 600;
    margin: 0 0 2.5rem 0;
    letter-spacing: -0.3px;
    text-align: center;
    position: relative;
    padding-bottom: 1rem;
    text-shadow: 
      0 2px 6px rgba(123, 104, 238, 0.5),
      0 1px 3px rgba(100, 149, 237, 0.4),
      0 0 15px rgba(123, 104, 238, 0.2);
  }

  .section-title::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 60px;
    height: 3px;
    background: linear-gradient(90deg, #7B68EE 0%, #6495ED 100%);
    border-radius: 2px;
  }

  @keyframes fadeInUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 2rem;
    justify-items: center;
    max-width: 1000px;
    margin: 0 auto;
  }

  .tool-card {
    background: rgba(255, 255, 255, 0.98);
    backdrop-filter: blur(20px) saturate(180%);
    border-radius: 20px;
    padding: 2rem;
    border: 1.5px solid rgba(255, 255, 255, 0.3);
    cursor: pointer;
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    position: relative;
    overflow: hidden;
    box-shadow: 
      0 8px 32px rgba(123, 104, 238, 0.15),
      0 4px 16px rgba(100, 149, 237, 0.1),
      0 2px 8px rgba(0, 0, 0, 0.05),
      inset 0 1px 0 rgba(255, 255, 255, 0.9);
    text-align: left;
    width: 100%;
    max-width: 400px;
    min-height: 220px;
  }

  .tool-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: linear-gradient(90deg, #7B68EE 0%, #6495ED 100%);
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .tool-card::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(135deg, rgba(123, 104, 238, 0.02) 0%, rgba(100, 149, 237, 0.02) 100%);
    opacity: 0;
    transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    pointer-events: none;
  }

  .tool-card:hover {
    transform: translateY(-6px) scale(1.02);
    box-shadow: 
      0 16px 40px rgba(123, 104, 238, 0.25),
      0 8px 20px rgba(100, 149, 237, 0.15),
      0 4px 12px rgba(0, 0, 0, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 1);
    border-color: rgba(123, 104, 238, 0.5);
    background: rgba(255, 255, 255, 1);
  }

  .tool-card:hover::after {
    opacity: 1;
  }

  .tool-card:hover::before {
    transform: scaleX(1);
  }

  .tool-card:active {
    transform: translateY(-2px);
  }

  .tool-card.disabled {
    opacity: 0.6;
    cursor: not-allowed;
    background: #f7fafc;
  }

  .tool-card.disabled:hover {
    transform: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
    border-color: #e2e8f0;
  }

  .tool-icon-wrapper {
    display: flex;
    align-items: center;
    justify-content: flex-start;
  }

  .tool-icon {
    width: 72px;
    height: 72px;
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }

  .tool-card:hover .tool-icon {
    transform: scale(1.1) rotate(5deg);
    box-shadow: 0 4px 16px rgba(123, 104, 238, 0.2);
  }

  .icon-emoji {
    font-size: 2rem;
    line-height: 1;
  }

  .tool-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    z-index: 1;
    position: relative;
  }

  .tool-title {
    color: #4c1d95;
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
    letter-spacing: -0.3px;
    line-height: 1.3;
  }

  .tool-description {
    color: #5b21b6;
    font-size: 0.9375rem;
    line-height: 1.6;
    margin: 0;
    font-weight: 400;
    opacity: 0.85;
  }

  .tool-arrow {
    position: absolute;
    top: 2rem;
    right: 2rem;
    color: #7B68EE;
    opacity: 0;
    transform: translateX(-12px);
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 2;
  }

  .tool-card:hover .tool-arrow {
    opacity: 1;
    transform: translateX(0);
    color: #6495ED;
  }

  /* Responsividade */
  @media (max-width: 768px) {
    .dashboard-header {
      padding: 1.25rem 1.5rem;
    }

    .dashboard-title {
      font-size: 1.5rem;
    }

    .dashboard-subtitle {
      font-size: 0.8125rem;
    }

    .header-content {
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
    }

    .header-left {
      flex-shrink: 1;
      min-width: 0;
      overflow: hidden;
    }

    .dashboard-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .dashboard-subtitle {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-shrink: 0;
      margin-left: auto;
    }

    .user-name {
      font-size: 0.875rem;
      padding: 0.4rem 0.75rem;
      max-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .dashboard-main {
      padding: 2.5rem 1.5rem;
    }

    .main-wrapper {
      gap: 2.5rem;
    }

    .welcome-section {
      padding: 1.5rem 0;
    }

    .welcome-title {
      font-size: 1.875rem;
    }

    .welcome-subtitle {
      font-size: 1rem;
    }

    .tools-grid {
      grid-template-columns: 1fr;
      gap: 1.5rem;
      max-width: 100%;
    }

    .tool-card {
      padding: 1.75rem;
      max-width: 100%;
      min-height: auto;
    }

    .section-title {
      font-size: 1.375rem;
      margin-bottom: 2rem;
    }
  }

  @media (max-width: 480px) {
    .dashboard-header {
      padding: 1rem;
    }

    .header-content {
      gap: 0.5rem;
    }

    .header-left {
      flex-shrink: 1;
      min-width: 0;
    }

    .dashboard-title {
      font-size: 1.25rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .dashboard-subtitle {
      font-size: 0.75rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .header-right {
      gap: 0.5rem;
    }

    .user-name {
      font-size: 0.8125rem;
      padding: 0.375rem 0.625rem;
      max-width: 100px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .logout-button {
      padding: 0.5rem;
    }

    .dashboard-main {
      padding: 2rem 1rem;
    }

    .main-wrapper {
      gap: 2rem;
    }

    .welcome-title {
      font-size: 1.625rem;
    }

    .welcome-subtitle {
      font-size: 0.9375rem;
    }

    .section-title {
      font-size: 1.25rem;
      margin-bottom: 1.75rem;
    }

    .tools-grid {
      gap: 1.25rem;
    }

    .tool-card {
      padding: 1.5rem;
    }

    .tool-icon {
      width: 64px;
      height: 64px;
    }

    .tool-title {
      font-size: 1.125rem;
    }

    .tool-description {
      font-size: 0.875rem;
    }

    .user-name {
      font-size: 0.875rem;
      padding: 0.375rem 0.75rem;
    }
  }

  /* Modal de Confirmação de Logout */
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
    animation: modalFadeIn 0.3s ease-out;
  }

  @keyframes modalFadeIn {
    from {
      opacity: 0;
      transform: scale(0.9) translateY(-20px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  .confirm-modal {
    max-width: 450px;
  }

  .modal-header {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 1.5rem;
    border-bottom: 2px solid #7B68EE;
    background: linear-gradient(135deg, #7B68EE 0%, #6495ED 100%);
    color: white;
    border-radius: 12px 12px 0 0;
    position: relative;
  }

  .modal-header h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    text-align: center;
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
    position: absolute;
    right: 1.5rem;
    top: 50%;
    transform: translateY(-50%);
  }

  .modal-close:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .modal-body {
    padding: 1.5rem;
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

  .modal-actions {
    display: flex;
    gap: 1rem;
    justify-content: center;
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

  .btn-logout-confirm {
    background: linear-gradient(135deg, #7B68EE 0%, #6495ED 100%);
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.75rem 1.5rem;
    cursor: pointer;
    font-size: 1rem;
    font-weight: 600;
    transition: all 0.3s ease;
    box-shadow: 0 4px 6px rgba(123, 104, 238, 0.3);
  }

  .btn-logout-confirm:hover:not(:disabled) {
    background: linear-gradient(135deg, #8B78FE 0%, #7495FD 100%);
    transform: translateY(-2px);
    box-shadow: 0 6px 12px rgba(123, 104, 238, 0.4);
  }

  .btn-logout-confirm:active:not(:disabled) {
    transform: translateY(0);
  }

  /* Modal de Alterar Dados */
  .change-password-overlay {
    z-index: 10004 !important;
    background: rgba(0, 0, 0, 0.7);
  }

  .change-password-modal {
    max-width: 500px;
  }

  .form-group {
    margin-bottom: 1.5rem;
  }

  .form-group label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 600;
    color: #333;
    font-size: 0.95rem;
  }

  .required {
    color: #F44336;
  }

  .form-group input,
  .form-group select {
    width: 100%;
    padding: 0.75rem;
    border: 2px solid #ddd;
    border-radius: 6px;
    font-size: 1rem;
    font-family: 'Inter', sans-serif;
    transition: border-color 0.3s;
    box-sizing: border-box;
  }

  .form-group input:focus,
  .form-group select:focus {
    outline: none;
    border-color: #7B68EE;
    box-shadow: 0 0 0 3px rgba(123, 104, 238, 0.1);
  }

  .form-group input.error,
  .form-group select.error {
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

  .settings-section-title {
    color: #7B68EE;
    font-size: 1.2rem;
    font-weight: 600;
    margin: 0 0 1.5rem 0;
    padding-bottom: 0.75rem;
    border-bottom: 2px solid #7B68EE;
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

  /* Loading de permissões */
  .loading-permissions {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 2rem;
    gap: 1.5rem;
  }

  .loading-permissions .spinner {
    width: 48px;
    height: 48px;
    border: 4px solid rgba(255, 255, 255, 0.2);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  .loading-permissions p {
    color: rgba(255, 255, 255, 0.9);
    font-size: 1rem;
    font-weight: 500;
    margin: 0;
    text-shadow: 0 2px 6px rgba(123, 104, 238, 0.4);
  }

  /* Mensagem quando não há ferramentas */
  .no-tools-message {
    text-align: center;
    padding: 4rem 2rem;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .no-tools-message p {
    color: rgba(255, 255, 255, 0.95);
    font-size: 1.125rem;
    font-weight: 500;
    margin: 0.5rem 0;
    text-shadow: 0 2px 6px rgba(123, 104, 238, 0.4);
  }

  .no-tools-subtitle {
    font-size: 0.9375rem !important;
    opacity: 0.85;
    font-weight: 400 !important;
  }
</style>

