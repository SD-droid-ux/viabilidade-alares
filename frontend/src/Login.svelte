<script>
  import { onMount } from 'svelte';
  import { getApiUrl } from './config';
  
  // Debug: verificar se componente está sendo carregado
  console.log('✅ Login.svelte carregado - versão atualizada', new Date().toLocaleTimeString());
  
  onMount(() => {
    console.log('✅ Login.svelte montado no DOM');
  });
  
  let loginForm = {
    usuario: '',
    senha: ''
  };
  let showPassword = false;
  let loginError = '';
  

  // Exportar função para o componente pai poder chamar
  export let onLoginSuccess = () => {};

  // Função de login
  async function handleLogin() {
    loginError = '';
    
    // Validação básica
    if (!loginForm.usuario || !loginForm.usuario.trim()) {
      loginError = 'Por favor, informe o usuário ou e-mail.';
      return;
    }
    
    if (!loginForm.senha || !loginForm.senha.trim()) {
      loginError = 'Por favor, informe a senha.';
      return;
    }
    
    // Validar credenciais com o backend
    try {
      const apiUrl = getApiUrl('/api/auth/login');
      console.log('🔗 [Login] Tentando conectar em:', apiUrl);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          usuario: loginForm.usuario.trim(),
          senha: loginForm.senha.trim()
        }),
      });

      console.log('📥 [Login] Resposta recebida:', response.status, response.statusText);
      console.log('📥 [Login] Content-Type:', response.headers.get('content-type'));
      
      if (!response.ok) {
        console.error('❌ [Login] Erro HTTP:', response.status, response.statusText);
        // Tentar ler o texto da resposta para ver o que foi retornado
        const text = await response.text();
        console.error('❌ [Login] Resposta (texto):', text.substring(0, 200));
        loginError = `Erro ao conectar: ${response.status} ${response.statusText}`;
        return;
      }

      // Verificar se a resposta é JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('❌ [Login] Resposta não é JSON! Content-Type:', contentType);
        console.error('❌ [Login] Resposta recebida (primeiros 500 chars):', text.substring(0, 500));
        loginError = 'O servidor retornou uma resposta inválida. Verifique se o backend está configurado corretamente.';
        return;
      }

      const data = await response.json();
      console.log('📦 [Login] Dados recebidos:', data);

      if (!data.success) {
        loginError = data.error || 'Usuário ou senha incorretos';
        return;
      }
      
      // Salvar estado de login no localStorage
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('usuario', loginForm.usuario.trim());
      }
    } catch (err) {
      console.error('❌ [Login] Erro ao validar login:', err);
      console.error('❌ [Login] Tipo do erro:', err.name);
      console.error('❌ [Login] Mensagem:', err.message);
      
      if (err.name === 'TypeError' && err.message.includes('Failed to fetch')) {
        loginError = 'Não foi possível conectar ao servidor. Verifique se o backend está online.';
      } else if (err.name === 'SyntaxError') {
        loginError = 'Resposta inválida do servidor. Tente novamente.';
      } else {
        loginError = `Erro ao conectar: ${err.message}`;
      }
      return;
    }

    // Chamar callback de sucesso
    try {
      if (typeof onLoginSuccess === 'function') {
        await onLoginSuccess();
      }
    } catch (err) {
      console.error('Erro ao processar login:', err);
      loginError = 'Erro ao processar login. Tente novamente.';
    }
  }

</script>

