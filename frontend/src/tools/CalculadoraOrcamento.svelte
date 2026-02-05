<script>
  import { onMount, onDestroy } from 'svelte';
  import Loading from '../Loading.svelte';
  import { getApiUrl } from '../config.js';

  // Props do componente
  export let currentUser = '';
  export let userTipo = 'user';
  export let onBackToDashboard = () => {};
  export let onSettingsRequest = null; // Callback para quando configurações são solicitadas
  export let onSettingsHover = null; // Callback para quando o mouse passa sobre a engrenagem

  // Estados da ferramenta
  let isLoading = false;
  let loadingMessage = '';
  let showSettingsModal = false;

  // Função para abrir configurações
  function openSettings() {
    showSettingsModal = true;
  }

  // Função para pré-carregar configurações no hover
  function preloadSettingsData() {
    // Pré-carregar dados se necessário
  }

  // Inicializar ferramenta quando o componente é montado
  onMount(async () => {
    try {
      // Registrar função de configurações com o parent
      if (onSettingsRequest && typeof onSettingsRequest === 'function') {
        onSettingsRequest(openSettings);
      }
      
      // Registrar função de pré-carregamento no hover
      if (onSettingsHover && typeof onSettingsHover === 'function') {
        onSettingsHover(preloadSettingsData);
      }
      
      // Inicializar ferramenta (adicionar lógica de inicialização aqui)
      // await initializeTool();
    } catch (err) {
      console.error('Erro ao inicializar ferramenta:', err);
      isLoading = false;
    }
  });

  // Cleanup ao desmontar
  onDestroy(() => {
    // Limpar intervalos, listeners, etc.
  });
</script>

<!-- Conteúdo da Ferramenta de Calculadora de Orçamento -->
<div class="calculadora-orcamento-content">
  {#if isLoading}
    <Loading message={loadingMessage} />
  {:else}
    <div class="content-wrapper">
      <div class="welcome-section">
        <h2>Calculadora de Orçamento</h2>
        <p>Ferramenta em desenvolvimento</p>
      </div>
    </div>
  {/if}
</div>

<style>
  .calculadora-orcamento-content {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #f5f7fa;
  }

  .content-wrapper {
    flex: 1;
    padding: 2rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .welcome-section {
    text-align: center;
    padding: 3rem 2rem;
    background: rgba(255, 255, 255, 0.9);
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    border: 1px solid rgba(123, 104, 238, 0.2);
  }

  .welcome-section h2 {
    color: #4c1d95;
    font-size: 2rem;
    font-weight: 600;
    margin: 0 0 1rem 0;
  }

  .welcome-section p {
    color: #5b21b6;
    font-size: 1.125rem;
    margin: 0;
    opacity: 0.8;
  }

  /* Responsividade */
  @media (max-width: 768px) {
    .content-wrapper {
      padding: 1.5rem;
    }

    .welcome-section {
      padding: 2rem 1.5rem;
    }

    .welcome-section h2 {
      font-size: 1.5rem;
    }

    .welcome-section p {
      font-size: 1rem;
    }
  }
</style>