<div class="login-container">
  <div class="login-box">
    <div class="login-header">
      <div class="tool-title">
        <h1 class="main-title">Viabilidade Alares - Engenharia</h1>
        <p class="tool-subtitle">Setor de Planejamento e Projetos - Engenharia Alares</p>
      </div>
    </div>
    
    <form on:submit|preventDefault={handleLogin} class="login-form">
      <div class="form-group-login">
        <label for="usuario">Nome de usuário</label>
        <div class="input-wrapper">
          <svg class="input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="12" cy="7" r="4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <input 
            type="text" 
            id="usuario"
            bind:value={loginForm.usuario}
            placeholder=""
            autocomplete="username"
            class:error={loginError && !loginForm.usuario.trim()}
          />
        </div>
      </div>

      <div class="form-group-login">
        <label for="senha">Senha</label>
        <div class="input-wrapper">
          <svg class="input-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          {#if showPassword}
            <input 
              type="text"
              id="senha"
              bind:value={loginForm.senha}
              placeholder=""
              autocomplete="current-password"
              class:error={loginError && !loginForm.senha.trim()}
            />
          {:else}
            <input 
              type="password"
              id="senha"
              bind:value={loginForm.senha}
              placeholder=""
              autocomplete="current-password"
              class:error={loginError && !loginForm.senha.trim()}
            />
          {/if}
          <button 
            type="button"
            class="password-toggle"
            on:click={() => showPassword = !showPassword}
            aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
            title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
          >
            {#if showPassword}
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

      {#if loginError}
        <div class="login-error">
          <span class="error-icon">⚠️</span>
          <span>{loginError}</span>
        </div>
      {/if}

      <button type="submit" class="btn-login">
        Entrar
      </button>
    </form>

  </div>
</div>


<style>
  /* Estilos da Tela de Login - Design conforme imagem */
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  }

  .login-container {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background-image: url('/background-login.png');
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    background-color: rgba(123, 104, 238, 0.9);
    padding: 2rem;
    position: relative;
    overflow: hidden;
  }

  .login-box {
    background: linear-gradient(135deg, #7B68EE 0%, #6B5BEE 100%);
    border-radius: 28px;
    box-shadow: 
      0 30px 80px rgba(0, 0, 0, 0.35),
      0 0 0 1px rgba(255, 255, 255, 0.12),
      inset 0 1px 0 rgba(255, 255, 255, 0.15);
    padding: 4rem 3.5rem;
    width: 100%;
    max-width: 500px;
    animation: slideIn 0.5s cubic-bezier(0.16, 1, 0.3, 1);
    position: relative;
    z-index: 1;
    backdrop-filter: blur(10px);
  }

  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateX(30px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateX(0) scale(1);
    }
  }

  .login-header {
    text-align: center;
    margin-bottom: 3.5rem;
    padding-bottom: 2.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.15);
  }

  .tool-title {
    margin-bottom: 2rem;
  }

  .main-title {
    color: white;
    font-size: 2rem;
    font-weight: 700;
    margin: 0 0 0.5rem 0;
    letter-spacing: -0.5px;
    line-height: 1.2;
  }

  .tool-subtitle {
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.9375rem;
    margin: 0;
    font-weight: 400;
    letter-spacing: 0.3px;
  }

  .logo-container {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    margin-top: 1.5rem;
  }

  .logo-text {
    color: white;
    font-size: 1.75rem;
    font-weight: 600;
    letter-spacing: -0.3px;
    opacity: 0.95;
  }

  .logo-icon {
    flex-shrink: 0;
    opacity: 0.9;
  }

  .login-form {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .form-group-login {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .form-group-login label {
    font-weight: 500;
    color: white;
    font-size: 0.9375rem;
    letter-spacing: 0.2px;
    margin-bottom: 0.25rem;
  }

  .input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .input-icon {
    position: absolute;
    left: 1.125rem;
    color: #7B68EE;
    z-index: 2;
    pointer-events: none;
    opacity: 0.8;
  }

  .form-group-login input {
    width: 100%;
    padding: 1.125rem 1rem 1.125rem 3.25rem;
    border: 1.5px solid rgba(255, 255, 255, 0.25);
    border-radius: 14px;
    font-size: 0.9375rem;
    font-family: 'Inter', sans-serif;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-sizing: border-box;
    background: #f8f9fa;
    color: #2D3748;
    line-height: 1.5;
    font-weight: 400;
  }

  .form-group-login input::placeholder {
    color: #A0AEC0;
    font-weight: 400;
  }

  .form-group-login input:hover {
    border-color: rgba(255, 255, 255, 0.4);
    background: #ffffff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }

  .form-group-login input:focus {
    outline: none;
    border-color: rgba(255, 255, 255, 0.6);
    background: #ffffff;
    box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.15), 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  .form-group-login input.error {
    border-color: #ef4444;
    background: #fef2f2;
  }

  .password-toggle {
    position: absolute;
    right: 1rem;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #7B68EE;
    transition: all 0.25s ease;
    border-radius: 8px;
    z-index: 2;
  }

  .password-toggle:hover {
    background: rgba(123, 104, 238, 0.1);
  }

  .password-toggle svg {
    width: 20px;
    height: 20px;
  }

  .login-error {
    background: rgba(255, 255, 255, 0.15);
    border: 1.5px solid rgba(255, 255, 255, 0.25);
    color: white;
    padding: 1rem 1.25rem;
    border-radius: 12px;
    font-size: 0.875rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-weight: 500;
    line-height: 1.5;
    backdrop-filter: blur(10px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .error-icon {
    font-size: 1.2rem;
    flex-shrink: 0;
  }

  .btn-login {
    width: 100%;
    padding: 1.25rem 1.5rem;
    background: #f8f9fa;
    color: #7B68EE;
    border: none;
    border-radius: 14px;
    font-size: 1rem;
    font-weight: 700;
    font-family: 'Inter', sans-serif;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12), 0 2px 4px rgba(0, 0, 0, 0.08);
    margin-top: 0.75rem;
    letter-spacing: 0.4px;
  }

  .btn-login:hover {
    background: #ffffff;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.12);
    transform: translateY(-2px);
  }

  .btn-login:active {
    transform: translateY(0);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
  }

  .btn-login:focus {
    outline: none;
    box-shadow: 
      0 0 0 3px rgba(255, 255, 255, 0.3),
      0 4px 14px rgba(0, 0, 0, 0.15);
  }


  /* Responsividade */
  @media (max-width: 768px) {
    .login-container {
      padding-right: 2rem;
      padding-left: 2rem;
    }

    .login-box {
      max-width: 100%;
      padding: 2.5rem 2rem;
    }
  }

  @media (max-width: 480px) {
    .login-box {
      padding: 2rem 1.5rem;
      border-radius: 16px;
    }

    .login-title {
      font-size: 1.5rem;
    }

    .logo-text {
      font-size: 1.75rem;
    }
  }
</style>
